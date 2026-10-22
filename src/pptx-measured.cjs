const path=require('node:path');
const {PptxGenJS,JSZip,DOMParser,XMLSerializer}=require('./vendor/pptx/backend.cjs');
const packaging=require('./pptx-package.cjs');
const typography=require('./pptx-fonts.cjs');
const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const emu=px=>Math.round(px*9525);
async function render(scenes,{directory,fonts,profile}){
  const pptx=new PptxGenJS();pptx.defineLayout({name:'source',width:scenes[0].width/96,height:scenes[0].height/96});pptx.layout='source';pptx.author='Deckloom';pptx.subject='Measured semantic layers with source OpenType font identities';
  const face=run=>typography.bind(fonts,run);
  for(const scene of scenes){
    const slide=pptx.addSlide();slide.background={color:scene.background.color};
    for(const object of scene.elements){
      const frame=object.kind==='text'?(object.exportFrame||typography.textFrame(fonts,object,profile)):object;
      if(object.kind==='text')object.exportFrame=frame;
      const box={x:frame.x/96,y:frame.y/96,w:frame.w/96,h:frame.h/96,objectName:object.id};
      if(object.kind==='text') {
        const runs=object.runs.map(r=>({text:r.text,options:{...face(r),fontSize:r.size*.75,color:r.color,transparency:100*(1-r.alpha),underline:r.underline,charSpacing:r.spacing*.75}}));
        slide.addText(runs,{...box,...face(object.runs[0]),fontSize:object.runs[0].size*.75,margin:0,wrap:!object.intrinsicLabel,valign:'top',align:object.align,lineSpacing:object.lineHeight*.75,paraSpaceAfterPt:0,paraSpaceBeforePt:0,breakLine:false,lang:'ru-RU'});
      } else if(object.kind==='shape') slide.addShape(object.radius>0?pptx.ShapeType.roundRect:pptx.ShapeType.rect,{...box,fill:{color:object.fill,transparency:100*(1-object.alpha)},line:{color:object.lineColor,width:object.lineWidth*.75,transparency:object.lineWidth?100*(1-object.lineAlpha):100}});
      else {
        let draw={...box};
        if(object.fit==='contain') {
          const scale=Math.min(object.w/object.naturalWidth,object.h/object.naturalHeight),w=object.naturalWidth*scale,h=object.naturalHeight*scale;
          draw={...box,x:(object.x+(object.w-w)/2)/96,y:(object.y+(object.h-h)/2)/96,w:w/96,h:h/96};
        }
        slide.addImage({...draw,path:path.join(directory,object.asset),transparency:100*(1-(object.alpha??1)),altText:object.kind==='atomic-image'?'Complex diagram, including its labels':object.sourceClass||object.id});
      }
    }
  }
  const normalized=await packaging.normalize(Buffer.from(await pptx.write({outputType:'nodebuffer'})));
  const zip=await JSZip.loadAsync(normalized.bytes),parser=new DOMParser(),serializer=new XMLSerializer();
  for(const[index,scene]of scenes.entries()){
    const part=`ppt/slides/slide${index+1}.xml`,doc=parser.parseFromString(await zip.file(part).async('string'),'text/xml'),tree=doc.getElementsByTagNameNS(P,'spTree')[0];
    const named=new Map(Array.from(tree.childNodes).filter(n=>n.nodeType===1).map(n=>[n.getElementsByTagNameNS(P,'cNvPr')[0]?.getAttribute('name'),n]));
    for(const o of scene.elements){
      const node=named.get(o.id);if(!node)throw Error('Missing native object '+o.id);
      if(o.kind==='text') {
        const body=node.getElementsByTagNameNS(A,'bodyPr')[0];
        const frame=o.exportFrame;
        body.setAttribute('tIns',String(emu(frame.topInset)));
        body.setAttribute('rIns',String(emu(frame.rightInset||0)));
        for(const child of Array.from(body.childNodes))if(['normAutofit','spAutoFit','noAutofit'].includes(child.localName))body.removeChild(child);
        body.appendChild(doc.createElementNS(A,'a:noAutofit'));
        const nativeRuns=Array.from(node.getElementsByTagNameNS(A,'r'));
        const sourceText=o.runs.map(r=>r.text).join('');let cursor=0;
        for(const native of nativeRuns){
          const text=native.getElementsByTagNameNS(A,'t')[0]?.textContent||'';
          while(sourceText[cursor]==='\n')cursor++;
          if(!sourceText.startsWith(text,cursor))throw Error('Unexpected native text/style mapping');
          let start=0;const source=o.runs.find(r=>{const found=cursor>=start&&cursor<start+r.text.length;start+=r.text.length;return found;});
          if(!source)throw Error('Missing native run source');
          typography.runProperties(native.getElementsByTagNameNS(A,'rPr')[0],face(source),o.kerning);cursor+=text.length;
        }
        for(const paragraph of Array.from(node.getElementsByTagNameNS(A,'p'))){
          const properties=Array.from(paragraph.getElementsByTagNameNS(A,'rPr')),first=properties[0];if(!first)continue;
          const copy=(name,source=first)=>{const n=doc.createElementNS(A,'a:'+name);for(const a of Array.from(source.attributes))n.setAttribute(a.name,a.value);for(const c of Array.from(source.childNodes))n.appendChild(c.cloneNode(true));return n;};
          const ppr=paragraph.getElementsByTagNameNS(A,'pPr')[0];ppr.appendChild(copy('defRPr'));
          const end=paragraph.getElementsByTagNameNS(A,'endParaRPr')[0],last=copy('endParaRPr',properties.at(-1));if(end)paragraph.replaceChild(last,end);else paragraph.appendChild(last);
        }
      }
      if(o.kind==='shape'&&o.radius){const av=node.getElementsByTagNameNS(A,'avLst')[0],gd=doc.createElementNS(A,'a:gd');gd.setAttribute('name','adj');gd.setAttribute('fmla',`val ${Math.round(100000*Math.min(o.radius,Math.min(o.w,o.h)/2)/Math.min(o.w,o.h))}`);av.appendChild(gd);}
      if(o.kind==='image'&&o.fit==='cover'){
        const imageAspect=o.naturalWidth/o.naturalHeight,targetAspect=o.w/o.h;
        const crop=doc.createElementNS(A,'a:srcRect');
        if(imageAspect>targetAspect){const side=Math.round((1-targetAspect/imageAspect)*50000);crop.setAttribute('l',side);crop.setAttribute('r',side)}
        else {const side=Math.round((1-imageAspect/targetAspect)*50000);crop.setAttribute('t',side);crop.setAttribute('b',side)}
        const fill=node.getElementsByTagNameNS(P,'blipFill')[0];fill.insertBefore(crop,fill.getElementsByTagNameNS(A,'stretch')[0]);
      }
    }
    let nextId=10000;
    for(const group of [...scene.groups].reverse()){
      const members=scene.elements.filter(o=>o.groupIds.includes(group.id)).map(o=>named.get(o.id)).filter(n=>n?.parentNode===tree);
      // Already-built child groups are direct native children of this group.
      for(const child of scene.groups.filter(g=>g.parent===group.id)){const n=named.get(child.id);if(n?.parentNode===tree)members.push(n)}
      if(!members.length)continue;
      const order=Array.from(tree.childNodes);members.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
      const node=doc.createElementNS(P,'p:grpSp'),nv=doc.createElementNS(P,'p:nvGrpSpPr'),identity=doc.createElementNS(P,'p:cNvPr');identity.setAttribute('id',String(nextId++));identity.setAttribute('name',group.id+'--group');nv.appendChild(identity);nv.appendChild(doc.createElementNS(P,'p:cNvGrpSpPr'));nv.appendChild(doc.createElementNS(P,'p:nvPr'));node.appendChild(nv);
      const props=doc.createElementNS(P,'p:grpSpPr'),transform=doc.createElementNS(A,'a:xfrm');
      for(const [tag,attrs]of [['off',{x:emu(group.x),y:emu(group.y)}],['ext',{cx:emu(group.w),cy:emu(group.h)}],['chOff',{x:emu(group.x),y:emu(group.y)}],['chExt',{cx:emu(group.w),cy:emu(group.h)}]]){const e=doc.createElementNS(A,'a:'+tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));transform.appendChild(e)}
      props.appendChild(transform);node.appendChild(props);tree.insertBefore(node,members[0]);for(const member of members)node.appendChild(member);named.set(group.id,node);
    }
    zip.file(part,serializer.serializeToString(doc));
  }
  const layered=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  packaging.inspect((await packaging.load(layered)).files);
  const used=fonts.filter(f=>scenes.some(s=>s.elements.some(o=>o.runs?.some(r=>r.font.toLowerCase()===f.family.toLowerCase()&&r.weight===f.metadata.weight&&!!r.italic===f.metadata.italic))));
  const result=await typography.embed(layered,used);
  return {bytes:result,conversion:{experimental:true,slides:scenes.map(s=>({id:s.id,objects:s.elements.map(({runs,...o})=>({...o,...(runs?{text:runs.map(r=>r.text).join('')}:{} )})),groups:s.groups})),fonts:used.map(({family,metadata:{tables,...metadata}})=>({family,...metadata}))}};
}
// Selection geometry may include Office's layout sidebearings. Preserve the
// author's flow width by adding an equal right inset when extending the frame.
function containTextFrames(scenes,measurements){
  const records=[];
  for(const scene of scenes)for(const object of scene.elements.filter(o=>o.kind==='text')){
    const native=measurements.find(m=>m.slide===scene.id&&m.id===object.id),frame=object.exportFrame;
    if(!native||!frame)throw Error('Missing rendered text bounds');
    if(Math.round(native.h/object.lineHeight)!==object.sourceLines)throw Error('Native line count differs from source: '+scene.id+'/'+object.id);
    if(native.x<frame.x-.1||native.y<frame.y-.1)throw Error('Negative native text overflow: '+scene.id+'/'+object.id);
    const right=Math.max(0,native.x+native.w-frame.x-frame.w),bottom=Math.max(0,native.y+native.h-frame.y-frame.h);
    if(object.componentCentered&&right>.1)throw Error('Native text exceeds centered component');
    if(right>.1){frame.w+=right+.5;frame.rightInset=(frame.rightInset||0)+right+.5;}
    if(bottom>.1)frame.h+=bottom+.5;
    records.push({slide:scene.id,id:object.id,right,bottom,frame:{...frame}});
  }
  return records;
}
module.exports={render,containTextFrames};
