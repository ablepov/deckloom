const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { createRenderer } = require('./renderer.cjs');
const { normalizeProject } = require('./project.cjs');
const { fail } = require('./runtime.cjs');
const fontTransport = require('./pptx-fonts.cjs');
const { JSZip } = require('./vendor/pptx/backend.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const formats = new Set(['pdf', 'pptx', 'pptx-fonts']);
const reference = { mode:'strict', fonts:{mode:'reference',family:'Arial',profile:'windows-installed-v1'} };

async function pinned(file, sha256, maximum = 16 * 1024 * 1024) {
  if (typeof file !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256 || '')) throw fail('DOWNLOAD_PROFILE_INVALID', 'Export resources require paths and SHA-256 pins');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maximum) throw fail('DOWNLOAD_PROFILE_INVALID', 'Export resource exceeds its file budget');
  const bytes = await fs.readFile(file);
  if (hash(bytes) !== sha256.toLowerCase()) throw fail('DOWNLOAD_RESOURCE_CHANGED', 'An export resource has changed; update the configured profile');
  return bytes;
}

async function sourceFonts(specifications) {
  if (!Array.isArray(specifications) || !specifications.length || specifications.length > 32) throw fail('DOWNLOAD_PROFILE_INVALID', 'Source export requires a bounded font catalog');
  return fontTransport.catalog(await Promise.all(specifications.map(async f => ({family:f.family,bytes:await pinned(f.file,f.sha256),sha256:f.sha256}))));
}

// Distribution permission is explicit adapter metadata. OpenType embedding bits
// alone do not grant redistribution of installable font files.
async function fontArchive(pptx, title, fonts, specifications, usedHashes) {
  const zip = new JSZip(), manifest = [], emitted = new Set();
  zip.file('presentation.pptx', pptx);
  for (const font of fonts.filter(f => usedHashes.has(f.metadata.sha256))) {
    if(emitted.has(font.metadata.sha256))continue;emitted.add(font.metadata.sha256);
    const spec = specifications.find(s => s.sha256.toLowerCase() === font.metadata.sha256 && s.family.toLowerCase() === font.family.toLowerCase());
    if (spec?.redistributable!==true || !spec.licenseFile) throw fail('FONT_REDISTRIBUTION_UNCONFIRMED', 'Installable font distribution is not configured for this presentation');
    const license = await pinned(spec.licenseFile,spec.licenseSha256,1024*1024);
    const filename = `${font.metadata.names[6].replace(/[^a-zA-Z0-9_-]/g,'-')}-${font.metadata.sha256.slice(0,8)}.ttf`;
    zip.file('fonts/'+filename,font.bytes);
    zip.file('licenses/'+hash(license).slice(0,12)+'.txt',license);
    manifest.push({family:font.family,weight:font.metadata.weight,italic:font.metadata.italic,version:font.metadata.names[5],file:'fonts/'+filename,sha256:font.metadata.sha256});
  }
  if (!manifest.length) throw fail('FONT_PACKAGE_UNAVAILABLE','No distributable source fonts are available for this presentation');
  zip.file('fonts.json',JSON.stringify({version:1,fonts:manifest},null,2));
  zip.file('Прочитать.txt',`${title}\r\n\r\nВ presentation.pptx встроены исходные шрифты.\r\nВ папке fonts — полные TTF той же версии для установки. Лицензии находятся в licenses.\r\n\r\nWindows: выделите TTF, откройте контекстное меню и выберите «Установить».\r\nmacOS: откройте TTF в приложении «Шрифты» и выберите установку.\r\nЕсли уже установлена другая версия этого семейства, проверьте её перед заменой.\r\nПосле установки закройте и заново откройте PowerPoint. Архив не меняет шрифты автоматически.\r\nУстановка локальных шрифтов не управляет шрифтами Google Презентаций.\r\n`);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

function createDownloadService(input) {
  input={...input,decks:input.decks.map(deck=>({...deck,...(deck.slides?{slides:deck.slides.map(slide=>({...slide}))}:{})}))};
  const model = normalizeProject(input), config = model.downloads || {};
  const jobs = new Map();let active,base,closed=false;
  const renderer = model.mode === 'registered' && typeof input.renderDocument === 'function' ? createRenderer(input) : null;
  const settings = deckId => ({...config,...(Object.hasOwn(config.decks||{},deckId)?config.decks[deckId]:{})});
  const publicJob = job => ({id:job.id,deckId:job.deckId,label:job.label,format:job.format,state:job.state,progress:job.progress,...(job.state==='complete'?{filename:job.filename,url:`/api/downloads/${job.id}/file`}:{}),...(job.error?{error:{code:job.error.code}}:{} )});
  const capabilities = () => model.decks.map(deck => {
    const cfg=settings(deck.id),source=cfg.pptx?.profile==='semantic-source-v1';
    const referenceCanvas=deck.slides?.every(s=>s.width===deck.width&&s.height===deck.height)&&((deck.width===960&&deck.height===540)||(deck.width===540&&deck.height===960));
    return {deckId:deck.id,pdf:!!renderer&&!!deck.slides?.length,pptx:!!renderer&&!!deck.slides?.length&&(source||(process.platform==='win32'&&referenceCanvas)),fonts:!!renderer&&source&&!!cfg.pptx.fonts?.length&&cfg.pptx.fonts.every(f=>f.redistributable===true&&f.licenseFile)};
  });
  async function remove(job) {
    if(job.directory&&base&&path.dirname(job.directory)===base)await fs.rm(job.directory,{recursive:true,force:true,maxRetries:3});
    jobs.delete(job.id);
  }
  async function build(job) {
    const cfg=settings(job.deckId),semantic=cfg.pptx?.profile==='semantic-source-v1';
    let outcome='failed';
    try {
      base ||= await fs.mkdtemp(path.join(os.tmpdir(),'deckloom-downloads-'));
      job.directory=path.join(base,job.id);await fs.mkdir(job.directory);
      job.state='running';job.progress={stage:'render',completed:0,total:job.total};
      const result=await renderer.export({deckId:job.deckId,outputRoot:path.join(job.directory,'export'),signal:job.controller.signal,
        formats:job.format==='pdf'?['pdf']:semantic?['html']:['pptx'],
        fonts:{policy:cfg.fontPolicy||((job.format!=='pdf'&&!semantic)?'allow-substitution':'strict')},
        ...(!semantic&&job.format!=='pdf'?{pptx:reference}:{}),
        onProgress:event=>{if(event.type==='slide-complete')job.progress={stage:'render',completed:(job.progress.completed||0)+1,total:job.total};}
      });
      if(result.status!=='succeeded')throw Object.assign(new Error(result.error?.message||result.failures?.[0]?.message||'Export failed'),{code:result.error?.code||result.failures?.[0]?.code||'DOWNLOAD_EXPORT_FAILED'});
      let bytes;
      if(job.format==='pdf'||!semantic){
        const output=result.outputs.find(o=>o.format===(job.format==='pdf'?'pdf':'pptx'));
        if(!output)throw fail('DOWNLOAD_EXPORT_FAILED','No export artifact');
        bytes=await fs.readFile(output.file);
      }else{
        job.progress={stage:'pptx',completed:job.total,total:job.total};
        const fonts=await sourceFonts(cfg.pptx.fonts),profile=JSON.parse((await pinned(cfg.pptx.metrics.file,cfg.pptx.metrics.sha256)).toString('utf8'));
        const report=result.reports[job.deckId];
        const sources=report.map(r=>({id:r.slideId||r.slide||r.id,html:r.artifacts.html}));
        const deck=model.decks.find(d=>d.id===job.deckId);
        if(deck.slides.some(s=>s.width!==deck.width||s.height!==deck.height))throw fail('PPTX_UNSUPPORTED_CANVAS','Semantic PPTX requires a uniform slide canvas');
        const directory=path.join(job.directory,'semantic');
        const scenes=await require('./pptx-semantic.cjs').capture(sources,directory,cfg.pptx.roles,{width:deck.width,height:deck.height},{signal:job.controller.signal,onProgress:event=>{job.progress={stage:'pptx',completed:event.completed,total:job.total}}});
        if(job.controller.signal.aborted)throw fail('CANCELLED','Download cancelled');
        const output=await require('./pptx-measured.cjs').render(scenes,{directory,fonts,profile});bytes=output.bytes;
        await fs.writeFile(path.join(job.directory,'conversion.json'),JSON.stringify(output.conversion,null,2));
        if(job.format==='pptx-fonts')bytes=await fontArchive(bytes,job.label,fonts,cfg.pptx.fonts,new Set(output.conversion.fonts.map(f=>f.sha256)));
      }
      if(job.controller.signal.aborted)throw fail('CANCELLED','Download cancelled');
      job.file=path.join(job.directory,job.format==='pptx-fonts'?'download.zip':`download.${job.format}`);
      await fs.writeFile(job.file,bytes);outcome='complete';job.sha256=hash(bytes);job.bytes=bytes.length;
      job.progress={stage:'complete',completed:job.total,total:job.total};
    }catch(error){
      job.error={code:error.code||'DOWNLOAD_FAILED',message:error.message};
      if(process.env.DECKLOOM_DEBUG_EXPORTS==='1')console.error('Deckloom download:',job.error);
      if(job.directory)await fs.writeFile(path.join(job.directory,'failure.json'),JSON.stringify(job.error,null,2)).catch(()=>{});
    }finally{
      for(const name of ['export','semantic'])if(job.directory&&base&&path.dirname(job.directory)===base)await fs.rm(path.join(job.directory,name),{recursive:true,force:true,maxRetries:3}).catch(()=>{});
      job.finished=Date.now();active=null;job.state=outcome;
    }
  }
  function start(body) {
    if(closed)throw fail('DOWNLOAD_CLOSED','Download server is closed');
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['deckId','format'].includes(k))||!formats.has(body.format)||typeof body.deckId!=='string')throw fail('DOWNLOAD_INVALID_REQUEST','Choose one deck and a download format');
    const deck=model.decks.find(d=>d.id===body.deckId);
    if(!deck)throw fail('UNKNOWN_DECK','Unknown deck');
    if(!renderer||!deck.slides?.length)throw fail('DOWNLOAD_UNAVAILABLE','This deck has no renderable slides');
    if(body.format!=='pdf'&&!capabilities().find(c=>c.deckId===body.deckId).pptx)throw fail('PPTX_UNSUPPORTED_CANVAS','PPTX is not configured for this deck');
    if(body.format==='pptx-fonts'&&!capabilities().find(c=>c.deckId===body.deckId).fonts)throw fail('FONT_PACKAGE_UNAVAILABLE','Installable source fonts are not configured for this deck');
    if(active)throw fail('DOWNLOAD_BUSY','Another presentation is being exported');
    if(jobs.size>=8){const oldest=[...jobs.values()].find(j=>j.finished);if(oldest){jobs.delete(oldest.id);remove(oldest).catch(()=>{});}}
    const job={id:randomUUID(),deckId:deck.id,label:deck.label,total:deck.slides.length,format:body.format,state:'queued',controller:new AbortController(),progress:{stage:'render',completed:0,total:deck.slides.length}};
    job.filename=`${deck.id}${body.format==='pptx-fonts'?'-with-fonts.zip':'.'+body.format}`;
    jobs.set(job.id,job);active=job;
    job.promise=Promise.resolve().then(()=>build(job));return publicJob(job);
  }
  const timer=setInterval(()=>{for(const job of jobs.values())if(job.finished&&Date.now()-job.finished>30*60*1000)remove(job).catch(()=>{});},60000);timer.unref();
  return {
    capabilities,start,
    get:id=>jobs.has(id)?publicJob(jobs.get(id)):null,
    file:id=>{const job=jobs.get(id);return job?.state==='complete'?{file:job.file,filename:job.filename,bytes:job.bytes,sha256:job.sha256,type:job.format==='pdf'?'application/pdf':job.format==='pptx'?'application/vnd.openxmlformats-officedocument.presentationml.presentation':'application/zip'}:null;},
    async close(){closed=true;clearInterval(timer);active?.controller.abort();await active?.promise;for(const job of [...jobs.values()])await remove(job);if(base&&path.dirname(base)===os.tmpdir()&&path.basename(base).startsWith('deckloom-downloads-'))await fs.rm(base,{recursive:true,force:true,maxRetries:3});}
  };
}
module.exports={createDownloadService,fontArchive};
