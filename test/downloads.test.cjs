const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{chromium}=require('playwright'),{PDFDocument}=require('pdf-lib');
const {createReviewServer,createRenderer}=require('../src/index.cjs');
const fontTransport=require('../src/pptx-fonts.cjs'),{JSZip,DOMParser}=require('../src/vendor/pptx/backend.cjs');
const fixture=require('./fixtures/font-transport.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function setup(t){
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'deckloom-menu-test-')),root=path.join(parent,'source');await fs.mkdir(root);
  t.after(async()=>{assert(path.dirname(parent)===os.tmpdir());await fs.rm(parent,{recursive:true,force:true,maxRetries:5});});
  const bytes=Buffer.from(fixture.faces[0].data,'base64'),file=path.join(root,'font.ttf'),licenseFile=path.join(root,'LICENSE.txt');
  await fs.writeFile(file,bytes);const license=await fs.readFile(path.join(__dirname,'../LICENSE'));await fs.writeFile(licenseFile,license);
  const fonts=fontTransport.catalog([{family:'Example Sans',bytes,sha256:sha(bytes)}]);
  const style={runs:[{font:'Example Sans',weight:400,size:32,italic:false}],lineHeight:40};
  const metrics=Buffer.from(JSON.stringify({provider:'test-reference',styles:[{id:fontTransport.styleKey(fonts,style),baselineOffset:26,boundTop:0,boundHeight:40}]}));
  const metricsFile=path.join(root,'metrics.json');await fs.writeFile(metricsFile,metrics);
  const project={contractVersion:1,id:'download-test',mode:'registered',root,
    viewer:{storagePrefix:'downloads-test'},
    downloads:{pptx:{profile:'semantic-source-v1',roles:{root:'main',text:'p'},fonts:[{family:'Example Sans',file,sha256:sha(bytes),licenseFile,licenseSha256:sha(license),redistributable:true}],metrics:{file:metricsFile,sha256:sha(metrics)}}},
    decks:[{id:'first',label:'Первая колода',width:960,height:540,slides:[{id:'same',data:{text:'AV'}},{id:'end',data:{text:'VA'}}]},
      {id:'second',label:'Вторая колода',width:960,height:540,slides:[{id:'same',data:{text:'To'}}]},
      {id:'empty',label:'Пустая колода',width:960,height:540,slides:[]}],
    renderDocument(deck,slide){return `<!doctype html><html><meta charset="utf-8"><style>@font-face{font-family:'Example Sans';src:url(data:font/ttf;base64,${bytes.toString('base64')})}html,body{margin:0}main{width:960px;height:540px;background:#fff}p{position:absolute;left:48px;top:48px;width:600px;margin:0;font:32px/40px 'Example Sans'}</style><main class="slide"><p>${slide.data.text}</p></main></html>`;}
  };
  const server=createReviewServer(project);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(url)).text();
  const token=JSON.parse(html.match(/window.deckloomConfig = (.*?);/)[1]).downloadToken;
  const post=(body,headers={})=>fetch(url+'/api/downloads',{method:'POST',headers:{'Content-Type':'application/json','X-Deckloom-Token':token,...headers},body:JSON.stringify(body)});
  async function wait(job){assert.equal(typeof job.id,'string',JSON.stringify(job));const deadline=Date.now()+90000;while(Date.now()<deadline){const r=await fetch(url+'/api/downloads/'+job.id);assert.equal(r.status,200);job=await r.json();if(['complete','failed'].includes(job.state))return job;await new Promise(r=>setTimeout(r,100));}throw Error('Download timeout '+JSON.stringify(job))}
  return{project,url,post,wait,file};
}
async function texts(bytes){
  const zip=await JSZip.loadAsync(bytes),parts=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));
  return Promise.all(parts.sort().map(async n=>{const doc=new DOMParser().parseFromString(await zip.file(n).async('string'),'text/xml');return Array.from(doc.getElementsByTagName('a:t')).map(t=>t.textContent).join('')}));
}
test('download API exports the selected whole deck and packages exact licensed source fonts',async t=>{
  const f=await setup(t);
  assert.equal((await f.post({deckId:'first',format:'pdf'},{'X-Deckloom-Token':'wrong'})).status,403);
  assert.equal((await f.post({deckId:'first',format:'pdf'},{Origin:'https://other.invalid'})).status,403);
  assert.equal((await f.post({deckId:'missing',format:'pdf'})).status,404);
  assert.equal((await f.post({deckId:'first',format:'google'})).status,400);
  assert.equal((await f.post({deckId:'first',format:'pdf',outputRoot:'C:/secret'})).status,400);
  assert.equal((await f.post({deckId:'empty',format:'pdf'})).status,400);
  const started=await f.post({deckId:'first',format:'pdf'});assert.equal(started.status,202);let job=await started.json();
  assert.equal((await f.post({deckId:'second',format:'pdf'})).status,409);
  assert.equal((await fetch(f.url+`/api/downloads/${job.id}/file`)).status,404);
  job=await f.wait(job);assert.equal(job.state,'complete',JSON.stringify(job));
  const pdf=await fetch(f.url+job.url);assert.match(pdf.headers.get('content-disposition'),/first.pdf/);
  assert.equal((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount(),2);
  job=await f.wait(await(await f.post({deckId:'second',format:'pptx'})).json());assert.equal(job.state,'complete',JSON.stringify(job));
  assert.deepEqual(await texts(Buffer.from(await(await fetch(f.url+job.url)).arrayBuffer())),['To']);
  job=await f.wait(await(await f.post({deckId:'first',format:'pptx-fonts'})).json());assert.equal(job.state,'complete',JSON.stringify(job));
  const response=await fetch(f.url+job.url);assert.equal(response.headers.get('content-type'),'application/zip');
  const zip=await JSZip.loadAsync(await response.arrayBuffer());assert.deepEqual(await texts(await zip.file('presentation.pptx').async('nodebuffer')),['AV','VA']);
  const manifest=JSON.parse(await zip.file('fonts.json').async('string'));assert.equal(manifest.fonts.length,1);
  assert.equal(sha(await zip.file(manifest.fonts[0].file).async('nodebuffer')),sha(await fs.readFile(f.file)));
  assert.equal(Object.keys(zip.files).filter(n=>n.startsWith('licenses/')&&!zip.files[n].dir).length,1);
  assert.match(await zip.file('Прочитать.txt').async('string'),/другая версия/);
  assert.ok(!JSON.stringify(job).includes(os.tmpdir()));
  await fs.appendFile(f.file,'changed');
  job=await f.wait(await(await f.post({deckId:'first',format:'pptx'})).json());assert.equal(job.state,'failed');assert.equal(job.error.code,'DOWNLOAD_RESOURCE_CHANGED');assert.ok(!job.url);
  assert.equal((await fetch(f.url+`/api/downloads/${job.id}/file`)).status,404);
});
test('download menu keyboard, mobile, disabled Google and selection pinning work in the browser',async t=>{
  const f=await setup(t);for(const deckId of ['first','second']){const rendered=await createRenderer(f.project).render({deckId});assert.equal(rendered.status,'succeeded');}
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.url);const button=page.getByRole('button',{name:'Скачать выбранную колоду',exact:true});await page.waitForFunction(()=>!document.querySelector('#downloadButton').disabled);
  await button.focus();await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('menuitem').count(),4);
  assert.equal(await page.getByRole('menuitem',{name:/Google/}).isDisabled(),true);
  assert.equal(await page.locator('#downloadMenu').evaluate(n=>n.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');assert.equal(await button.evaluate(n=>n===document.activeElement),true);assert.equal(await button.getAttribute('aria-expanded'),'false');
  await page.locator('#deckSelect').selectOption('second');await button.click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Скачать PPTX',exact:true}).click();
  await page.locator('#deckSelect').selectOption('first');
  const download=await downloadPromise;assert.equal(download.suggestedFilename(),'second.pptx');assert.deepEqual(await texts(await fs.readFile(await download.path())),['To']);
  await page.setViewportSize({width:375,height:812});await button.click();
  const box=await page.locator('#downloadMenu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=375);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('main').click({position:{x:2,y:2}});assert.equal(await button.getAttribute('aria-expanded'),'false');
  assert.deepEqual(errors,[]);
});
