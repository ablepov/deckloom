// Source OpenType transport. No font-family-specific names, coefficients or aliases.
const { createHash } = require('node:crypto');
const { JSZip, DOMParser, XMLSerializer } = require('./vendor/pptx/backend.cjs');
const { fail } = require('./runtime.cjs');
const P='http://schemas.openxmlformats.org/presentationml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const CT='http://schemas.openxmlformats.org/package/2006/content-types';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const reject=message=>{throw fail('PPTX_FONT_INVALID',message);};
function inspect(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>16*1024*1024)reject('Invalid font bytes/budget');
  if(bytes.readUInt32BE(0)!==0x10000)reject('Source profile requires static TrueType outlines; prepare other formats explicitly');
  const count=bytes.readUInt16BE(4),tables=new Map();
  if(!count||count>128||12+count*16>bytes.length)reject('Invalid SFNT directory');
  for(let i=0;i<count;i++){
    const at=12+i*16,tag=bytes.toString('ascii',at,at+4),offset=bytes.readUInt32BE(at+8),length=bytes.readUInt32BE(at+12);
    if(tables.has(tag)||offset+length>bytes.length||offset<12+count*16)reject('Invalid SFNT table '+tag);
    tables.set(tag,bytes.subarray(offset,offset+length));
  }
  const table=(tag,min)=>{const value=tables.get(tag);if(!value||value.length<min)reject('Missing/truncated '+tag);return value;};
  if(tables.has('fvar'))reject('Variable fonts require a pinned source instance before PPTX transport');
  const name=table('name',6),head=table('head',54),os2=table('OS/2',78),hhea=table('hhea',36);
  table('glyf',0);table('hmtx',4);table('cmap',4);
  const records=name.readUInt16BE(2),strings=name.readUInt16BE(4),names={};
  if(6+records*12>name.length)reject('Invalid name table');
  const ranked=new Map();
  for(let i=0;i<records;i++){
    const at=6+i*12,platform=name.readUInt16BE(at),encoding=name.readUInt16BE(at+2),language=name.readUInt16BE(at+4),id=name.readUInt16BE(at+6),length=name.readUInt16BE(at+8),offset=strings+name.readUInt16BE(at+10);
    if(offset+length>name.length)reject('Invalid font name range');
    if(![1,2,3,4,5,6,16,17].includes(id)||![0,3].includes(platform))continue;
    if(platform===3&&![1,10].includes(encoding))continue;
    if(length%2)reject('Invalid UTF-16 font name');
    const text=Buffer.from(name.subarray(offset,offset+length)).swap16().toString('utf16le');
    const rank=platform===3&&language===0x409?3:platform===0?2:1;
    if(rank>(ranked.get(id)||0)){names[id]=text;ranked.set(id,rank);}
  }
  if([1,2,4,5,6].some(id=>!names[id]||names[id].includes('\0')))reject('Missing/invalid source identity');
  const flags=os2.readUInt16BE(62),permissions=os2.readUInt16BE(8),weight=os2.readUInt16BE(4),italic=!!(flags&1),bold=!!(flags&32);
  if(permissions&0x202 || ((permissions&0x0e)!==0 && !(permissions&8)))throw fail('PPTX_FONT_EMBEDDING_DENIED','Font does not allow editable outline embedding');
  const unitsPerEm=head.readUInt16BE(18);
  if(unitsPerEm<16||unitsPerEm>16384||weight<1||weight>1000)reject('Invalid font metrics');
  if(!!(head.readUInt16BE(44)&1)!==bold||!!(head.readUInt16BE(44)&2)!==italic)reject('Inconsistent source style linkage');
  const slot=bold&&italic?'boldItalic':bold?'bold':italic?'italic':'regular';
  return {sha256:sha256(bytes),names,family:names[16]||names[1],typeface:names[1],weight,italic,bold,slot,unitsPerEm,permissions,ascent:hhea.readInt16BE(4),descent:hhea.readInt16BE(6),lineGap:hhea.readInt16BE(8),tables};
}
function eot(bytes,font=inspect(bytes)){
  const os2=font.tables.get('OS/2'),head=font.tables.get('head'),header=Buffer.alloc(80);
  header.writeUInt32LE(bytes.length,4);header.writeUInt32LE(0x20002,8);
  os2.copy(header,16,32,42);header[26]=1;header[27]=font.italic?1:0;
  header.writeUInt32LE(font.weight,28);header.writeUInt16LE(font.permissions,32);header.writeUInt16LE(0x504c,34);
  for(let i=0;i<4;i++)header.writeUInt32LE(os2.readUInt32BE(42+i*4),36+i*4);
  for(let i=0;i<2;i++)header.writeUInt32LE(os2.length>=86?os2.readUInt32BE(78+i*4):0,52+i*4);
  header.writeUInt32LE(head.readUInt32BE(8),60);
  const strings=[1,2,5,4].map(id=>{const value=Buffer.from(font.names[id],'utf16le'),prefix=Buffer.alloc(4);if(value.length>65535)reject('Font name too long');prefix.writeUInt16LE(value.length,2);return Buffer.concat([prefix,value]);});
  const extension=Buffer.alloc(24);extension.writeUInt32LE(0x50475342,4);
  const result=Buffer.concat([header,...strings,extension,bytes]);result.writeUInt32LE(result.length,0);return result;
}
function catalog(specifications){
  if(!Array.isArray(specifications)||!specifications.length||specifications.length>32)reject('Invalid source font catalog');
  const keys=new Set(),slots=new Map();
  return specifications.map(spec=>{
    if(!spec||typeof spec.family!=='string'||!spec.family.trim())reject('Missing CSS font family');
    if(!Buffer.isBuffer(spec.bytes)&&!(spec.bytes instanceof Uint8Array))reject('Missing source font bytes');
    const bytes=Buffer.from(spec.bytes),metadata=inspect(bytes);
    if(spec.sha256!==metadata.sha256)throw fail('PPTX_FONT_HASH_MISMATCH','Prepared source font hash mismatch');
    const key=`${spec.family.toLowerCase()}/${metadata.weight}/${metadata.italic}`;
    const slot=`${metadata.typeface}/${metadata.slot}`;
    if(keys.has(key)||(slots.has(slot)&&slots.get(slot)!==metadata.sha256))reject('Duplicate or ambiguous source family/style');keys.add(key);slots.set(slot,metadata.sha256);
    return Object.freeze({family:spec.family,bytes,metadata,key});
  });
}
function bind(fonts,run){
  const found=fonts.find(f=>f.family.toLowerCase()===String(run.font).toLowerCase()&&f.metadata.weight===run.weight&&f.metadata.italic===!!run.italic);
  if(!found)throw fail('PPTX_FONT_FACE_MISSING',`No source face for ${run.font}/${run.weight}/${run.italic?'italic':'normal'}`);
  return {fontFace:found.metadata.typeface,bold:found.metadata.bold,italic:found.metadata.italic};
}
function installationConflicts(fonts,installed){
  const conflicts=[];
  for(const source of fonts)for(const face of installed){
    const m=source.metadata;
    if(String(face.typeface).toLowerCase()===m.typeface.toLowerCase()&&face.weight===m.weight&&!!face.italic===m.italic&&face.sha256!==m.sha256){
      conflicts.push({family:source.family,typeface:m.typeface,weight:m.weight,italic:m.italic,expectedSha256:m.sha256,installedSha256:face.sha256,path:face.path,sourceVersion:m.names[5],installedVersion:face.version});
    }
  }
  return conflicts;
}
function runProperties(node,binding,kerning='normal'){
  const A='http://schemas.openxmlformats.org/drawingml/2006/main',doc=node.ownerDocument;
  node.setAttribute('b',binding.bold?'1':'0');node.setAttribute('i',binding.italic?'1':'0');
  // Use a threshold above supported text sizes to disable pair kerning.
  node.setAttribute('kern',kerning==='none'?'400000':'100');
  for(const name of ['latin','ea','cs']){
    let face=Array.from(node.childNodes).find(n=>n.localName===name);
    if(!face){face=doc.createElementNS(A,'a:'+name);node.appendChild(face);}
    face.setAttribute('typeface',binding.fontFace);face.removeAttribute('pitchFamily');face.removeAttribute('charset');
  }
}
async function embed(raw,fonts){
  const zip=await JSZip.loadAsync(raw),parser=new DOMParser(),serializer=new XMLSerializer();
  const doc=parser.parseFromString(await zip.file('ppt/presentation.xml').async('string'),'text/xml'),rels=parser.parseFromString(await zip.file('ppt/_rels/presentation.xml.rels').async('string'),'text/xml'),ct=parser.parseFromString(await zip.file('[Content_Types].xml').async('string'),'text/xml');
  if(doc.getElementsByTagNameNS(P,'embeddedFontLst').length)reject('Existing font bindings must not be overwritten');
  doc.documentElement.setAttribute('embedTrueTypeFonts','1');doc.documentElement.setAttribute('saveSubsetFonts','0');
  const list=doc.createElementNS(P,'p:embeddedFontLst'),families=new Map(),emitted=new Set();
  const def=ct.createElementNS(CT,'Default');def.setAttribute('Extension','fntdata');def.setAttribute('ContentType','application/x-fontdata');ct.documentElement.appendChild(def);
  for(const [i,font]of fonts.entries()){
    const m=font.metadata;let entry=families.get(m.typeface);
    const binding=m.typeface+'/'+m.slot;if(emitted.has(binding))continue;emitted.add(binding);
    if(!entry){entry=doc.createElementNS(P,'p:embeddedFont');const face=doc.createElementNS(P,'p:font');face.setAttribute('typeface',m.typeface);face.setAttribute('panose',m.tables.get('OS/2').subarray(32,42).toString('hex').toUpperCase());face.setAttribute('charset','1');entry.appendChild(face);list.appendChild(entry);families.set(m.typeface,entry);}
    const slot=doc.createElementNS(P,'p:'+m.slot);slot.setAttributeNS(R,'r:id',`rIdSourceFont${i}`);
    const order=['font','regular','bold','italic','boldItalic'];entry.insertBefore(slot,Array.from(entry.childNodes).find(n=>order.indexOf(n.localName)>order.indexOf(m.slot))||null);
    const rel=rels.createElementNS(REL,'Relationship');rel.setAttribute('Id',`rIdSourceFont${i}`);rel.setAttribute('Type',R+'/font');rel.setAttribute('Target',`fonts/source-${i}.fntdata`);rels.documentElement.appendChild(rel);zip.file(`ppt/fonts/source-${i}.fntdata`,eot(font.bytes,m));
  }
  const before=Array.from(doc.documentElement.childNodes).find(n=>n.localName==='defaultTextStyle');doc.documentElement.insertBefore(list,before||null);
  zip.file('ppt/presentation.xml',serializer.serializeToString(doc));zip.file('ppt/_rels/presentation.xml.rels',serializer.serializeToString(rels));zip.file('[Content_Types].xml',serializer.serializeToString(ct));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
function styleKey(fonts,object){
  const first=object.runs[0],font=fonts.find(f=>f.family.toLowerCase()===first.font.toLowerCase()&&f.metadata.weight===first.weight&&f.metadata.italic===!!first.italic);
  if(!font)bind(fonts,first);
  for(const run of object.runs){
    bind(fonts,run);
    const candidate=fonts.find(f=>f.family.toLowerCase()===run.font.toLowerCase()&&f.metadata.weight===run.weight&&f.metadata.italic===!!run.italic);
    if(run.size!==first.size||run.italic!==first.italic||['unitsPerEm','ascent','descent','lineGap'].some(k=>candidate.metadata[k]!==font.metadata[k]))throw fail('PPTX_FONT_METRICS_MIXED','Mixed inline font metrics require a dedicated native reference');
  }
  return sha256(Buffer.from(JSON.stringify([font.metadata.sha256,first.size,object.lineHeight]))).slice(0,20);
}
function textFrame(fonts,object,profile){
  const style=profile?.styles?.find(s=>s.id===styleKey(fonts,object));
  if(!style)throw fail('PPTX_FONT_METRICS_MISSING','Need native reference metrics for the source style');
  const origin=object.componentCentered?object.sourceBox:object;
  const inset=object.sourceBaseline-origin.y-style.baselineOffset;
  const topInset=Math.max(0,inset),y=origin.y+Math.min(0,inset);
  const h=Math.max(origin.h,topInset+style.boundTop+style.boundHeight+(object.sourceLines-1)*object.lineHeight+.5);
  return {x:origin.x,y,w:origin.w,h,topInset,rightInset:0,fontStyleId:style.id,logicalFrame:{x:object.x,y:object.y,w:object.w,h:object.h}};
}
module.exports={inspect,eot,catalog,bind,installationConflicts,runProperties,embed,styleKey,textFrame};
