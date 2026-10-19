const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { scanSlides, scanDecks } = require('./artifacts.cjs');

const noStore = { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', Pragma: 'no-cache', Expires: '0', 'Surrogate-Control': 'no-store' };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const within = (root, file) => file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

function validateProject(project) {
  if (!project?.root || !Array.isArray(project.decks) || !project.decks.length) throw new Error('Project root and at least one deck are required');
  const ids = new Set();
  const prefixes = new Set();
  for (const deck of project.decks) {
    if (!/^[a-z0-9_-]+$/i.test(deck.id) || !/^[a-z0-9_-]+$/i.test(deck.artifactPrefix)) throw new Error('Deck ID and artifactPrefix must be safe names');
    if (ids.has(deck.id) || prefixes.has(deck.artifactPrefix)) throw new Error('Deck IDs and artifact prefixes must be unique');
    ids.add(deck.id); prefixes.add(deck.artifactPrefix);
    for (const key of ['width', 'height']) if (deck[key] != null && (!Number.isFinite(deck[key]) || deck[key] <= 0)) throw new Error(`Invalid deck ${key}`);
  }
}

function createReviewServer(project) {
  validateProject(project);
  project = { ...project, root: path.resolve(project.root) };
  const viewer = project.viewer || {};
  const config = JSON.stringify({ storagePrefix: viewer.storagePrefix || 'deckloom', legacyDeckId: viewer.legacyDeckId }).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(__dirname, '../viewer/index.html'), 'utf8')
    .replace('__DECKLOOM_TITLE__', escapeHtml(viewer.title || 'Deckloom'))
    .replace('__DECKLOOM_FAVICON__', viewer.favicon ? `<link rel="icon" href="${escapeHtml(viewer.favicon)}" />` : '')
    .replace('__DECKLOOM_CONFIG__', () => config);
  const send = (req, res, status, body, type = 'application/json; charset=utf-8') => {
    const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    res.writeHead(status, { ...noStore, 'Content-Type': type, 'Content-Length': buffer.length });
    res.end(req.method === 'HEAD' ? undefined : buffer);
  };

  async function staticFile(pathname) {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\\') || decoded.includes('\0')) return null;
    let root, relative;
    for (const [mount, directory] of Object.entries(project.staticMounts || {})) {
      if (decoded === mount || decoded.startsWith(mount + '/')) {
        root = path.resolve(directory); relative = decoded.slice(mount.length).replace(/^\//, ''); break;
      }
    }
    if (!root) {
      const [, folder, ...rest] = decoded.split('/');
      if (!project.decks.some(deck => new RegExp(`^${deck.artifactPrefix}-\\d+$`, 'i').test(folder))) return null;
      root = path.join(project.root, folder); relative = rest.join('/');
    }
    const file = path.resolve(root, relative || '.');
    if (!within(root, file)) return null;
    try {
      const realRoot = await fsp.realpath(root), realFile = await fsp.realpath(file);
      if (!within(realRoot, realFile)) return null;
      // A registered artifact directory cannot itself be a link outside the project.
      if (root.startsWith(project.root + path.sep) && !within(await fsp.realpath(project.root), realRoot)) return null;
      const stat = await fsp.stat(realFile);
      return stat.isFile() ? { file: realFile, stat } : null;
    } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
  }

  return http.createServer((req, res) => {
    (async () => {
      if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: 'Method not allowed' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/' || url.pathname === '/slides-review.html') return send(req, res, 200, html, mime['.html']);
      if (url.pathname === '/api/decks') return send(req, res, 200, await scanDecks(project));
      if (url.pathname === '/api/slides') {
        const deck = url.searchParams.get('deck');
        const selected = deck ? project.decks.find(item => item.id === deck) : project.decks[0];
        return selected ? send(req, res, 200, await scanSlides(project, selected)) : send(req, res, 404, { error: 'Unknown deck' });
      }
      const result = await staticFile(url.pathname);
      if (!result) return send(req, res, 404, { error: 'Not found' });
      res.writeHead(200, { ...noStore, 'Content-Type': mime[path.extname(result.file).toLowerCase()] || 'application/octet-stream', 'Content-Length': result.stat.size });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(result.file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    })().catch(error => {
      if (res.headersSent) return res.destroy();
      send(req, res, error instanceof URIError ? 400 : 500, { error: error.message });
    });
  });
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
