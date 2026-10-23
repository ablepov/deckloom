const fs = require('node:fs');
const path = require('node:path');
const { staticInspection } = require('./runtime.cjs');
const { cloneJson } = require('./json-data.cjs');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// One canonical viewer for Node servers and authorized host route handlers.
// The host supplies its own API, sessions and PNG URLs; no S3 settings are exposed.
function renderPage({ title = 'Deckloom', favicon, config = {} } = {}) {
  config = cloneJson(config, 'viewer.config');
  const base = config.commentsBase || '/api/comments';
  if (typeof base !== 'string' || !/^\/(?!\/)[A-Za-z0-9_/-]+$/.test(base)) throw new Error('Invalid comments API base');
  if (config.apiBase !== undefined && (typeof config.apiBase !== 'string' || !/^\/(?!\/)[A-Za-z0-9_/-]+$/.test(config.apiBase))) throw new Error('Invalid viewer API base');
  return fs.readFileSync(path.join(__dirname, '../viewer/index.html'), 'utf8')
    .replace('__DECKLOOM_TITLE__', escape(title))
    .replace('__DECKLOOM_FAVICON__', favicon ? `<link rel="icon" href="${escape(favicon)}" />` : '')
    .replace('__DECKLOOM_CONFIG__', () => JSON.stringify(config).replace(/</g, '\\u003c'))
    .replace('__DECKLOOM_PROFILE__', () => staticInspection.toString())
    .replace('__DECKLOOM_COMMENTS__', () => config.comments ? `<link rel="stylesheet" href="${base}/ui.css"><script src="${base}/ui.js"></script>` : '');
}
function asset(name) {
  if (!['comments.js', 'comments.css'].includes(name)) throw new Error('Unknown viewer asset');
  return fs.readFileSync(path.join(__dirname, '../viewer', name), 'utf8');
}
module.exports = { renderPage, asset };
