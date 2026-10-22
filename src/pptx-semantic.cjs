// Measured semantic DOM capture. Consumers supply roles; no brand selectors here.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
function measure(hints) {
  const root = document.querySelector(hints.root);
  if (!root) throw Error('Missing slide');
  if(Math.abs(root.getBoundingClientRect().x)>.01||Math.abs(root.getBoundingClientRect().y)>.01)throw Error('Slide root must start at viewport origin');
  const errors = [], coverage = new Set(), elements = [], groups = [];
  const rgba = value => {
    const a = value.match(/[\d.]+/g)?.map(Number);
    if (!a || a.length < 3) throw Error('Unsupported color ' + value);
    return { color: a.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join(''), alpha: a[3] ?? 1 };
  };
  const box = r => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  const bounds = el => box(el.getBoundingClientRect());
  function flowRight(el,depth=0){
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),width=el.computedStyleMap?.().get('width')?.toString();
    if(el===root||depth>32||width!=='auto')return r.right;
    const parent=el.parentElement,ps=getComputedStyle(parent);
    let right=r.right;
    const aligned=['auto','normal','stretch','flex-start','start'].includes(s.alignSelf);
    if(['flex','inline-flex'].includes(ps.display)&&ps.flexDirection==='column'&&aligned&&['flex-start','start','stretch','normal'].includes(ps.alignItems)){
      right=flowRight(parent,depth+1)-parseFloat(ps.borderRightWidth)-parseFloat(ps.paddingRight)-parseFloat(s.marginRight);
    }else if(['flex','inline-flex'].includes(ps.display)&&ps.flexDirection==='row'&&ps.flexWrap==='nowrap'){
      const siblings=Array.from(parent.children).filter(n=>getComputedStyle(n).display!=='none'),next=siblings[siblings.indexOf(el)+1];
      right=next?next.getBoundingClientRect().left-(parseFloat(ps.columnGap)||0)-parseFloat(s.marginRight):flowRight(parent,depth+1)-parseFloat(ps.borderRightWidth)-parseFloat(ps.paddingRight)-parseFloat(s.marginRight);
    }else if(ps.display==='block')right=flowRight(parent,depth+1)-parseFloat(ps.borderRightWidth)-parseFloat(ps.paddingRight)-parseFloat(s.marginRight);
    const max=el.computedStyleMap?.().get('max-width')?.toString();
    if(max?.endsWith('px'))right=Math.min(right,r.x+parseFloat(max));
    return Math.max(r.right,right);
  }
  const imageBounds = (el,s,r) => {
    let left=0,right=0,top=0,bottom=0;
    if(s.boxShadow!=='none')for(const shadow of s.boxShadow.match(/(?:rgba?\([^)]+\)|[^,])+/g)||[]){
      if(shadow.includes('inset'))continue;
      const parts=(shadow.match(/[-+]?(?:\d*\.)?\d+px/g)||[]).map(parseFloat);
      if(parts.length<2||parts.length>4)throw Error('Unsupported image shadow');
      const [x,y,blur=0,spread=0]=parts,extent=Math.max(0,blur*2+spread);
      left=Math.max(left,extent-x);right=Math.max(right,extent+x);top=Math.max(top,extent-y);bottom=Math.max(bottom,extent+y);
    }
    const x=Math.max(0,Math.floor(r.x-left)),y=Math.max(0,Math.floor(r.y-top));
    return {sourceBox:r,x,y,w:Math.min(root.clientWidth,Math.ceil(r.x+r.w+right))-x,h:Math.min(root.clientHeight,Math.ceil(r.y+r.h+bottom))-y};
  };
  const opacity = el => { let a = 1; for (let p = el; p; p = p.parentElement) a *= Number(getComputedStyle(p).opacity); return a; };
  const styleRun = el => {
    const s = getComputedStyle(el), c = rgba(s.color);
    return { font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), weight: Number(s.fontWeight), size: parseFloat(s.fontSize), color: c.color, alpha: c.alpha * opacity(el), italic: s.fontStyle === 'italic', underline: s.textDecorationLine.includes('underline'), spacing: s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing) };
  };
  const processText = (el, id) => {
    const s = getComputedStyle(el), r = bounds(el), border = ['Top','Right','Bottom','Left'].map(x => parseFloat(s['border'+x+'Width'])), pad = ['Top','Right','Bottom','Left'].map(x => parseFloat(s['padding'+x]));
    let runs = [];const visibleRects=[];
    function walk(node) {
      if (node.nodeType === 3) {
        coverage.add(node);
        const parent = node.parentElement, st = getComputedStyle(parent);
        if(st.visibility!=='visible'||opacity(parent)===0)return;
        if(!['normal','nowrap','pre-line','pre','pre-wrap'].includes(st.whiteSpace))throw Error('Unsupported white-space inside text block: '+st.whiteSpace);
        let text = node.textContent;
        if (['normal','nowrap'].includes(st.whiteSpace))text=text.replace(/[\t\n\r\f ]+/g,' ');
        else if(st.whiteSpace==='pre-line')text=text.replace(/\r\n?/g,'\n').replace(/[\t\f ]+/g,' ');
        else if(text.includes('\t'))throw Error('Preserved tabs require native tab-stop support');
        if (st.textTransform === 'uppercase') text = text.toLocaleUpperCase('ru');
        else if (st.textTransform === 'lowercase') text = text.toLocaleLowerCase('ru');
        else if (st.textTransform !== 'none') throw Error('Unsupported text transform');
        if (text) {
          runs.push({ text, ...styleRun(parent), collapsible:['normal','nowrap','pre-line'].includes(st.whiteSpace) });
          const range=document.createRange();range.selectNodeContents(node);visibleRects.push(...Array.from(range.getClientRects()).filter(r=>r.width>.1));
        }
      } else if (node.nodeType === 1) {
        if(getComputedStyle(node).display==='none'||opacity(node)===0)return;
        if (node.tagName === 'BR') runs.push({ text: '\n', ...styleRun(node.parentElement),collapsible:true });
        else {
          if (node !== el && !['SPAN','STRONG','B','EM','I','U','A'].includes(node.tagName)) throw Error('Non-inline child inside text block');
          for (const child of node.childNodes) walk(child);
        }
      }
    }
    walk(el);
    // Collapse across inline style boundaries, independently of visual soft wraps.
    // A space at a browser wrap remains an authored separator when text is edited.
    const normalized=[];let pending=null,lineStart=true;
    function append(source,text){
      if(normalized.at(-1)?.source===source)normalized.at(-1).text+=text;
      else normalized.push({source,text});
    }
    for(const run of runs)for(const ch of run.text){
      if(run.collapsible&&ch===' '){if(!lineStart)pending=pending||run;continue;}
      if(ch==='\n'){pending=null;append(run,ch);lineStart=true;continue;}
      if(pending){append(pending,' ');pending=null;}
      append(run,ch);lineStart=false;
    }
    runs=normalized.map(({source,text})=>{const {collapsible,...style}=source;return {...style,text};});
    const base=styleRun(el);
    if(runs.some(run=>run.font.toLowerCase()!==base.font.toLowerCase()||run.size!==base.size||run.italic!==base.italic))throw Error('Mixed inline font metrics require a dedicated native reference');
    const lineHeight = parseFloat(s.lineHeight);
    if (!Number.isFinite(lineHeight)) throw Error('Text requires explicit line-height');
    const content = { x:r.x+border[3]+pad[3], y:r.y+border[0]+pad[0], w:r.w-border[1]-border[3]-pad[1]-pad[3], h:r.h-border[0]-border[2]-pad[0]-pad[2] };
    const measuredContent={...content};
    const authoredWidth=el.computedStyleMap?.().get('width')?.toString();
    // An auto-width child in a column can grow to the column width before wrapping.
    // Its current shrink-to-fit DOM rectangle is not that authoring constraint.
    if(authoredWidth==='auto')content.w=Math.max(content.w,flowRight(el)-content.x-pad[1]-border[1]);
    // Range measures are diagnostics only; a line never becomes a native object.
    const rects=visibleRects;
    if(!rects.length)throw Error('Text block has no visible glyph range');
    const lineTops = [...new Set(rects.map(r => +r.top.toFixed(1)))];
    const canvas=document.createElement('canvas').getContext('2d');canvas.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const metrics=canvas.measureText(runs.map(r=>r.text).join(''));
    const sourceBaseline=rects[0].top+metrics.fontBoundingBoxAscent;
    const intrinsicLabel=['nowrap','pre'].includes(s.whiteSpace)||!!(hints.intrinsicText && el.matches(hints.intrinsicText) && lineTops.length===1);
    const componentCentered=!!(hints.centeredText && el.matches(hints.centeredText));
    return { id:id+'--text', kind:'text', sourceBox:r, measuredContent, authoredWidth, ...content, padding:pad, lineHeight, sourceBaseline, align: componentCentered?'center':({start:'left',end:'right'}[s.textAlign]||s.textAlign), componentCentered, kerning:s.fontKerning, sourceTextRects:rects.map(box), whiteSpace:s.whiteSpace, intrinsicLabel, runs, sourceLines:lineTops.length, sourceClass:el.className };
  };
  let index = 0;
  function visit(el, parentGroups = []) {
    const s = getComputedStyle(el), r = bounds(el);
    if (s.display === 'none' || s.visibility !== 'visible' || !r.w || !r.h || opacity(el) === 0) return;
    const id = `node-${++index}`;
    el.setAttribute('data-pptx-probe-id', id);
    if (hints.atomic && el.matches(hints.atomic)) {
      if(el===root)throw Error('Whole-slide raster fallback is not a semantic scene');
      elements.push({id,kind:'atomic-image',...imageBounds(el,s,r),sourceClass:el.className,groupIds:parentGroups,containsText:true}); return;
    }
    if (hints.imageComponents && el.matches(hints.imageComponents)) {
      if(el.textContent.trim() || !(el.matches('img,svg')||el.querySelector('img,svg')))throw Error('Invalid image component: '+el.className);
      elements.push({id,kind:'component-image',...imageBounds(el,s,r),sourceClass:el.className,groupIds:parentGroups,containsText:false});return;
    }
    if (el !== root && el.matches('img,svg')) {
      elements.push({id,kind:el.tagName.toLowerCase()==='svg'?'svg-image':'image',...r,sourceClass:el.getAttribute('class'),groupIds:parentGroups,alpha:opacity(el),fit:s.objectFit,position:s.objectPosition,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,source:el.currentSrc||el.getAttribute('src')}); return;
    }
    if (s.transform !== 'none') throw Error('Transform outside an atomic scene: '+el.className);
    if (s.backgroundImage !== 'none' || s.boxShadow !== 'none' || s.filter !== 'none' || s.clipPath !== 'none') throw Error('Unclassified paint effect: '+el.className);
    for (const pseudo of ['::before','::after']) {
      const ps=getComputedStyle(el,pseudo);
      if (!['none','normal','""'].includes(ps.content) && ps.display!=='none') throw Error('Unclassified pseudo: '+el.className+pseudo);
    }
    let currentGroups=parentGroups;
    if (hints.groups && el.matches(hints.groups)) { groups.push({id, ...r, parent:parentGroups.at(-1)||null, sourceClass:el.className});currentGroups=[...parentGroups,id]; }
    const bg=rgba(s.backgroundColor), widths=['Top','Right','Bottom','Left'].map(k=>parseFloat(s['border'+k+'Width']));
    if (el!==root && (bg.alpha || widths.some(w=>w>0))) {
      const radii=['TopLeft','TopRight','BottomRight','BottomLeft'].map(k=>parseFloat(s['border'+k+'Radius']));
      if (!radii.every(n=>n===radii[0]) || !widths.every(n=>n===widths[0])) throw Error('Nonuniform corners/borders need a capability');
      const stroke=rgba(s.borderTopColor);
      elements.push({id:id+'--paint',kind:'shape',...r,fill:bg.color,alpha:bg.alpha*opacity(el),radius:radii[0],lineWidth:widths[0],lineColor:stroke.color,lineAlpha:stroke.alpha*opacity(el),groupIds:currentGroups,sourceClass:el.className});
    }
    if (el.matches(hints.text)) { elements.push({...processText(el,id),groupIds:currentGroups}); return; }
    // These slides have ordinary flow and positioned siblings; reject unsupported effects above.
    const children=Array.from(el.children).map((child,i)=>({child,i,z:Number(getComputedStyle(child).zIndex)||0})).sort((a,b)=>a.z-b.z||a.i-b.i);
    for (const {child} of children) visit(child,currentGroups);
  }
  visit(root);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()) {
    if (!node.textContent.trim() || (hints.atomic && node.parentElement.closest(hints.atomic)) || node.parentElement.closest('svg,style,script')) continue;
    if (!coverage.has(node) && getComputedStyle(node.parentElement).visibility==='visible' && node.parentElement.getClientRects().length && opacity(node.parentElement)>0) errors.push('Uncovered text: '+node.textContent.slice(0,70));
  }
  return {width:root.clientWidth,height:root.clientHeight,background:rgba(getComputedStyle(root).backgroundColor),elements,groups,errors};
}
async function imageBytes(page, id, object) {
  return page.evaluate(async ({id,svg}) => {
    const el=document.querySelector(`[data-pptx-probe-id="${id}"]`);
    let source=el.currentSrc;
    if (svg) {
      const clone=el.cloneNode(true), original=[el,...el.querySelectorAll('*')], copies=[clone,...clone.querySelectorAll('*')];
      for(let i=0;i<original.length;i++) for(const prop of ['fill','stroke','stroke-width','color','flood-color','flood-opacity','stop-color','stop-opacity']) copies[i].style.setProperty(prop,getComputedStyle(original[i]).getPropertyValue(prop));
      clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
      source='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))));
    }
    const image=new Image();image.src=source;await image.decode();
    if (!svg && /^data:image\/(png|jpeg);base64,/.test(source)) return {data:source,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,rasterized:false};
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(el.getBoundingClientRect().width*4));canvas.height=Math.max(1,Math.ceil(el.getBoundingClientRect().height*4));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    return {data:canvas.toDataURL('image/png'),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,rasterized:true};
  },{id,svg:object.kind==='svg-image'});
}
async function capture(slides, output, hints, viewport, options={}) {
  if(!Array.isArray(slides)||!slides.length||!hints?.root||!viewport||!Number.isInteger(viewport.width)||!Number.isInteger(viewport.height))throw Error('Semantic capture requires slides, explicit roles and viewport');
  await fs.mkdir(path.join(output,'assets'),{recursive:true});
  const browser=await chromium.launch({headless:true}), scenes=[];
  const abort=()=>{browser.close().catch(()=>{})};
  options.signal?.addEventListener('abort',abort,{once:true});
  try {
    if(options.signal?.aborted)throw Error('Semantic capture cancelled');
    const page=await browser.newPage({viewport,deviceScaleFactor:2});
    await page.emulateMedia({media:'screen',reducedMotion:'reduce'});
    for(const record of slides) {
      await page.goto(pathToFileURL(record.html).href);await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
      const scene=await page.evaluate(measure,hints);scene.id=record.id;scene.sourceHtml=record.html;
      if(scene.errors.length)throw Error(JSON.stringify(scene.errors));
      for(const object of scene.elements.filter(o=>o.kind.includes('image'))) {
        let data;
        if(['atomic-image','component-image'].includes(object.kind)) {
          const style=await page.addStyleTag({content:`html,body{background:transparent!important}*{visibility:hidden!important}[data-pptx-probe-id="${object.id}"],[data-pptx-probe-id="${object.id}"] *{visibility:visible!important}`});
          try { data=await page.screenshot({clip:{x:object.x,y:object.y,width:object.w,height:object.h},omitBackground:true}); }
          finally {await style.evaluate(el=>el.remove());}
          object.mime='image/png';object.rasterized=true;
        } else {
          const result=await imageBytes(page,object.id,object);const match=result.data.match(/^data:(image\/[^;]+);base64,(.*)$/s);if(!match)throw Error('Invalid picture data');
          object.mime=match[1];data=Buffer.from(match[2],'base64');object.naturalWidth=result.naturalWidth;object.naturalHeight=result.naturalHeight;object.rasterized=result.rasterized;
        }
        object.sha256=createHash('sha256').update(data).digest('hex');object.asset=`assets/${object.sha256.slice(0,20)}.${object.mime==='image/jpeg'?'jpg':'png'}`;delete object.source;
        await fs.writeFile(path.join(output,object.asset),data);
      }
      scenes.push(scene);const event={slide:scene.id,textBlocks:scene.elements.filter(o=>o.kind==='text').length,shapes:scene.elements.filter(o=>o.kind==='shape').length,pictures:scene.elements.filter(o=>o.kind.includes('image')).length,groups:scene.groups.length};
      if(options.onProgress)await options.onProgress({...event,completed:scenes.length,total:slides.length});else console.log(JSON.stringify(event));
    }
  } finally {options.signal?.removeEventListener('abort',abort);await browser.close();}
  await fs.writeFile(path.join(output,'layered-scenes.json'),JSON.stringify(scenes,null,2));return scenes;
}
module.exports={capture,measure};
