const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { fail, check } = require('./runtime.cjs');
const { PptxGenJS, DOMParser, XMLSerializer, JSZip } = require('./vendor/pptx/backend.cjs');
const packaging = require('./pptx-package.cjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function options(value, fonts) {
  const closed = (v, keys) =>
    v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((key) => keys.includes(key));
  if (
    !closed(value, ['mode', 'fonts']) ||
    value.mode !== 'strict' ||
    !closed(value.fonts, ['mode', 'family', 'profile']) ||
    value.fonts.mode !== 'reference' ||
    value.fonts.family !== 'Arial' ||
    value.fonts.profile !== 'windows-installed-v1'
  )
    throw fail(
      'INVALID_PPTX_OPTIONS',
      'PPTX requires strict mode and reference Arial/windows-installed-v1; embedding and hybrid are unsupported',
    );
  if (fonts.policy !== 'allow-substitution')
    throw fail(
      'INVALID_PPTX_OPTIONS',
      'PPTX reference fonts require the existing explicit allow-substitution resource policy',
    );
  return Object.freeze({ mode: 'strict', fonts: Object.freeze({ ...value.fonts }) });
}
async function profile(settings) {
  if (process.platform !== 'win32')
    throw fail('PPTX_PLATFORM_UNSUPPORTED', 'The validated PPTX reference profile requires Windows');
  const script = `Add-Type -AssemblyName System.Drawing; $collection=New-Object System.Drawing.Text.InstalledFontCollection; try { $font=@($collection.Families | Where-Object Name -eq 'Arial')[0]; if ($null -eq $font) { throw 'Arial unavailable' }; $styles=@{}; foreach($style in @('Regular','Bold','Italic')){$styles[$style.ToLowerInvariant()]=$font.IsStyleAvailable([System.Drawing.FontStyle]$style)}; @{provider='windows-installed-v1';platform='win32';family='Arial';styles=$styles} | ConvertTo-Json -Compress } finally {$collection.Dispose()}`;
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {
        encoding: 'utf8',
        timeout: settings.pageTimeoutMs,
        signal: settings.signal,
        windowsHide: true,
        maxBuffer: 65536,
      },
    ));
  } catch (cause) {
    check(settings.signal);
    throw fail('PPTX_FONT_PROFILE_FAILED', 'Could not inspect the installed Arial profile: ' + cause.message, {
      stage: 'pptx-fonts',
    });
  }
  const result = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  if (!['regular', 'bold', 'italic'].every((style) => result.styles[style]))
    throw fail('PPTX_FONT_UNAVAILABLE', 'Arial regular/bold/italic must be installed');
  return { ...result, checkedAt: new Date().toISOString(), embedded: false, requiresRecipientInstallation: true };
}
// One document is the authoring source. No independent PPTX text/geometry input.
function captureDocument() {
  const reject = (message, id) => {
    throw { message, id };
  };
  try {
    const root = document.querySelector('[data-deckloom-pptx="slide"]');
    if (
      !root ||
      document.querySelectorAll('[data-deckloom-pptx="slide"]').length !== 1 ||
      root.parentElement !== document.body
    )
      reject('Declare exactly one top-level PPTX slide');
    // An opt-in authoring subset: unknown declarations fail even in inactive rules.
    // Computed checks below additionally constrain the values of allowed properties.
    const declarations = new Set([
      'position',
      'display',
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'left',
      'right',
      'top',
      'bottom',
      'inset',
      'box-sizing',
      'margin',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'overflow',
      'overflow-x',
      'overflow-y',
      'background',
      'background-color',
      'color',
      'font',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'font-stretch',
      'font-variant',
      'line-height',
      'white-space',
      'text-align',
      'text-transform',
      'text-decoration',
      'text-decoration-line',
      'text-decoration-color',
      'text-decoration-style',
      'letter-spacing',
      'word-spacing',
      'text-indent',
      'direction',
      'unicode-bidi',
      'object-fit',
      'object-position',
      'grid-template-columns',
      'grid-template-rows',
      'grid-auto-flow',
      'grid-auto-columns',
      'grid-auto-rows',
      'gap',
      'row-gap',
      'column-gap',
      'align-items',
      'justify-items',
      'align-content',
      'justify-content',
      'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
      'table-layout', 'border-collapse', 'border-spacing', 'vertical-align',
      'opacity', 'box-shadow',
    ]);
    const resets = {
      'font-variant-caps': 'normal',
      'font-variant-ligatures': 'normal',
      'font-variant-numeric': 'normal',
      'font-variant-east-asian': 'normal',
      'font-variant-alternates': 'normal',
      'font-size-adjust': 'none',
      'font-language-override': 'normal',
      'font-kerning': 'auto',
      'font-optical-sizing': 'auto',
      'font-feature-settings': 'normal',
      'font-variation-settings': 'normal',
      'font-variant-position': 'normal',
      'font-variant-emoji': 'normal',
      'text-decoration-thickness': 'auto',
    };
    const checkDeclarations = (style) => {
      for (const name of style) {
        if (Object.hasOwn(resets, name)) {
          if (![resets[name], 'initial'].includes(style.getPropertyValue(name).trim()))
            reject('Unsupported font/decoration override: ' + name);
        } else if (
          !declarations.has(name) &&
          !name.startsWith('--') &&
          !name.startsWith('background-') &&
          !['white-space-collapse', 'text-wrap-mode'].includes(name)
        )
          reject('Unsupported CSS declaration: ' + name);
      }
    };
    const rules = (list) => {
      for (const rule of list) {
        if (rule.selectorText && /::|:(before|after|first-letter|first-line)\b/.test(rule.selectorText))
          reject('Pseudo-element rules are outside the supported subset');
        if (rule.style) checkDeclarations(rule.style);
        if (rule.cssRules) rules(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) rules(sheet.cssRules);
    for (const element of document.querySelectorAll('[style]')) checkDeclarations(element.style);
    const color = (value, alpha = false) => {
      const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
      if (!match || (!alpha && match[4] && Number(match[4]) !== 1)) reject('Only solid colors are supported; this container requires opaque color');
      return match
        .slice(1, 4)
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    };
    const transparent = (value) => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
    const alpha = value => { const m = /,\s*([\d.]+)\)$/.exec(value); return value.startsWith('rgba') ? Number(m?.[1] ?? 1) : 1; };
    const paint = (element) => {
      const s = getComputedStyle(element),
        id = element.id;
      const kind = element.getAttribute('data-deckloom-pptx');
      const raster = kind === 'paint' || kind === 'slide' && element.getAttribute('data-deckloom-pptx-background') === 'raster';
      if ((s.backgroundImage !== 'none' || s.boxShadow !== 'none') && !raster) reject('Complex paint requires an explicit decorative raster declaration', id);
      if (raster && (/url\(/i.test(s.backgroundImage) || kind === 'slide' && s.boxShadow !== 'none')) reject('Decorative paint permits CSS gradients and leaf shadows; no background resources', id);
      if (Number(s.opacity) !== 1 && !['text', 'rect', 'image', 'paint'].includes(kind)) reject('Opacity is limited to declared leaf objects', id);
      if (
        s.transform !== 'none' ||
        s.translate !== 'none' ||
        s.rotate !== 'none' ||
        s.scale !== 'none' ||
        s.perspective !== 'none' ||
        s.filter !== 'none' ||
        s.backdropFilter !== 'none' ||
        s.textShadow !== 'none' ||
        s.mixBlendMode !== 'normal' ||
        s.clipPath !== 'none' ||
        s.clip !== 'auto' ||
        s.maskImage !== 'none' ||
        s.writingMode !== 'horizontal-tb' ||
        s.visibility !== 'visible' ||
        s.display === 'none' ||
        s.position === 'fixed' ||
        s.position === 'sticky' ||
        s.zIndex !== 'auto' ||
        s.isolation !== 'auto' ||
        s.contain !== 'none' ||
        s.contentVisibility !== 'visible' ||
        s.outlineStyle !== 'none' ||
        s.float !== 'none' ||
        s.order !== '0' ||
        s.zoom !== '1'
      )
        reject('Unsupported paint, visibility or stacking', id);
      if (
        ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s['border' + side + 'Width']) !== 0) ||
        ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].some(
          (corner) => parseFloat(s['border' + corner + 'Radius']) !== 0,
        )
      )
        reject('Borders/radii require a separate capability', id);
      if (parseFloat(s.webkitTextStrokeWidth) !== 0 || s.webkitTextFillColor !== s.color)
        reject('Text stroke/fill overrides are unsupported', id);
      if (!transparent(s.backgroundColor) && s.backgroundClip !== 'border-box')
        reject('Solid backgrounds require border-box paint', id);
      if (
        s.gridColumnStart !== 'auto' || s.gridColumnEnd !== 'auto' ||
        s.gridRowStart !== 'auto' || s.gridRowEnd !== 'auto' ||
        s.alignSelf !== 'auto' || s.justifySelf !== 'auto'
      ) reject('Explicit grid placement/self alignment is unsupported', id);
      if (!['grid', 'flex'].includes(kind) && (
        ['grid', 'inline-grid'].includes(s.display) ||
        s.gridTemplateColumns !== 'none' || s.gridTemplateRows !== 'none' ||
        s.gridAutoFlow !== 'row' || s.gridAutoColumns !== 'auto' || s.gridAutoRows !== 'auto' ||
        s.rowGap !== 'normal' || s.columnGap !== 'normal' ||
        s.alignItems !== 'normal' || s.justifyItems !== 'normal' ||
        s.alignContent !== 'normal' || s.justifyContent !== 'normal'
      )) reject('Layout properties require a declared grid/flex container', id);
      if (kind !== 'flex' && (s.flexDirection !== 'row' || s.flexWrap !== 'nowrap') || kind !== 'card' && (s.flexGrow !== '0' || s.flexShrink !== '1' || s.flexBasis !== 'auto')) reject('Flex properties require a declared flex container/card', id);
      for (const pseudo of ['::before', '::after', '::first-letter', '::first-line', '::marker']) {
        const p = getComputedStyle(element, pseudo);
        if (
          !['none', 'normal', ''].includes(p.content) ||
          !transparent(p.backgroundColor) ||
          p.backgroundImage !== 'none'
        )
          reject('Pseudo-element paint is unsupported', id);
      }
      return s;
    };
    for (const node of document.body.childNodes) {
      if (node === root || (node.nodeType === 1 && ['STYLE', 'LINK', 'TEMPLATE'].includes(node.tagName))) continue;
      if (node.nodeType === 3 && !node.textContent.trim()) continue;
      reject('Content outside the declared slide');
    }
    for (const parent of [document.documentElement, document.body]) {
      const s = paint(parent);
      if (
        !transparent(s.backgroundColor) ||
        s.backgroundImage !== 'none' ||
        s.overflowX !== 'visible' ||
        s.overflowY !== 'visible' ||
        s.textDecorationLine !== 'none'
      )
        reject('Paint/clipping outside the slide');
    }
    const rs = paint(root),
      bounds = root.getBoundingClientRect();
    if (bounds.x !== 0 || bounds.y !== 0 || !((bounds.width === 960 && bounds.height === 540) || (bounds.width === 540 && bounds.height === 960)))
      reject('Only 960x540 or 540x960 canvas at origin is supported');
    if (
      !['MAIN', 'DIV'].includes(root.tagName) ||
      rs.position !== 'relative' ||
      !['block'].includes(rs.display) ||
      rs.overflowX !== 'visible' ||
      rs.overflowY !== 'visible' ||
      rs.textDecorationLine !== 'none'
    )
      reject('Slide root requires an unclipped block');
    const objects = [], ids = new Set(), entries = [], containers = [];
    const children = (parent) => [...parent.childNodes].filter((node) => {
      if (node.nodeType === 3 && !node.textContent.trim()) return false;
      if (node.nodeType !== 1) reject('Containers permit declared elements and whitespace only', parent.id);
      return true;
    });
    const box = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const inside = (r, parent) => r.x >= parent.x && r.y >= parent.y &&
      r.right <= parent.right + 0.01 && r.bottom <= parent.bottom + 0.01;
    const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
    const inspect = (node, allowed, parent, sourcePath) => {
      const kind = node.getAttribute('data-deckloom-pptx'), id = node.id, s = paint(node), r = node.getBoundingClientRect();
      if (!allowed.includes(kind) || !/^[a-z][a-z0-9-]{0,63}$/.test(id) || ids.has(id))
        reject('Each declared object/container requires a unique stable id and supported kind', id);
      ids.add(id);
      if (ids.size > 512) reject('PPTX permits at most 512 declared objects/containers per slide', id);
      if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0 || !inside(r, parent))
        reject('Object geometry must be finite and inside its container/canvas', id);
      if ((s.overflowX !== 'visible' || s.overflowY !== 'visible') && !(kind === 'image' && s.objectFit === 'cover' && s.overflowX === 'clip' && s.overflowY === 'clip')) reject('Clipping is unsupported except image cover at its own border box', id);
      return { node, kind, id, s, r, sourcePath: [...sourcePath, id] };
    };
    const containerStyle = (entry) => {
      const { node, s, id } = entry;
      if (node.tagName !== 'DIV' || s.textDecorationLine !== 'none' ||
        ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(s['padding' + side]) !== 0 || parseFloat(s['margin' + side]) !== 0))
        reject('Grid/card containers require div without decoration, margins or padding', id);
    };
    const top = children(root).map(node => inspect(node, ['text', 'rect', 'image', 'grid', 'flex', 'table', 'connector', 'paint'], bounds, []));
    for (const entry of top) {
      const { node, kind, id, s, r, sourcePath } = entry;
      if (s.position !== 'absolute') reject('Top-level objects require absolute positioning', id);
      if (!['grid', 'flex'].includes(kind)) { entries.push(entry); continue; }
      containerStyle(entry);
      const tracks = value => /^(?:\d+(?:\.\d+)?px)(?: \d+(?:\.\d+)?px)*$/.test(value) &&
        value.split(' ').every(v => parseFloat(v) > 0) && value.split(' ').length <= 64;
      if (kind === 'grid' && (s.display !== 'grid' || !transparent(s.backgroundColor) || s.direction !== 'ltr' ||
        s.gridAutoFlow !== 'row' || s.gridAutoColumns !== 'auto' || s.gridAutoRows !== 'auto' ||
        !tracks(s.gridTemplateColumns) || !tracks(s.gridTemplateRows) ||
        !['normal', 'stretch'].includes(s.alignItems) || !['normal', 'stretch'].includes(s.justifyItems) ||
        !['normal', 'start', 'stretch'].includes(s.alignContent) || !['normal', 'start', 'stretch'].includes(s.justifyContent) ||
        ![s.rowGap, s.columnGap].every(v => v === 'normal' || /^\d+(?:\.\d+)?px$/.test(v))))
        reject('Grid requires transparent row-flow layout with finite tracks and stretch items', id);
      if (kind === 'flex' && (s.display !== 'flex' || !transparent(s.backgroundColor) || s.direction !== 'ltr' || !['row', 'column'].includes(s.flexDirection) || !['nowrap', 'wrap'].includes(s.flexWrap) || !['normal', 'stretch', 'flex-start', 'center'].includes(s.alignItems) || !['normal', 'stretch', 'flex-start', 'center', 'space-between'].includes(s.alignContent) || !['normal', 'flex-start', 'center', 'space-between'].includes(s.justifyContent))) reject('Flex requires non-reversed row/column flow and supported alignment', id);
      if (top.some(other => other !== entry && overlaps(r, other.r)))
        reject('Grid bounds must not overlap any other top-level object', id);
      const cards = children(node).map(child => inspect(child, ['card'], r, sourcePath));
      if (!cards.length || cards.length > 64) reject('Grid requires 1 to 64 cards', id);
      containers.push({ id, kind, sourcePath, bounds: box(r), columns: s.gridTemplateColumns, rows: s.gridTemplateRows,
        childContainerIds: cards.map(card => card.id), transformation: 'flatten-' + kind });
      for (const card of cards) {
        containerStyle(card);
        if (card.s.position !== 'relative' || card.s.display !== 'block' ||
          ['top', 'right', 'bottom', 'left'].some(side => !['auto', '0px'].includes(card.s[side])) ||
          cards.some(other => other !== card && overlaps(card.r, other.r)))
          reject('Cards require unshifted relative blocks without overlap', card.id);
        color(card.s.backgroundColor);
        const leaves = children(card.node).map(child => inspect(child, ['text', 'rect', 'image'], card.r, card.sourcePath));
        if (!leaves.length) reject('Cards require at least one declared object', card.id);
        containers.push({ id: card.id, kind: 'card', sourcePath: card.sourcePath, bounds: box(card.r),
          outputIds: [card.id, ...leaves.map(leaf => leaf.id)], transformation: 'card-background-to-native-rect' });
        entries.push(card, ...leaves);
      }
    }
    if (entries.length > 256) reject('PPTX permits at most 256 native objects per slide');
    const mappings = [];
    for (const { node, kind, id, s, r, sourcePath } of entries) {
      if (kind !== 'card' && s.position !== 'absolute') reject('Objects require absolute positioning', id);
      const object = { id, kind: kind === 'card' ? 'rect' : kind, ...box(r), opacity: Number(s.opacity) };
      if (kind === 'paint') {
        if (node.tagName !== 'DIV' || node.textContent.trim() || node.children.length) reject('Decorative paint must be an empty div; text cannot be rasterized', id);
        const pad = Number(node.getAttribute('data-deckloom-paint-padding') || 0);
        if (!Number.isSafeInteger(pad) || pad < 0 || pad > 128) reject('Declare integer paint padding 0..128', id);
        if (s.boxShadow !== 'none' && pad === 0) reject('Shadow paint requires explicit capture padding', id);
        if (s.boxShadow !== 'none') {
          const shadow = /^rgba?\([^)]*\) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px (-?[\d.]+)px$/.exec(s.boxShadow);
          if (!shadow || pad < Math.ceil(Math.max(Math.abs(Number(shadow[1])), Math.abs(Number(shadow[2]))) + 2 * Number(shadow[3]) + Math.max(0, Number(shadow[4])))) reject('Single outer shadow requires sufficient declared capture padding', id);
        }
        Object.assign(object, { x: r.x - pad, y: r.y - pad, w: r.width + 2 * pad, h: r.height + 2 * pad });
        if (object.x < 0 || object.y < 0 || object.x + object.w > bounds.width || object.y + object.h > bounds.height || top.some(other => other !== top.find(e => e.node === node) && overlaps({ x: object.x, y: object.y, right: object.x + object.w, bottom: object.y + object.h }, other.r))) reject('Decorative capture must fit canvas and not overlap other objects', id);
        object.kind = 'image'; object.decorative = { style: s.cssText || [...s].map(k => k + ':' + s.getPropertyValue(k)).join(';'), bounds: box(r) };
      } else if (kind === 'connector') {
        if (node.tagName !== 'DIV' || node.textContent.trim() || node.children.length || Number(s.opacity) !== 1 || !(r.height <= 8 || r.width <= 8)) reject('Connectors require an empty thin horizontal/vertical div', id);
        object.fill = color(s.backgroundColor); object.lineWidth = Math.min(r.width, r.height);
        if (r.width >= r.height) { object.y += r.height / 2; object.h = 0; } else { object.x += r.width / 2; object.w = 0; }
        object.attached = false;
      } else if (kind === 'table') {
        if (node.tagName !== 'TABLE' || s.tableLayout !== 'fixed' || s.borderCollapse !== 'collapse' || !transparent(s.backgroundColor) || node.children.length !== 1 || node.children[0].tagName !== 'TBODY') reject('Tables require a fixed collapsed table with one tbody', id);
        const plainTableNode = (element, display) => {
          const style = paint(element);
          if (style.display !== display || style.position !== 'static' || style.textDecorationLine !== 'none' || Number(style.opacity) !== 1 || ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style['margin' + side]) !== 0)) reject('Table descendants require static regular table layout without decoration/margins', id);
          return style;
        };
        const body = node.children[0], bs = plainTableNode(body, 'table-row-group'); if (!transparent(bs.backgroundColor)) reject('Use cell fills, not tbody fill', id);
        const rows = children(body); if (!rows.length || rows.length > 32) reject('Table requires 1..32 rows', id);
        object.rows = []; object.rowHeights = []; object.columnWidths = [];
        for (const [ri, row] of rows.entries()) {
          if (row.tagName !== 'TR') reject('Tables require plain rows', id); const rowStyle = plainTableNode(row, 'table-row');
          if (!transparent(rowStyle.backgroundColor)) reject('Use cell fills, not row fills', id);
          const cells = children(row); if (!cells.length || cells.length > 16 || ri && cells.length !== object.columnWidths.length) reject('Table requires a rectangular 1..16 column grid', id);
          object.rowHeights.push(row.getBoundingClientRect().height); const result = [];
          for (const [ci, cell] of cells.entries()) {
            const cs = plainTableNode(cell, 'table-cell'), cr = cell.getBoundingClientRect();
            if (cell.tagName !== 'TD' || cell.children.length || cell.colSpan !== 1 || cell.rowSpan !== 1 || !cell.textContent || /[\r\n\t]/.test(cell.textContent) || cs.fontFamily.replaceAll('"', '') !== 'Arial' || !['400', '700'].includes(cs.fontWeight) || cs.fontStyle !== 'normal' || cs.whiteSpace !== 'pre' || cs.textAlign !== 'left' || cs.verticalAlign !== 'top' || cs.textDecorationLine !== 'none') reject('Cells require plain single-line Arial text, left/top, no merges', id);
            if (cs.textTransform !== 'none' || !['normal', '0px'].includes(cs.letterSpacing) || cs.wordSpacing !== '0px' || cs.textIndent !== '0px' || cs.direction !== 'ltr' || !['normal', 'isolate'].includes(cs.unicodeBidi) || !['normal', '100%'].includes(cs.fontStretch) || cs.fontVariant !== 'normal' || cs.fontKerning !== 'auto') reject('Unsupported table text transformation/spacing/font layout', id);
            const size = parseFloat(cs.fontSize), lineHeight = parseFloat(cs.lineHeight), padding = ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(cs['padding' + side]));
            if (!Number.isFinite(lineHeight) || lineHeight < size || lineHeight + padding[0] + padding[2] > cr.height + .01 || padding.some(v => v !== padding[0])) reject('Cells require uniform padding and a fitting numeric line-height', id);
            const range = document.createRange(); range.selectNodeContents(cell); const text = range.getBoundingClientRect(); if (text.right > cr.right - padding[1] + .5) reject('Table cell text overflows', id);
            if (!ri) object.columnWidths.push(cr.width); else if (Math.abs(cr.width - object.columnWidths[ci]) > .01) reject('Table columns must align', id);
            const expectedX = r.x + object.columnWidths.slice(0, ci).reduce((a, b) => a + b, 0), expectedY = r.y + object.rowHeights.slice(0, ri).reduce((a, b) => a + b, 0);
            if (Math.abs(cr.x - expectedX) > .01 || Math.abs(cr.y - expectedY) > .01 || Math.abs(cr.height - object.rowHeights[ri]) > .01) reject('Table cells must match the regular measured grid', id);
            result.push({ text: cell.textContent, color: color(cs.color), fill: color(cs.backgroundColor), bold: cs.fontWeight === '700', size, lineHeight, padding: padding[0] });
          }
          object.rows.push(result);
        }
        if (Math.abs(object.columnWidths.reduce((a, b) => a + b, 0) - r.width) > .01 || Math.abs(object.rowHeights.reduce((a, b) => a + b, 0) - r.height) > .01) reject('Table dimensions must equal the measured cell grid', id);
      } else if (kind === 'rect' || kind === 'card') {
        if (kind === 'rect' && (node.tagName !== 'DIV' || node.textContent.trim() || node.children.length))
          reject('Rectangles require empty div elements', id);
        object.fill = color(s.backgroundColor, kind === 'rect'); object.opacity *= alpha(s.backgroundColor);
      } else {
        if (!transparent(s.backgroundColor)) reject('Text/image backgrounds must be separate rectangles', id);
        if (kind === 'image') {
          if (
            node.tagName !== 'IMG' ||
            !['fill', 'cover'].includes(s.objectFit) || s.objectPosition !== '50% 50%' ||
            ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s['padding' + side]) !== 0)
          )
            reject('Images require img without padding/crop/object-fit', id);
          object.source = node.currentSrc;
          object.alt = node.alt;
          if (s.objectFit === 'cover') { if (!node.naturalWidth || !node.naturalHeight) reject('Crop requires decoded image dimensions', id); object.crop = { mode: 'cover', position: 'center', naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight }; }
        } else {
          if (
            node.tagName !== 'DIV' ||
            s.display !== 'block' ||
            s.direction !== 'ltr' ||
            !['normal', 'isolate'].includes(s.unicodeBidi) ||
            s.wordSpacing !== '0px' ||
            s.textIndent !== '0px' ||
            s.wordBreak !== 'normal' ||
            s.overflowWrap !== 'normal' ||
            s.hyphens !== 'manual' ||
            s.columnCount !== 'auto' ||
            s.textCombineUpright !== 'none'
          )
            reject('Unsupported text layout', id);
          if (
            s.whiteSpace !== 'pre-wrap' ||
            s.textAlign !== 'left' ||
            s.textTransform !== 'none' ||
            (s.fontStretch !== '100%' && s.fontStretch !== 'normal') ||
            s.fontVariant !== 'normal' ||
            (s.letterSpacing !== 'normal' && parseFloat(s.letterSpacing) !== 0)
          )
            reject('Text requires left/pre-wrap without transformations or spacing', id);
          if (
            ['Top', 'Right', 'Bottom', 'Left'].some(
              (side) => parseFloat(s['padding' + side]) !== 0 || parseFloat(s['margin' + side]) !== 0,
            )
          )
            reject('Text margins/padding must be zero', id);
          object.size = parseFloat(s.fontSize);
          object.lineSpacing = parseFloat(s.lineHeight);
          object.runs = [];
          if (!Number.isFinite(object.lineSpacing) || object.lineSpacing <= 0)
            reject('Specify a numeric line-height', id);
          const append = (text, style, underlined) => {
            if (!text) return;
            const family = style.fontFamily
              .split(',')[0]
              .trim()
              .replace(/^['"]|['"]$/g, '');
            if (
              family !== 'Arial' ||
              !['400', '700'].includes(style.fontWeight) ||
              !['normal', 'italic'].includes(style.fontStyle) ||
              (style.fontWeight === '700' && style.fontStyle === 'italic') ||
              parseFloat(style.fontSize) !== object.size ||
              parseFloat(style.lineHeight) !== object.lineSpacing ||
              style.textTransform !== 'none' ||
              style.fontVariant !== 'normal' ||
              !['normal', '100%'].includes(style.fontStretch) ||
              !['normal', '0px'].includes(style.letterSpacing) ||
              style.wordSpacing !== '0px' ||
              style.whiteSpace !== 'pre-wrap' ||
              !['none', 'underline'].includes(style.textDecorationLine) ||
              style.textDecorationStyle !== 'solid' ||
              (style.textDecorationLine !== 'none' && style.textDecorationColor !== style.color)
            )
              reject('Unsupported text run/font', id);
            object.runs.push({
              text,
              font: family,
              size: object.size,
              color: color(style.color, true), transparency: 100 * (1 - object.opacity * alpha(style.color)),
              bold: style.fontWeight === '700',
              italic: style.fontStyle === 'italic',
              underline: underlined || style.textDecorationLine === 'underline',
            });
          };
          const walk = (element, underlined = false, underlineColor) => {
            const style = getComputedStyle(element),
              underline = underlined || style.textDecorationLine === 'underline';
            if (underlined && style.color !== underlineColor)
              reject('Inherited underline with a different run color is unsupported', id);
            for (const child of element.childNodes) {
              if (child.nodeType === 3) append(child.textContent, style, underline);
              else if (child.nodeType === 1 && child.tagName === 'BR') {
                const bs = paint(child);
                if (bs.display !== 'inline' || !transparent(bs.backgroundColor)) reject('Unsupported br styling', id);
                append('\n', style, underline);
              } else if (child.nodeType === 1 && child.tagName === 'SPAN') {
                const cs = paint(child);
                if (
                  cs.display !== 'inline' ||
                  cs.position !== 'static' ||
                  cs.direction !== 'ltr' ||
                  cs.unicodeBidi !== 'normal' ||
                  !transparent(cs.backgroundColor) ||
                  cs.verticalAlign !== 'baseline' ||
                  ['Top', 'Right', 'Bottom', 'Left'].some(
                    (side) => parseFloat(cs['padding' + side]) !== 0 || parseFloat(cs['margin' + side]) !== 0,
                  )
                )
                  reject('Only plain inline spans are supported', id);
                walk(child, underline, underlineColor || (underline ? style.color : undefined));
              } else reject('Text permits text, span and br only', id);
            }
          };
          walk(node);
          object.text = object.runs.map((run) => run.text).join('');
          if (object.text.length > 100000) reject('Text exceeds the PPTX preparation budget', id);
          if (!object.text || /^\n|\n\n|\n$/.test(object.text) || object.text.includes('\r') || /\t/.test(object.text))
            reject('Blank paragraphs/tabs need a separately validated serializer', id);
          const lines = new Map(),
            walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode()))
            for (let i = 0; i < text.textContent.length; i++) {
              const range = document.createRange();
              range.setStart(text, i);
              range.setEnd(text, i + 1);
              const cr = range.getBoundingClientRect();
              if (cr.width > 0) {
                if (cr.x < r.x - 0.5 || cr.right > r.right + 0.5 || cr.y < r.y - 0.5 || cr.bottom > r.bottom + 0.5)
                  reject('Text overflows its box', id);
                const key = Math.round(cr.top * 10);
                lines.set(key, (lines.get(key) || '') + text.textContent[i]);
              }
            }
          object.lines = [...lines.values()];
        }
      }
      objects.push(object);
      mappings.push({ sourceId: id, sourcePath, sourceKind: kind, nativeIndex: objects.length,
        nativeKind: object.kind, bounds: { x: object.x, y: object.y, w: object.w, h: object.h }, sourceBounds: box(r), editable: ['text', 'rect', 'table', 'connector'].includes(object.kind),
        transformations: [...(sourcePath.length > 1 ? ['flatten-' + top.find(e => e.id === sourcePath[0]).kind, ...(kind === 'card' ? ['card-background-to-native-rect'] : [])] : []), ...(object.crop ? ['native-center-cover-crop'] : []), ...(object.decorative ? ['explicit-decorative-raster'] : [])] });
    }
    for (const container of containers)
      if (['grid', 'flex'].includes(container.kind)) container.outputIds = mappings.filter(mapping => mapping.sourcePath[0] === container.id).map(mapping => mapping.sourceId);
    if (rs.backgroundImage !== 'none') {
      if (ids.has('deckloom-background')) reject('Reserved background object ID');
      objects.unshift({ id: 'deckloom-background', kind: 'image', x: 0, y: 0, w: bounds.width, h: bounds.height, opacity: 1, decorative: { background: true } });
      mappings.unshift({ sourceId: 'deckloom-background', sourcePath: [], sourceKind: 'slide-paint', nativeKind: 'image', bounds: box(bounds), editable: false, transformations: ['explicit-background-raster'] });
      mappings.forEach((m, i) => { m.nativeIndex = i + 1; });
    }
    return { preparedVersion: 1, width: bounds.width, height: bounds.height, background: color(rs.backgroundColor), backgroundStyle: rs.background, objects,
      conversion: { version: 1, nativeIndexConvention: 'one-based-slide-shape-order', containers, objects: mappings,
        rasterizedObjects: objects.filter(o => o.decorative).map(o => ({ sourceId: o.id, reason: o.decorative.background ? 'declared-slide-background' : 'declared-decorative-paint', containsText: false })), rasterFallbacks: [], unsupported: 'reject' } };
  } catch (error) {
    return { error: { message: error.message || String(error), objectId: error.id } };
  }
}
function dataBytes(source) {
  const match = /^data:([^;,]+);base64,([^#]*)(?:#.*)?$/.exec(source || '');
  if (!match || !['image/png', 'image/svg+xml'].includes(match[1]))
    throw fail('PPTX_UNSUPPORTED_RESOURCE', 'Only prepared PNG/SVG data resources are supported');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 16 * 1024 * 1024) throw fail('PPTX_RESOURCE_BUDGET', 'Image exceeds 16 MiB');
  return { mime: match[1], bytes };
}
async function capture(page, slide, fonts, sourceDocument) {
  const scene = await page.evaluate(captureDocument);
  if (scene.error)
    throw fail('PPTX_UNSUPPORTED_HTML', `${scene.error.objectId || slide.id}: ${scene.error.message}`, {
      stage: 'pptx-capture',
    });
  if (fonts.some((font) => font.isCustomFont || font.familyName !== 'Arial'))
    throw fail('PPTX_FONT_MISMATCH', 'Every rendered glyph must resolve to installed Arial; no PPTX-only substitution');
  scene.slideId = slide.id;
  if (sourceDocument) scene.conversion.sourceDocument = { ...sourceDocument };
  for (const object of scene.objects.filter(o => o.decorative)) {
    const isolatedContext = await page.context().browser().newContext({ viewport: { width: scene.width, height: scene.height } });
    try {
      const isolated = await isolatedContext.newPage();
      await isolated.setViewportSize({ width: scene.width, height: scene.height });
      const bg = scene.backgroundStyle, d = object.decorative;
      await isolated.setContent('<html><body style="margin:0"><main></main></body></html>');
      await isolated.evaluate(({ bg, width, height, d }) => {
        const main = document.querySelector('main'); Object.assign(main.style, { position: 'relative', width: width + 'px', height: height + 'px', background: bg });
        if (!d.background) {
          const node = document.createElement('div'); node.style.cssText = d.style; node.style.position = 'absolute';
          Object.assign(node.style, { left: d.bounds.x + 'px', top: d.bounds.y + 'px', right: 'auto', bottom: 'auto', width: d.bounds.w + 'px', height: d.bounds.h + 'px', boxSizing: 'border-box', margin: '0' }); main.appendChild(node);
        }
      }, { bg, width: scene.width, height: scene.height, d });
      object.source = 'data:image/png;base64,' + (await isolated.screenshot({ clip: { x: object.x, y: object.y, width: object.w, height: object.h }, scale: 'css' })).toString('base64');
      // Raster already includes CSS opacity; do not apply it a second time.
      object.opacity = 1; delete object.decorative;
    } finally { await isolatedContext.close(); }
  }
  for (const object of scene.objects)
    if (object.kind === 'image') {
      const resource = dataBytes(object.source);
      object.mediaType = resource.mime;
      object.sha256 = hash(resource.bytes);
      if (resource.mime === 'image/svg+xml') {
        if (/<!DOCTYPE|<!ENTITY/i.test(resource.bytes.toString('utf8')))
          throw fail('PPTX_UNSUPPORTED_SVG', 'SVG declarations are unsupported');
        const doc = new DOMParser({
          onError: () => {
            throw fail('PPTX_UNSUPPORTED_SVG', 'Invalid SVG');
          },
        }).parseFromString(resource.bytes.toString('utf8'), 'text/xml');
        const attributes = [
          'xmlns',
          'width',
          'height',
          'viewBox',
          'x',
          'y',
          'x1',
          'y1',
          'x2',
          'y2',
          'cx',
          'cy',
          'r',
          'rx',
          'ry',
          'd',
          'points',
          'fill',
          'stroke',
          'stroke-width',
          'stroke-linecap',
          'stroke-linejoin',
          'fill-rule',
        ];
        for (const node of Array.from(doc.getElementsByTagName('*'))) {
          if (
            node.namespaceURI !== 'http://www.w3.org/2000/svg' ||
            !['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(node.localName)
          )
            throw fail('PPTX_UNSUPPORTED_SVG', 'Initial SVG profile permits static geometric paths/shapes only');
          for (const attr of Array.from(node.attributes))
            if (!attributes.includes(attr.name) || /url\(|[<>]/i.test(attr.value))
              throw fail('PPTX_UNSUPPORTED_SVG', 'SVG styling/references require a separately validated capability');
        }
        const fallbackWidth = object.crop?.naturalWidth ?? Math.ceil(object.w), fallbackHeight = object.crop?.naturalHeight ?? Math.ceil(object.h);
        if (fallbackWidth > 16384 || fallbackHeight > 16384 || fallbackWidth * fallbackHeight > 16 * 1024 * 1024) throw fail('PPTX_RESOURCE_BUDGET', 'SVG compatibility raster exceeds the pixel budget');
        object.fallback = await page.evaluate(
          async ({ src, width, height }) => {
            const image = new Image();
            image.src = src;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0, width, height);
            return canvas.toDataURL('image/png');
          },
          { src: object.source, width: fallbackWidth, height: fallbackHeight },
        );
        scene.conversion.rasterFallbacks.push({ sourceId: object.id, kind: 'svg-png-compatibility', primary: 'image/svg+xml', fallback: 'image/png' });
      }
    }
  return scene;
}
function textRuns(runs) {
  const result = [];
  for (const run of runs)
    run.text.split('\n').forEach((part, index) => {
      if (index && result.length) result.at(-1).options.breakLine = true;
      if (part)
        result.push({
          text: part,
          options: {
            fontFace: run.font,
            fontSize: run.size * 0.75,
            color: run.color,
            bold: run.bold,
            italic: run.italic,
            underline: run.underline,
            transparency: run.transparency ?? 0,
            breakLine: false,
          },
        });
    });
  return result;
}
async function render(scenes) {
  if (scenes.length > 64 || Buffer.byteLength(JSON.stringify(scenes)) > 24 * 1024 * 1024)
    throw fail('PPTX_INPUT_BUDGET', 'PPTX preparation exceeds 64 slides / 24 MiB');
  const pptx = new PptxGenJS();
  if (!scenes.length || scenes.some(s => s.width !== scenes[0].width || s.height !== scenes[0].height)) throw fail('PPTX_UNSUPPORTED_CANVAS', 'One PPTX requires uniform slide dimensions');
  pptx.defineLayout({ name: 'Deckloom', width: scenes[0].width / 96, height: scenes[0].height / 96 });
  pptx.layout = 'Deckloom';
  pptx.author = 'Deckloom';
  const rasters = new Map();
  for (const scene of scenes) {
    const slide = pptx.addSlide();
    slide.background = { color: scene.background };
    for (const object of scene.objects) {
      const box = { x: object.x / 96, y: object.y / 96, w: object.w / 96, h: object.h / 96, objectName: object.id };
      if (object.kind === 'rect')
        slide.addShape(pptx.ShapeType.rect, {
          ...box,
          fill: { color: object.fill, transparency: 100 * (1 - (object.opacity ?? 1)) },
          line: { color: object.fill, transparency: 100 },
        });
      else if (object.kind === 'image') {
        slide.addImage({ ...box, data: object.source, altText: object.alt ?? object.id, transparency: 100 * (1 - (object.opacity ?? 1)), ...(object.crop ? { w: object.crop.naturalWidth / 96, h: object.crop.naturalHeight / 96, sizing: { type: 'cover', w: box.w, h: box.h } } : {}) });
        if (object.fallback) rasters.set(object.sha256, dataBytes(object.fallback).bytes);
      } else if (object.kind === 'connector') {
        slide.addShape(pptx.ShapeType.line, { ...box, line: { color: object.fill, width: object.lineWidth * .75, beginArrowType: 'none', endArrowType: 'none' } });
      } else if (object.kind === 'table') {
        slide.addTable(object.rows.map(row => row.map(cell => ({ text: cell.text, options: { color: cell.color, fill: cell.fill, bold: cell.bold, fontSize: cell.size * .75, margin: cell.padding * .75, lineSpacing: cell.lineHeight * .75 } }))), {
          ...box, fontFace: 'Arial', colW: object.columnWidths.map(w => w / 96), rowH: object.rowHeights.map(h => h / 96), border: { type: 'none' }, autoPage: false, valign: 'top', paraSpaceAfterPt: 0,
        });
      } else
        slide.addText(textRuns(object.runs), {
          ...box,
          fontFace: 'Arial',
          fontSize: object.size * 0.75,
          lineSpacing: object.lineSpacing * 0.75,
          margin: 0,
          paraSpaceAfterPt: 0,
          wrap: true,
          valign: 'top',
        });
    }
  }
  const raw = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
  // The pinned backend emits line geometry as p:sp. Explicit connector objects
  // use the equivalent OOXML connector wrapper, with no implicit shape attachment.
  let serialized = raw;
  if (scenes.some(s => s.objects.some(o => o.kind === 'connector'))) {
    const zip = await JSZip.loadAsync(raw);
    for (const [index, scene] of scenes.entries()) {
      const ids = new Set(scene.objects.filter(o => o.kind === 'connector').map(o => o.id)); if (!ids.size) continue;
      const file = `ppt/slides/slide${index + 1}.xml`, doc = new DOMParser().parseFromString(await zip.file(file).async('string'), 'text/xml');
      const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
      const rename = (node, name) => { const replacement = doc.createElementNS(P, 'p:' + name); while (node.firstChild) replacement.appendChild(node.firstChild); node.parentNode.replaceChild(replacement, node); return replacement; };
      for (const shape of Array.from(doc.getElementsByTagNameNS(P, 'sp'))) if (ids.has(shape.getElementsByTagNameNS(P, 'cNvPr')[0]?.getAttribute('name'))) {
        rename(shape.getElementsByTagNameNS(P, 'cNvSpPr')[0], 'cNvCxnSpPr'); rename(shape.getElementsByTagNameNS(P, 'nvSpPr')[0], 'nvCxnSpPr'); rename(shape, 'cxnSp');
      }
      zip.file(file, new XMLSerializer().serializeToString(doc));
    }
    serialized = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
  const normalized = await packaging.normalize(serialized, rasters);
  const { files } = await packaging.load(normalized.bytes);
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const conversion = { version: 1, slides: [] };
  for (const [index, scene] of scenes.entries()) {
    const doc = new DOMParser().parseFromString(files.get(`ppt/slides/slide${index + 1}.xml`).toString('utf8'), 'text/xml');
    const tree = doc.getElementsByTagNameNS(P, 'spTree')[0];
    const shapes = Array.from(tree.childNodes).filter(node => node.nodeType === 1 && ['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(node.localName));
    const mappings = scene.conversion?.objects;
    if (!mappings || mappings.length !== shapes.length)
      throw fail('PPTX_MAPPING_MISMATCH', 'Conversion report must match the emitted native shape count');
    const verifiedObjects = mappings.map((mapping, i) => {
      const shape = shapes[i], object = scene.objects[i];
      const identity = shape.getElementsByTagNameNS(P, 'cNvPr')[0];
      const transform = shape.getElementsByTagNameNS(object.kind === 'table' ? P : A, 'xfrm')[0];
      const off = transform?.getElementsByTagNameNS(A, 'off')[0];
      const ext = transform?.getElementsByTagNameNS(A, 'ext')[0];
      const geometry = [off?.getAttribute('x'), off?.getAttribute('y'), ext?.getAttribute('cx'), ext?.getAttribute('cy')];
      if (mapping.nativeIndex !== i + 1 || mapping.sourceId !== object.id || mapping.nativeKind !== object.kind ||
        identity?.getAttribute('name') !== object.id || shape.localName !== ({ image: 'pic', table: 'graphicFrame', connector: 'cxnSp' }[object.kind] ?? 'sp') ||
        (object.kind === 'text') !== !!shape.getElementsByTagNameNS(P, 'txBody').length ||
        ['x', 'y', 'w', 'h'].some((key, j) => mapping.bounds[key] !== object[key] ||
          geometry[j] == null || Math.abs(Number(geometry[j]) / 9525 - object[key]) >= 0.01))
        throw fail('PPTX_MAPPING_MISMATCH', `Conversion mapping differs from emitted shape: ${object.id}`);
      return { ...mapping, nativeShapeId: identity.getAttribute('id'), verified: true };
    });
    conversion.slides.push({ slideId: scene.slideId, ...scene.conversion, objects: verifiedObjects });
  }
  return {
    ...normalized,
    raw,
    conversion,
    slides: scenes.map((scene) => ({
      id: scene.slideId,
      objects: scene.objects.map(({ source, fallback, runs, ...object }) => ({
        ...object,
        editable: ['text', 'rect', 'table', 'connector'].includes(object.kind),
      })),
    })),
  };
}
module.exports = { options, profile, capture, render, captureDocument };


