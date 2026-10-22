const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fonts=require('../src/pptx-fonts.cjs');
const {PptxGenJS,JSZip,DOMParser}=require('../src/vendor/pptx/backend.cjs');
const fixture=require('./fixtures/font-transport.json');
const {render}=require('../src/pptx-measured.cjs');
const A='http://schemas.openxmlformats.org/drawingml/2006/main',P='http://schemas.openxmlformats.org/presentationml/2006/main';
const sources=fixture.faces.map(f=>{const bytes=Buffer.from(f.data,'base64');return{family:'Example Sans',bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
test('source faces retain identity, exact metrics and actual style linkage',()=>{
  const catalog=fonts.catalog(sources);
  assert.deepEqual(catalog.map(f=>[f.metadata.weight,f.metadata.italic,f.metadata.unitsPerEm,f.metadata.slot]),[[400,false,1000,'regular'],[700,false,1000,'bold'],[400,true,1000,'italic']]);
  assert.deepEqual(fonts.bind(catalog,{font:'EXAMPLE SANS',weight:700}),{fontFace:'Example Sans',bold:true,italic:false});
  assert.equal(fonts.bind(catalog,{font:'Example Sans',weight:400,italic:true}).italic,true);
  assert.throws(()=>fonts.bind(catalog,{font:'Example Sans',weight:600}),e=>e.code==='PPTX_FONT_FACE_MISSING');
  assert.throws(()=>fonts.catalog([{...sources[0],sha256:'0'.repeat(64)}]),e=>e.code==='PPTX_FONT_HASH_MISMATCH');
  assert.throws(()=>fonts.catalog([sources[0],sources[0]]),/ambiguous/);
  const installed={...catalog[0].metadata,typeface:'example sans',path:'registered.ttf',version:'old'};
  assert.deepEqual(fonts.installationConflicts(catalog,[installed]),[]);
  assert.equal(fonts.installationConflicts(catalog,[{...installed,sha256:'different'}]).length,1);
});

test('measured render embeds a case-insensitive CSS family without altering source size',async()=>{
  const catalog=fonts.catalog(sources),run={font:'example sans',weight:400,size:32,italic:false,text:'AV',color:'000000',alpha:1,spacing:0};
  const object={id:'text',kind:'text',x:20,y:20,w:200,h:40,sourceBaseline:48,lineHeight:40,sourceLines:1,align:'left',runs:[run],groupIds:[]};
  const key=fonts.styleKey(catalog,object);
  const profile={styles:[{id:key,baselineOffset:28,boundTop:0,boundHeight:40}]};
  const result=await render([{width:960,height:540,background:{color:'ffffff'},elements:[object],groups:[]}],{directory:__dirname,fonts:catalog,profile});
  const zip=await JSZip.loadAsync(result.bytes);
  assert.equal(Object.keys(zip.files).filter(p=>p.endsWith('.fntdata')).length,1);
  assert.equal(result.conversion.fonts.length,1);
  const doc=new DOMParser().parseFromString(await zip.file('ppt/slides/slide1.xml').async('string'),'text/xml');
  assert.equal(doc.getElementsByTagNameNS(A,'rPr')[0].getAttribute('sz'),'2400');
  assert.throws(()=>fonts.styleKey(catalog,{...object,runs:[run,{...run,size:48}]}),e=>e.code==='PPTX_FONT_METRICS_MIXED');
});
test('font transport rejects malformed tables and restricted editing rights',()=>{
  assert.throws(()=>fonts.inspect(Buffer.alloc(8)),/font bytes/);
  const invalid=Buffer.from(sources[0].bytes);invalid.writeUInt32BE(0xffffffff,20);
  assert.throws(()=>fonts.inspect(invalid),/SFNT table/);
  const restricted=Buffer.from(sources[0].bytes);
  for(let at=12;at<12+restricted.readUInt16BE(4)*16;at+=16)if(restricted.toString('ascii',at,at+4)==='OS/2')restricted.writeUInt16BE(2,restricted.readUInt32BE(at+8)+8);
  assert.throws(()=>fonts.inspect(restricted),e=>e.code==='PPTX_FONT_EMBEDDING_DENIED');
});
test('EOT preserves original font bytes and names; OOXML groups RIBBI slots in schema order',async()=>{
  const catalog=fonts.catalog([sources[1],sources[0],sources[2]]);
  const wrapped=fonts.eot(sources[0].bytes);
  assert.equal(wrapped.readUInt32LE(0),wrapped.length);assert.equal(wrapped.readUInt32LE(4),sources[0].bytes.length);
  assert.deepEqual(wrapped.subarray(-sources[0].bytes.length),sources[0].bytes);
  let offset=80;const names=[];
  for(let i=0;i<4;i++){assert.equal(wrapped.readUInt16LE(offset),0);const n=wrapped.readUInt16LE(offset+2);names.push(wrapped.subarray(offset+4,offset+4+n).toString('utf16le'));offset+=4+n;}
  assert.deepEqual(names,['Example Sans','Regular','Version 1.0','Example Sans Regular']);
  const deck=new PptxGenJS();deck.addSlide().addText('AV',{x:1,y:1,w:2,h:1});
  const bytes=await fonts.embed(await deck.write({outputType:'nodebuffer'}),catalog);
  const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('ppt/presentation.xml').async('string'),'text/xml');
  const entries=doc.getElementsByTagNameNS(P,'embeddedFont');assert.equal(entries.length,1);
  assert.deepEqual(Array.from(entries[0].childNodes).map(n=>n.localName),['font','regular','bold','italic']);
  assert.equal(Object.keys(zip.files).filter(p=>p.endsWith('.fntdata')).length,3);
  const run=new DOMParser().parseFromString(`<a:rPr xmlns:a="${A}" sz="2400" spc="83"><a:latin typeface="Arial" charset="0"/></a:rPr>`,'text/xml').documentElement;
  fonts.runProperties(run,fonts.bind(catalog,{font:'Example Sans',weight:700}),'normal');
  assert.equal(run.getAttribute('sz'),'2400');assert.equal(run.getAttribute('spc'),'83');assert.equal(run.getAttribute('b'),'1');assert.equal(run.getAttribute('kern'),'100');
  assert.equal(run.getElementsByTagNameNS(A,'latin')[0].getAttribute('typeface'),'Example Sans');
});
