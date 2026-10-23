(() => {
  'use strict';
  const viewer = window.deckloomViewer;
  if (!viewer) return;
  const app = document.getElementById('app');
  const launch = document.createElement('button');
  launch.type = 'button'; launch.id = 'presentationButton'; launch.className = 'button presentation-launch';
  launch.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  launch.title = 'Запустить презентацию'; launch.setAttribute('aria-label', 'Запустить презентацию');
  document.querySelector('.header-actions').prepend(launch);
  const root = document.createElement('section');
  root.id = 'presentation'; root.className = 'presentation'; root.hidden = true; root.tabIndex = -1;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Показ презентации');
  root.innerHTML = '<div class="presentation-screen"><div class="presentation-canvas"></div></div>' +
    '<div class="presentation-message"><p role="status" aria-live="polite"></p><button type="button" data-show-action="retry" hidden>Повторить подготовку</button><button type="button" data-show-action="cancel">Отмена</button></div>' +
    '<p class="presentation-hint" role="status"></p><nav class="presentation-controls" aria-label="Управление показом" hidden>' +
    '<button type="button" data-show-action="previous" aria-label="Предыдущий слайд" title="Предыдущий слайд"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg></button><span class="presentation-counter" role="status" aria-live="polite"></span>' +
    '<button type="button" data-show-action="next" aria-label="Следующий слайд" title="Следующий слайд"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-7-7 7 7-7 7"/></svg></button><button type="button" data-show-action="exit" aria-label="Выйти" title="Выйти из показа (Escape)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></nav>';
  document.body.append(root);
  const screen = root.querySelector('.presentation-screen'), canvas = root.querySelector('.presentation-canvas');
  const message = root.querySelector('.presentation-message'), progress = message.querySelector('p');
  const retry = message.querySelector('[data-show-action=retry]'), controls = root.querySelector('.presentation-controls');
  controls.dir = 'ltr';
  const hint = root.querySelector('.presentation-hint'), counter = root.querySelector('.presentation-counter');
  const previous = controls.querySelector('[data-show-action=previous]'), next = controls.querySelector('[data-show-action=next]');
  const update = document.createElement('div'); update.className = 'presentation-update'; update.hidden = true;
  update.setAttribute('role', 'status'); update.innerHTML = '<p></p><button type="button" data-update>Обновить</button><button type="button" data-dismiss>Позже</button>';
  app.append(update);
  let session = null, quietTimer = 0, renderId = 0;
  const coarse = matchMedia('(hover: none), (pointer: coarse)');
  const exitHint = () => coarse.matches ? 'Коснитесь слайда для управления' : 'Escape — выйти из показа';
  function syncLaunch() {
    launch.disabled = !viewer.state.slides.length || Boolean(session);
    const slide = viewer.state.slides[viewer.state.index];
    launch.setAttribute('aria-description', slide ? `Начать с выбранного слайда ${viewer.state.index + 1}` : 'В презентации нет слайдов');
  }
  function reveal() {
    root.classList.remove('is-quiet'); clearTimeout(quietTimer);
    if (session?.phase === 'showing' && session.input !== 'keyboard') quietTimer = setTimeout(() => {
      if (session?.phase === 'showing' && session.input !== 'keyboard' && !controls.contains(document.activeElement)) root.classList.add('is-quiet');
    }, 2500);
  }
  function pointerActivity(event) {
    if (!session) return;
    session.input = event.pointerType === 'touch' ? 'touch' : 'pointer';
    // A canvas click returns from button focus to pointer interaction. HTML fields
    // keep their native focus; pointer events inside their frame use the same reveal.
    if (event.type === 'pointerdown' && event.currentTarget === root && session.phase === 'showing' &&
        !event.target.closest('button, a, input, select, textarea, [contenteditable]')) root.focus({ preventScroll: true });
    reveal();
  }
  function fit() {
    if (!session) return;
    const slide = session.slides[session.index];
    const rect = screen.getBoundingClientRect();
    const scale = Math.min(rect.width / slide.width, rect.height / slide.height);
    canvas.style.width = `${slide.width * scale}px`; canvas.style.height = `${slide.height * scale}px`;
    for (const content of canvas.children) content.style.transform = `scale(${scale})`;
  }
  function cleanResources(current) {
    current.abort?.abort();
    for (const url of current.urls) URL.revokeObjectURL(url);
    current.urls.clear(); canvas.replaceChildren(); current.records = [];
  }
  async function finish() {
    const current = session;
    if (!current) return;
    session = null; renderId++; clearTimeout(quietTimer);
    cleanResources(current); root.inert = true;
    if (document.fullscreenElement === root) await document.exitFullscreen().catch(() => {});
    root.hidden = true; root.inert = false; controls.hidden = true; root.classList.remove('is-quiet');
    app.inert = current.wasInert; document.body.classList.remove('presentation-open');
    window.dispatchEvent(new CustomEvent('deckloom:presentation', { detail: { active: false } }));
    viewer.setIndex(current.lastShownIndex ?? current.index); viewer.setMode(current.mode);
    viewer.holdPresentation(false); syncLaunch();
    if (current.mode === 'deck') document.querySelector('.slide-card.is-active')?.scrollIntoView({ block: 'center' });
    (current.focus?.isConnected ? current.focus : launch).focus({ preventScroll: true });
  }
  async function fullscreen(current) {
    try {
      if (!root.requestFullscreen || document.fullscreenEnabled === false) throw new Error('Unavailable');
      await root.requestFullscreen();
      if (session === current) { current.fullscreen = true; hint.textContent = exitHint(); fit(); }
      else if (!session && document.fullscreenElement === root) await document.exitFullscreen();
    } catch {
      if (session === current) { current.fallback = true; hint.textContent = `Полноэкранный режим недоступен. Показ в области окна. ${exitHint()}.`; fit(); }
    }
  }
  async function decodedImage(url, signal) {
    const img = new Image(); img.alt = '';
    await new Promise((resolve, reject) => {
      const stop = () => done(() => { img.src = ''; reject(new DOMException('Cancelled', 'AbortError')); });
      const timer = setTimeout(() => done(() => { img.src = ''; reject(new Error('Истекло время загрузки изображения')); }), 30000);
      const done = callback => { clearTimeout(timer); signal.removeEventListener('abort', stop); img.onload = img.onerror = null; callback(); };
      img.onload = () => done(resolve); img.onerror = () => done(() => reject(new Error('Не удалось прочитать изображение')));
      signal.addEventListener('abort', stop, { once: true });
      img.src = url;
      if (signal.aborted) stop();
    });
    await img.decode(); return img;
  }
  async function prepare(current) {
    cleanResources(current); current.abort = new AbortController(); current.phase = 'preparing'; current.renderedIndex = null;
    reveal();
    const signal = current.abort.signal;
    controls.hidden = true; message.hidden = false; retry.hidden = true;
    let slideIndex = 0;
    try {
      for (const slide of current.slides) {
        progress.textContent = `Готовим слайды: ${slideIndex + 1} из ${current.slides.length}`;
        if (signal.aborted || session !== current) return;
        const width = Number(slide.width), height = Number(slide.height);
        if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error('Неизвестный размер слайда');
        // Prepared PNG is self-contained. HTML-only inputs retain the static document sandbox.
        const png = slide.artifacts?.png;
        const legacyPng = current.contractVersion === 0 && slide.url && !slide.imageError;
        // Legacy version is a cache/build identifier, never a declared SHA-256 digest.
        const source = png?.state === 'available' ? { kind: 'image', url: png.url, hash: png.version }
          : legacyPng ? { kind: 'image', url: slide.url } : viewer.sourceForSlide(slide);
        if (source.kind === 'unavailable') throw new Error('Нет готового изображения или статического HTML');
        const response = await fetch(source.url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        if (!response.ok) throw new Error(`Ресурс недоступен (HTTP ${response.status})`);
        if (source.kind === 'image') {
          const blob = await response.blob();
          if (typeof source.hash === 'string' && /^[a-f0-9]{64}$/.test(source.hash)) {
            if (!crypto.subtle) throw new Error('Для проверки версии нужен защищённый контекст браузера');
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
            if (hash !== source.hash) throw new Error('Изображение не соответствует выбранной версии');
          }
          if (signal.aborted || session !== current) return;
          const url = URL.createObjectURL(blob); current.urls.add(url);
          const img = await decodedImage(url, signal);
          if (current.contractVersion === 1 && (img.naturalWidth !== width || img.naturalHeight !== height)) throw new Error('Размер изображения не соответствует слайду');
          img.src = ''; current.records.push({ kind: 'image', url });
        } else {
          const holder = document.createElement('div'); holder.className = 'presentation-content';
          Object.assign(holder.style, { width: `${width}px`, height: `${height}px`, visibility: 'hidden' });
          holder.inert = true; canvas.append(holder);
          await viewer.loadDocumentFrame(holder, await response.text(), source.url);
          holder.querySelector('iframe').contentDocument.addEventListener('keydown', keyboard, true);
          holder.querySelector('iframe').contentDocument.addEventListener('pointermove', pointerActivity, { passive: true });
          holder.querySelector('iframe').contentDocument.addEventListener('pointerdown', pointerActivity, { passive: true });
          holder.querySelector('iframe').contentDocument.addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) event.preventDefault(); }, { passive: false });
          current.records.push({ kind: 'html', element: holder });
        }
        slideIndex++;
      }
      if (session !== current || signal.aborted) return;
      current.phase = 'showing'; message.hidden = true; controls.hidden = false;
      await show(current.index);
      if (session === current && current.phase === 'showing') { root.focus(); reveal(); }
    } catch (error) {
      if (session !== current || signal.aborted) return;
      current.phase = 'error'; message.hidden = false; controls.hidden = true; retry.hidden = false;
      reveal();
      progress.textContent = `Слайд ${slideIndex + 1}: ${error.message}. Повторите подготовку или выйдите.`;
      retry.focus();
    }
  }
  async function show(index) {
    const current = session;
    if (!current || current.phase !== 'showing') return;
    index = Math.max(0, Math.min(index, current.slides.length - 1));
    current.index = index;
    const token = ++renderId;
    if (index === current.renderedIndex) return;
    const record = current.records[current.index];
    let element = record.element;
    if (record.kind === 'image') {
      try {
        const img = await decodedImage(record.url, current.abort.signal);
        if (session !== current || token !== renderId) return;
        element = document.createElement('div'); element.className = 'presentation-content'; element.dataset.playerImage = 'true';
        img.alt = `Слайд ${current.index + 1}`; element.append(img);
      } catch (error) {
        if (session !== current || current.abort.signal.aborted || token !== renderId) return;
        current.phase = 'error'; message.hidden = false; retry.hidden = false; controls.hidden = true;
        reveal();
        progress.textContent = `Слайд ${current.index + 1}: ${error.message}`; retry.focus(); return;
      }
    }
    for (const child of canvas.children) {
      if (child.dataset.playerImage) child.remove();
      else { child.style.visibility = 'hidden'; child.inert = true; }
    }
    if (record.kind === 'image') canvas.append(element);
    element.style.width = `${current.slides[current.index].width}px`; element.style.height = `${current.slides[current.index].height}px`;
    element.style.visibility = 'visible'; element.inert = false;
    counter.textContent = `${current.index + 1} / ${current.slides.length}`;
    current.renderedIndex = current.index;
    current.lastShownIndex = current.index;
    previous.disabled = current.index === 0; next.disabled = current.index === current.slides.length - 1;
    fit(); reveal();
  }
  function keyboard(event) {
    if (!session || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    session.input = 'keyboard'; reveal();
    if (event.target.closest('input, select, textarea, [contenteditable]')) return;
    if (event.key === 'Tab') {
      if (event.currentTarget !== document) return;
      const buttons = [...root.querySelectorAll('button:not(:disabled)')].filter(button => button.getClientRects().length);
      const index = buttons.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0]?.focus(); }
      return;
    }
    if (event.shiftKey) return;
    const direction = ['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : ['ArrowRight', 'PageDown', ' '].includes(event.key) ? 1 : 0;
    if (!direction || event.key === ' ' && event.target.closest('button, a')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat && session.phase === 'showing') show(session.index + direction);
  }
  launch.onclick = event => {
    if (session || !viewer.state.slides.length) return;
    const current = session = { slides: structuredClone(viewer.state.slides), contractVersion: viewer.state.contractVersion,
      index: viewer.state.index, mode: viewer.state.mode, focus: document.activeElement, wasInert: app.inert,
      records: [], urls: new Set(), phase: 'preparing', fullscreen: false,
      input: event.detail === 0 ? 'keyboard' : coarse.matches ? 'touch' : 'pointer' };
    viewer.holdPresentation(true); update.hidden = true;
    window.dispatchEvent(new CustomEvent('deckloom:presentation', { detail: { active: true } }));
    app.inert = true; document.body.classList.add('presentation-open'); root.hidden = false;
    hint.textContent = exitHint(); root.focus(); syncLaunch();
    fullscreen(current); prepare(current);
  };
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-show-action]')?.dataset.showAction;
    if (action === 'cancel' || action === 'exit') finish();
    else if (action === 'retry' && session) prepare(session);
    else if (action === 'previous') show(session.index - 1);
    else if (action === 'next') show(session.index + 1);
  });
  document.addEventListener('keydown', keyboard, true);
  root.addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) event.preventDefault(); }, { passive: false });
  root.addEventListener('pointermove', pointerActivity); root.addEventListener('pointerdown', pointerActivity); root.addEventListener('focusin', reveal);
  document.addEventListener('fullscreenchange', () => {
    if (!session) return;
    if (document.fullscreenElement === root) { session.fullscreen = true; fit(); }
    else if (session.fullscreen) finish();
  });
  window.addEventListener('resize', fit); window.visualViewport?.addEventListener('resize', fit);
  window.addEventListener('deckloom:change', syncLaunch);
  window.addEventListener('deckloom:updates', event => {
    update.dataset.error = String(Boolean(event.detail.error));
    update.hidden = !event.detail.available && !event.detail.error;
    update.querySelector('p').textContent = event.detail.error ? 'Не удалось проверить обновления. Показанная версия сохранена.' : 'Есть новая версия презентаций. Обновить просмотр?';
    update.querySelector('[data-update]').textContent = event.detail.error ? 'Повторить проверку' : 'Обновить';
  });
  update.querySelector('[data-update]').onclick = () => update.dataset.error === 'true' ? viewer.checkUpdates() : viewer.refresh();
  update.querySelector('[data-dismiss]').onclick = () => { update.hidden = true; };
  syncLaunch();
})();
