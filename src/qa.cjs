// Runs in the browser after fonts and images are ready. No hidden autofitting.
function measureLayout(options = {}) {
  const slide = document.querySelector(options.slideSelector || '.slide');
  if (!slide) return { overflow: [], collisions: [], bounds: [], capacity: [], absoluteText: [], structure: [{kind:'missing-slide'}], frames: [], scenes: [] };
  const tolerance = options.tolerance ?? 4; // Font ink overhang / fractional pixel rounding, not a line.
  const rect = (r) => [r.x, r.y, r.width, r.height].map(n => Math.round(n * 100) / 100);
  const describe = el => el.getAttribute('data-layout-region') || el.getAttribute('data-layout-flow') || el.getAttribute('data-layout-scene') || el.className || el.tagName;
  const visible = el => {
    if (!el.getClientRects().length) return false;
    for (let p = el; p && p !== slide.parentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    }
    return true;
  };

  const textNodes = [];
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement;
    if (!node.textContent.trim() || !el || !(el instanceof HTMLElement) || /^(STYLE|SCRIPT)$/.test(el.tagName) || !visible(el)) continue;
    // Product artwork is one accessible image, with a fixed internal canvas.
    // Its decorative UI text belongs to the package's QA, like pixels in an img.
    // The outer media box remains subject to region-capacity checks below.
    if (el.closest(options.ignoreTextWithin || '[data-layout-artwork][role="img"]')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    // Range height includes font ascender/descender reserves outside CSS line
    // boxes (display roles may have tight leading). Compare logical lines,
    // otherwise a correctly aligned 80/80 heading appears above its container.
    const boxes = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => {
      const trim = Number.isFinite(lineHeight) ? Math.max(0,(r.height-lineHeight)/2) : 0;
      return {x:r.x,y:r.y+trim,left:r.left,right:r.right,top:r.top+trim,bottom:r.bottom-trim,width:r.width,height:r.height-2*trim};
    });
    if (boxes.length) textNodes.push({ el, text: node.textContent.trim().replace(/\s+/g,' '), boxes });
  }
  const overflow = [...slide.querySelectorAll('[data-fit]')].filter(visible).flatMap(el => {
    const box = el.getBoundingClientRect();
    const content = textNodes.filter(t=>el.contains(t.el));
    if (!content.some(t=>t.boxes.some(r=>r.left<box.left-tolerance||r.right>box.right+tolerance||r.top<box.top-tolerance||r.bottom>box.bottom+tolerance))) return [];
    return [{kind:'text-overflow',text:el.textContent.trim(),element:describe(el),client:[el.clientWidth,el.clientHeight],scroll:[el.scrollWidth,el.scrollHeight],rect:rect(box)}];
  });
  const collisions = [];
  for (let a = 0; a < textNodes.length; a++) for (let b = a + 1; b < textNodes.length; b++) {
    const first = textNodes[a], second = textNodes[b];
    if (first.el===second.el || (first.el.closest('[data-fit]') && first.el.closest('[data-fit]')===second.el.closest('[data-fit]'))) continue;
    if (first.el.closest('[data-layout-allow-overlap]') && first.el.closest('[data-layout-allow-overlap]') === second.el.closest('[data-layout-allow-overlap]')) continue;
    const overlaps = first.boxes.some(r => second.boxes.some(s => Math.min(r.right,s.right)-Math.max(r.left,s.left)>tolerance && Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>tolerance));
    if (overlaps) collisions.push({ kind:'text-collision', first:first.text, second:second.text, firstElement:describe(first.el), secondElement:describe(second.el) });
  }

  const bounds = [];
  const canvas = slide.getBoundingClientRect();
  for (const item of textNodes) {
    if (item.boxes.some(r => r.left < canvas.left-tolerance || r.top < canvas.top-tolerance || r.right > canvas.right+tolerance || r.bottom > canvas.bottom+tolerance)) bounds.push({kind:'outside-canvas',text:item.text});
    for (let parent = item.el.parentElement; parent && parent !== slide; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clipX = ['hidden','clip'].includes(style.overflowX), clipY = ['hidden','clip'].includes(style.overflowY);
      if (!clipX && !clipY) continue;
      const r = parent.getBoundingClientRect();
      if (item.boxes.some(s => (clipX && (s.left<r.left-tolerance || s.right>r.right+tolerance)) || (clipY && (s.top<r.top-tolerance || s.bottom>r.bottom+tolerance)))) {
        bounds.push({kind:'clipped-text',text:item.text,container:describe(parent)}); break;
      }
    }
  }

  const capacity = [];
  for (const container of slide.querySelectorAll('[data-layout-region], [data-layout-flow], [data-layout-capacity]')) {
    if (!visible(container)) continue;
    const r=container.getBoundingClientRect();
    // Regions and explicit capacity boundaries own the total height. Flow
    // containers additionally protect peer boxes (without comparing ancestors).
    for (const child of container.children) {
      if (!(child instanceof HTMLElement) || !visible(child) || getComputedStyle(child).position === 'absolute') continue;
      const c=child.getBoundingClientRect();
      if (c.left<r.left-tolerance || c.right>r.right+tolerance || c.top<r.top-tolerance || c.bottom>r.bottom+tolerance) capacity.push({kind:'region-capacity',container:describe(container),element:describe(child),rect:rect(c),available:rect(r)});
    }
    // Auto-height text can fit itself while overflowing its bounded region.
    if (container.hasAttribute('data-layout-region') || container.hasAttribute('data-layout-capacity')) {
      for (const item of textNodes.filter(t=>container.contains(t.el))) {
        if (item.el.closest('[data-layout-scene]')) continue; // scene owns its own viewBox; canvas/ink checks still run
        if (item.boxes.some(s=>s.left<r.left-tolerance||s.right>r.right+tolerance||s.top<r.top-tolerance||s.bottom>r.bottom+tolerance)) capacity.push({kind:'text-region-capacity',container:describe(container),text:item.text});
      }
    }
  }
  const absoluteText = (options.requireFlow ? textNodes : []).filter(({el}) => {
    if (el.closest('[data-layout-scene]')) return false;
    for (let p=el;p&&p!==slide;p=p.parentElement) if (getComputedStyle(p).position==='absolute') return true;
    return false;
  }).map(({text,el})=>({kind:'unscoped-absolute-text',text,element:describe(el)}));
  const frames = slide.querySelectorAll('[data-layout-frame]');
  const structure = options.expectedFrames == null || frames.length === options.expectedFrames ? [] : [{kind:'layout-frame-count',actual:frames.length,expected:options.expectedFrames}];
  return { overflow, collisions, bounds, capacity, absoluteText, structure, frames:[...frames].map(e=>e.dataset.layoutFrame), scenes:[...slide.querySelectorAll('[data-layout-scene]')].map(e=>e.dataset.layoutScene) };
}

function issueCount(qa) {
  return ['overflow','collisions','bounds','capacity','absoluteText','structure'].reduce((sum,key)=>sum+(qa[key] || []).length,0);
}

// Return a self-contained function: Playwright serializes it into the page.
function createLayoutMeasure(options = {}) {
  return new Function('return (' + measureLayout.toString() + ')(' + JSON.stringify(options).replace(/</g, '\\u003c') + ');');
}
module.exports = { measureLayout, createLayoutMeasure, issueCount };
