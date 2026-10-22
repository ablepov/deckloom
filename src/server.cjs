const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { createArtifactReader } = require('./artifacts.cjs');
const { staticInspection } = require('./runtime.cjs');
const { randomUUID } = require('node:crypto');
const { createDownloadService } = require('./downloads.cjs');

const noStore = { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', Pragma: 'no-cache', Expires: '0', 'Surrogate-Control': 'no-store' };
// Deck outputs are served only through declared generation paths.
const exportMime = { '.pdf': 'application/pdf', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const within = (root, file) => file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

function createReviewServer(project) {
  const downloads = createDownloadService(project), downloadToken = randomUUID();
  const reader = createArtifactReader(project);
  project = reader.project;
  const viewer = project.viewer || {};
  const config = JSON.stringify({ storagePrefix: viewer.storagePrefix || 'deckloom', legacyDeckId: viewer.legacyDeckId, downloadToken }).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(__dirname, '../viewer/index.html'), 'utf8')
    .replace('__DECKLOOM_TITLE__', escapeHtml(viewer.title || 'Deckloom'))
    .replace('__DECKLOOM_FAVICON__', viewer.favicon ? `<link rel="icon" href="${escapeHtml(viewer.favicon)}" />` : '')
    .replace('__DECKLOOM_CONFIG__', () => config)
    .replace('__DECKLOOM_PROFILE__', () => staticInspection.toString());
  const send = (req, res, status, body, type = 'application/json; charset=utf-8') => {
    const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    res.writeHead(status, { ...noStore, 'Content-Type': type, 'Content-Length': buffer.length });
    res.end(req.method === 'HEAD' ? undefined : buffer);
  };

  async function staticFile(pathname, searchParams) {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '.' || part === '..')) return null;
    const namespaced = project.inputVersion === 1 && decoded.startsWith('/artifacts/');
    const buildId = searchParams.get('build');
    let mapping = namespaced ? await reader.artifactRoot(decoded.slice('/artifacts/'.length), buildId === null ? undefined : buildId) : null;
    if (buildId !== null && namespaced && !mapping) return null;
    // Namespace mounts mirror only explicitly published resources. This keeps
    // ../assets references working when legacy HTML moves under /artifacts/.
    const mountPath = namespaced ? decoded.slice('/artifacts'.length) : decoded;
    for (const [mount, directory] of Object.entries(project.staticMounts || {})) {
      if (!mapping && (mountPath === mount || mountPath.startsWith(mount + '/'))) {
        mapping = { root: directory, relative: mountPath.slice(mount.length).replace(/^\//, '') }; break;
      }
    }
    if (!mapping && project.artifacts.layout === 'legacy' && !decoded.startsWith('/artifacts/')) mapping = await reader.artifactRoot(decoded.slice(1), buildId === null ? undefined : buildId);
    if (!mapping) return null;
    const { root, relative } = mapping;
    const file = path.resolve(root, relative || '.');
    if (!within(root, file)) return null;
    try {
      const realRoot = await fsp.realpath(root), realFile = await fsp.realpath(file);
      if (!within(realRoot, realFile)) return null;
      // A registered artifact directory cannot itself be a link outside the project.
      if (mapping.artifact && !within(await fsp.realpath(project.root), realRoot)) return null;
      const stat = await fsp.stat(realFile);
      return stat.isFile() ? { file: realFile, stat } : null;
    } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
  }

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url, 'http://localhost');
      if(url.pathname==='/api/downloads'&&req.method==='POST'){
        const origin=req.headers.origin;
        if(req.headers['x-deckloom-token']!==downloadToken||(origin&&origin!==`http://${req.headers.host}`))return send(req,res,403,{error:'Download request denied'});
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(req,res,415,{error:'JSON required'});
        let body='',tooLarge=false;
        await new Promise((resolve,reject)=>{req.on('data',chunk=>{if(Buffer.byteLength(body)+chunk.length>4096)tooLarge=true;else if(!tooLarge)body+=chunk.toString('utf8');});req.on('end',resolve);req.on('error',reject);});
        if(tooLarge)return send(req,res,413,{error:'Request too large'});
        let value;try{value=JSON.parse(body)}catch{return send(req,res,400,{error:'Invalid JSON'})}
        try{return send(req,res,202,downloads.start(value))}
        catch(error){return send(req,res,error.code==='UNKNOWN_DECK'?404:error.code==='DOWNLOAD_BUSY'?409:400,{error:'Cannot start export',code:error.code||'DOWNLOAD_FAILED'})}
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: 'Method not allowed' });
      if(url.pathname==='/api/downloads')return send(req,res,200,{decks:downloads.capabilities()});
      const download=url.pathname.match(/^\/api\/downloads\/([a-f0-9-]{36})(\/file)?$/);
      if(download){
        if(!download[2]){const job=downloads.get(download[1]);return send(req,res,job?200:404,job||{error:'Download not found'});}
        const file=downloads.file(download[1]);if(!file)return send(req,res,404,{error:'Download not ready'});
        res.writeHead(200,{...noStore,'Content-Type':file.type,'Content-Length':file.bytes,'Content-Disposition':`attachment; filename="${file.filename}"`,'X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD')return res.end();
        const stream=fs.createReadStream(file.file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      if (url.pathname === '/' || url.pathname === '/slides-review.html') return send(req, res, 200, html, mime['.html']);
      if (url.pathname === '/api/decks') return send(req, res, 200, await reader.scanDecks());
      if (url.pathname === '/api/slides') {
        const selection = url.searchParams.has('deck') ? url.searchParams.get('deck') : undefined;
        return send(req, res, 200, await reader.scanSlides(selection));
      }
      const result = await staticFile(url.pathname, url.searchParams);
      if (!result) return send(req, res, 404, { error: 'Not found' });
      res.writeHead(200, { ...noStore, 'Content-Type': mime[path.extname(result.file).toLowerCase()] || exportMime[path.extname(result.file).toLowerCase()] || 'application/octet-stream', 'Content-Length': result.stat.size });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(result.file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    })().catch(error => {
      if (res.headersSent) return res.destroy();
      const status = error instanceof URIError ? 400 : error.code === 'UNKNOWN_DECK' ? 404 : 500;
      send(req, res, status, project.inputVersion === 1
        ? { error: error.code === 'UNKNOWN_DECK' ? 'Unknown deck' : status === 400 ? 'Invalid URL' : 'Cannot read project', code: error.code || 'READ_FAILED', ...(error.field ? { field: error.field } : {}) }
        : { error: error.code === 'UNKNOWN_DECK' ? 'Unknown deck' : status === 400 ? 'Invalid URL' : 'Cannot read project' });
    });
  });
  server.on('close',()=>downloads.close().catch(()=>{}));
  return server;
}

async function startReviewServer(project, options = {}) {
  const explicit = options.port != null || Boolean(process.env.PORT);
  const start = options.port ?? (process.env.PORT ? Number(process.env.PORT) : 3000);
  const host = options.host || process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(start) || start < 0 || start > 65535) throw new Error('Invalid port');
  for (let port = start; ; port++) {
    const server = createReviewServer(project);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      console.log(`Slides review: http://localhost:${server.address().port}`);
      return server;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || explicit || port >= start + 20) throw error;
    }
  }
}
module.exports = { createReviewServer, startReviewServer };
