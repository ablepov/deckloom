const fsp = require("node:fs/promises");
const path = require("node:path");
function isSlideDir(name, deck) {
  const escapedPrefix = deck.artifactPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedPrefix}-\\d+$`, "i").test(name);
}

function reviewImageRank(name) {
  const normalized = name.toLowerCase();
  if (!/\.(png|jpe?g|webp)$/.test(normalized)) return 0;
  if (/(preview|small|tiny|comparison|source|background-layer)/.test(normalized)) {
    return 0;
  }
  if (/(^|[-_])bg([-_.]|$)|background/.test(normalized)) return 0;
  if (/generated-(complete|hybrid)/.test(normalized)) return 3;
  if (normalized.startsWith("generated-")) return 2;
  return 1;
}

function slideNumber(dirName) {
  return dirName.match(/(\d+)$/)?.[1] || dirName;
}

function cacheVersion(stat) {
  return `${Math.trunc(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}`;
}

async function scanSlides(project, deck = project.decks[0]) {
  const ROOT = project.root;
  const entries = await fsp.readdir(ROOT, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && isSlideDir(entry.name, deck))
    .map((entry) => entry.name)
    .sort((a, b) => Number(slideNumber(a)) - Number(slideNumber(b)));

  const slides = [];

  for (const dirName of dirs) {
    const dir = path.join(ROOT, dirName);
    const files = await fsp.readdir(dir, { withFileTypes: true });
    const candidates = [];

    for (const file of files) {
      if (!file.isFile()) continue;
      const rank = reviewImageRank(file.name);
      if (!rank) continue;
      const absolutePath = path.join(dir, file.name);
      const stat = await fsp.stat(absolutePath);
      candidates.push({
        name: file.name,
        rank,
        stat,
        attempt: Number(file.name.match(/attempt-(\d+)/i)?.[1] || 0),
      });
    }

    candidates.sort((a, b) => {
      const byRank = b.rank - a.rank;
      if (byRank) return byRank;
      const byTime = b.stat.mtimeMs - a.stat.mtimeMs;
      if (byTime) return byTime;
      const byAttempt = b.attempt - a.attempt;
      if (byAttempt) return byAttempt;
      return a.name.localeCompare(b.name);
    });

    const latest = candidates[0];
    if (!latest) continue;

    const no = slideNumber(dirName);
    const version = cacheVersion(latest.stat);
    const filePath = `/${dirName}/${encodeURIComponent(latest.name)}`;
    const htmlFile = `${dirName}-render.html`;
    const htmlPath = path.join(dir, htmlFile);
    let html = null;

    try {
      const htmlStat = await fsp.stat(htmlPath);
      if (htmlStat.isFile()) {
        const htmlVersion = cacheVersion(htmlStat);
        html = {
          file: htmlFile,
          url: `/${dirName}/${encodeURIComponent(htmlFile)}?v=${htmlVersion}`,
          version: htmlVersion,
          size: htmlStat.size,
          modifiedAt: htmlStat.mtime.toISOString(),
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    slides.push({
      deckId: deck.id,
      width: deck.width || 1920, height: deck.height || 1080,
      no,
      id: dirName,
      file: latest.name,
      url: `${filePath}?v=${version}`,
      version,
      size: latest.stat.size,
      modifiedAt: latest.stat.mtime.toISOString(),
      htmlFile: html?.file || null,
      htmlUrl: html?.url || null,
      htmlVersion: html?.version || null,
      htmlSize: html?.size || null,
      htmlModifiedAt: html?.modifiedAt || null,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    id: deck.id,
    label: deck.label,
    width: deck.width || 1920, height: deck.height || 1080,
    slides,
  };
}

async function scanDecks(project) {
  const deckPayloads = await Promise.all(project.decks.map((deck) => scanSlides(project, deck)));
  return {
    generatedAt: new Date().toISOString(),
    decks: deckPayloads.map(({ id, label, width, height, slides }) => ({ id, label, width, height, slides })),
  };
}


module.exports = { scanSlides, scanDecks };
