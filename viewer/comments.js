(() => {
  'use strict';
  const config = window.deckloomConfig || {}, viewer = window.deckloomViewer;
  if (!config.comments || !viewer) return;
  const app = document.getElementById('app');
  app.classList.add('comments-enabled');
  const base = config.commentsBase || '/api/comments';
  const toggle = document.createElement('button');
  const icon = paths => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
  const icons = {
    list: icon('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    dismiss: icon('<path d="m6 6 12 12M6 18 18 6"/>'),
    send: icon('<path d="m5 12 7-7 7 7M12 5v14"/>'),
    edit: icon('<path d="m16 4 4 4M4 20l4-1L20 7l-3-3L4 17z"/>'),
    close: icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'),
    cancel: icon('<path d="M9 10 4 6l5-4M4 6h9a7 7 0 0 1 0 14h-2"/>'),
  };
  toggle.className = 'button comments-toggle'; toggle.type = 'button'; toggle.setAttribute('aria-label', 'Комментарии'); toggle.title = 'Комментарии: C — включить/выключить; Shift+C — скрыть/показать пины';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></svg><span>Комментарии</span>';
  toggle.setAttribute('aria-pressed', 'false');
  document.querySelector('.header-actions').prepend(toggle);
  const listToggle = document.createElement('button'); listToggle.className = 'button comments-list-toggle'; listToggle.type = 'button'; listToggle.hidden = true;
  listToggle.setAttribute('aria-label', 'Список комментариев и обмен файлами'); listToggle.title = 'Список комментариев и обмен JSON/ZIP';
  listToggle.setAttribute('aria-expanded', 'false'); listToggle.setAttribute('aria-controls', 'commentsPanel'); listToggle.innerHTML = icons.list; toggle.after(listToggle);
  const panel = document.createElement('aside'); panel.id = 'commentsPanel'; panel.className = 'comments-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Комментарии к презентации');
  panel.innerHTML = `<div class="comments-actions"><h2>Комментарии</h2><button type="button" data-action="list" aria-label="Скрыть список">Скрыть</button><button type="button" data-action="refresh">Обновить</button></div>
    <div class="comments-actions"><button type="button" data-action="import">Импорт</button><a data-export="json">JSON</a><a data-export="zip">ZIP с PNG</a><input type="file" accept=".json,.zip,application/json,application/zip" hidden></div>
    <div class="comments-scroll"><div class="comments-list"></div></div>`;
  const popover = document.createElement('section'); popover.className = 'comments-popover'; popover.hidden = true;
  popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-label', 'Обсуждение на слайде');
  popover.innerHTML = `<div class="comments-actions comments-popover-header"><strong>Обсуждение</strong><div data-close hidden><button type="button" data-action="close" aria-label="Закрыть и удалить" title="Закрыть и удалить обсуждение без восстановления">${icons.close}</button></div><button type="button" data-action="dismiss" aria-label="Скрыть обсуждение" title="Скрыть окно; обсуждение сохранится">${icons.dismiss}</button></div>
    <div class="comments-messages"></div>
    <form class="comments-compose" hidden><textarea id="commentText" aria-label="Комментарий" placeholder="Написать…" maxlength="10000" required></textarea>
      <div class="comments-actions"><button type="button" data-action="cancel" aria-label="Отменить редактирование" title="Вернуться к ответу" hidden>${icons.cancel}</button><button type="submit" aria-label="Отправить" title="Отправить (Ctrl+Enter / ⌘+Enter)">${icons.send}</button></div></form>`;
  const notice = document.createElement('div'); notice.className = 'comments-notice'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const preview = document.createElement('div'); preview.className = 'comments-preview'; preview.hidden = true; preview.setAttribute('role', 'tooltip');
  const root = document.createElement('div'); root.className = 'comments-root'; root.append(panel, popover, notice, preview); app.append(root);
  const find = selector => root.querySelector(selector);
  const list = find('.comments-list'), messages = find('.comments-messages');
  const composer = find('form'), textarea = find('textarea'), input = find('input[type=file]');
  let open = false, loaded = null, loadedDeck = '', selected = null, pinned = null, point = null, editing = null, editRevision = null;
  let busy = false, pending = null, refreshId = 0, surfaceId = 0, currentSlideKey = '', overlay = null, surfaceRequest = null, paintId = 0;
  let selectingThread = false, checkingContext = false;
  let sidebar = false, visible = true, presenting = false, returnFocus = toggle, draftDeck = '', focusPopover = false;
  let keyPoint = { x: .5, y: .5 };
  let pointerInside = false;
  const canPlace = () => open && visible && loaded?.writable && !busy && !pending && !checkingContext && !surfaceRequest && overlay && !overlay.imageMissing && pinned?.current !== false;
  const draftKey = () => `${config.storagePrefix || 'deckloom'}:comments:${draftDeck || viewer.state.deckId}:${editing || selected || 'new'}`;
  const pendingKey = (deck = viewer.state.deckId) => `${config.storagePrefix || 'deckloom'}:commentPending:${deck}`;
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const authorColor = author => {
    let hash = 0; for (const ch of JSON.stringify([author.sourceId, author.id])) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) | 0;
    return ['#245b9e', '#7041a1', '#17664f', '#9b3b40', '#805316', '#41518b'][Math.abs(hash) % 6];
  };
  const initials = author => author.label.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase('ru-RU');
  const authorBadge = author => `<span class="comment-avatar" style="--author-color:${authorColor(author)}" aria-hidden="true">${escape(initials(author))}</span>`;
  const threadPoint = () => point || loaded?.document.threads.find(thread => thread.id === selected)?.anchor;
  function positionFloating(element, anchor) {
    if (element.hidden || !overlay || !anchor) return;
    const rect = (overlay.canvas.hidden ? overlay.stage : overlay.canvas).getBoundingClientRect(), gap = 20, inset = 8;
    const viewport = window.visualViewport, top = viewport?.offsetTop || 0, leftEdge = viewport?.offsetLeft || 0;
    const viewportWidth = viewport?.width || window.innerWidth, viewportHeight = viewport?.height || window.innerHeight;
    const width = Math.min(320, viewportWidth - inset * 2);
    element.style.width = `${width}px`; element.style.maxHeight = `${viewportHeight - inset * 2}px`;
    const x = rect.left + rect.width * anchor.x, y = rect.top + rect.height * anchor.y;
    const left = x + gap + width <= leftEdge + viewportWidth - inset ? x + gap : x - width - gap;
    element.style.left = `${Math.max(leftEdge + inset, Math.min(leftEdge + viewportWidth - width - inset, left))}px`;
    element.style.top = `${Math.max(top + inset, Math.min(top + viewportHeight - element.offsetHeight - inset, y - 16))}px`;
  }
  function showPopover() {
    preview.hidden = true; popover.hidden = !open || !visible || !overlay || (overlay.canvas.hidden && !overlay.imageMissing) || !(point || selected) || (point && !loaded?.writable);
    positionFloating(popover, threadPoint());
  }
  function dismissPopover(focus = true) {
    const threadId = selected;
    saveDraft(); point = null; selected = null; editing = null; focusPopover = false; composer.hidden = true; popover.hidden = true; preview.hidden = true;
    pins(); renderControls();
    const pin = overlay && [...overlay.canvas.querySelectorAll('[data-thread]')].find(pin => pin.dataset.thread === threadId);
    if (focus) (pin || (returnFocus?.isConnected ? returnFocus : toggle)).focus();
    if (pinned?.current === false) showCurrent();
  }
  const activeSlide = () => viewer.state.slides[viewer.state.index];
  const url = (suffix = '', values = {}) => {
    const target = new URL(base + suffix, location.href); target.searchParams.set('deck', viewer.state.deckId);
    Object.entries(values).forEach(([key, value]) => target.searchParams.set(key, value)); return target.href;
  };
  const uuid = () => crypto.randomUUID();
  function announce(text, kind = 'error') { notice.textContent = text; notice.dataset.kind = kind; }
  function saveDraft() { if (!open || composer.hidden) return; try { sessionStorage.setItem(draftKey(), textarea.value); } catch { /* Editing remains available when browser storage is full. */ } }
  function restoreDraft() { try { textarea.value = sessionStorage.getItem(draftKey()) || ''; } catch { textarea.value = ''; } }
  async function request(target, options = {}) {
    const response = await fetch(target, { cache: 'no-store', ...options });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.code || 'COMMENTS_FAILED'), { code: value.code, details: value, status: response.status });
    return value;
  }
  function explain(error) {
    if (error.code === 'COMMENTS_CONFLICT' || error.code === 'COMMENTS_STORAGE_CONFLICT') return 'Обсуждение изменилось. Список обновлён; ваш текст сохранён. Проверьте его перед повторной отправкой.';
    if (error.code === 'COMMENTS_VERSION_MISMATCH') return 'Слайд изменился. Текст сохранён; выберите точку на новой версии.';
    if (error.code === 'COMMENTS_CLOSED') return 'Обсуждение уже закрыто и удалено.';
    if (error.code === 'COMMENTS_STORAGE_BUSY') return 'Хранилище занято. Повторите отправку.';
    if (error.code === 'COMMENTS_STORAGE_QUOTA') return 'Не хватает места для PNG. Существующие обсуждения сохранены.';
    if (/VERSION_REQUIRED|IDENTITY_REQUIRED/.test(error.code || '')) return 'Для точки нужен собранный слайд с постоянным ID. Можно импортировать обсуждения.';
    if (error.code === 'COMMENTS_SCOPE_MISMATCH') return 'Этот файл относится к другой презентации или источнику.';
    if (error.code === 'COMMENTS_FORBIDDEN') return 'Недостаточно прав для этого действия.';
    return error.code ? 'Действие не выполнено. Проверьте файл или повторите попытку.' : 'Нет соединения. Ваш текст сохранён в этой вкладке.';
  }
  function cancelSurface() {
    paintId++;
    if (surfaceRequest) { surfaceRequest.image.onload = surfaceRequest.image.onerror = null; surfaceRequest.resolve(false); surfaceRequest = null; }
  }
  function unpin() { cancelSurface(); removeSurface(); }
  function removeSurface() {
    if (!overlay) return;
    overlay.stage.classList.remove('comments-pinned');
    overlay.nodes.forEach(node => node.remove());
    overlay.card.style.cssText = overlay.originalStyle;
    overlay.stage.style.aspectRatio = overlay.originalAspect;
    overlay.resize?.disconnect();
    overlay = null;
  }
  function syncCanvas() {
    if (!overlay) return;
    const stage = overlay.stage, canvas = overlay.canvas, context = overlay.context;
    const scale = Math.min(stage.clientWidth / context.width, stage.clientHeight / context.height);
    const width = context.width * scale, height = context.height * scale;
    Object.assign(canvas.style, { left: `${(stage.clientWidth - width) / 2}px`, top: `${(stage.clientHeight - height) / 2}px`, width: `${width}px`, height: `${height}px` });
    positionFloating(popover, threadPoint()); preview.hidden = true;
  }
  function pins() {
    if (!overlay || !loaded || !pinned) return;
    const canvas = overlay.canvas, placing = canPlace();
    canvas.classList.toggle('pins-hidden', !visible); canvas.classList.toggle('is-placing', Boolean(placing)); canvas.tabIndex = placing ? 0 : -1;
    canvas.setAttribute('aria-label', 'Выбор точки: стрелки перемещают, Enter подтверждает, Escape отменяет');
    const existing = new Map([...canvas.querySelectorAll('[data-thread]')].map(node => [node.dataset.thread, node]));
    loaded.document.threads.forEach((thread, i) => {
      if (thread.anchor.contextId !== overlay.context.id) return;
      const button = existing.get(thread.id) || document.createElement('button'); existing.delete(thread.id); button.type = 'button'; button.className = 'comment-pin';
      button.dataset.thread = thread.id;
      const author = thread.messages[0].author;
      button.textContent = initials(author); button.style.setProperty('--author-color', authorColor(author)); button.style.left = `${thread.anchor.x * 100}%`; button.style.top = `${thread.anchor.y * 100}%`;
      button.setAttribute('aria-label', `Комментарий ${i + 1}, ${author.label}: ${thread.messages[0].text.slice(0, 70)}`);
      button.setAttribute('aria-current', String(selected === thread.id));
      const showPreview = () => {
        if (!popover.hidden || !visible || surfaceRequest) return;
        const message = thread.messages[0]; preview.innerHTML = `<div class="comments-author">${authorBadge(author)}<span>${escape(author.label)}<small>${escape(new Date(message.createdAt).toLocaleString('ru-RU'))}</small></span></div><p>${escape(message.text.slice(0, 180))}</p>`;
        preview.hidden = false; positionFloating(preview, thread.anchor);
      };
      button.onpointerenter = event => { if (event.pointerType !== 'touch') showPreview(); }; button.onfocus = showPreview;
      button.onpointerleave = button.onblur = () => { preview.hidden = true; };
      button.onclick = event => { event.stopPropagation(); returnFocus = button; selectThread(thread.id, true); };
      if (!button.isConnected) canvas.append(button);
    });
    existing.forEach(node => node.remove());
    for (const [kind, value] of [['point', point], ['cursor', placing && (pointerInside || document.activeElement === canvas) ? keyPoint : null]]) {
      let marker = canvas.querySelector(`[data-marker="${kind}"]`);
      if (!value) { marker?.remove(); continue; }
      if (!marker) { marker = document.createElement('span'); marker.className = `comment-pin is-draft is-${kind}`; marker.dataset.marker = kind; marker.textContent = '+'; marker.setAttribute('aria-hidden', 'true'); canvas.append(marker); }
      marker.style.left = `${value.x * 100}%`; marker.style.top = `${value.y * 100}%`;
    }
  }
  function renderSurface() {
    if (!open || !pinned || !visible || presenting) { unpin(); return Promise.resolve(false); }
    const card = document.querySelector('.slide-card.is-active'), stage = card?.querySelector('.stage');
    if (!stage) return Promise.resolve(false);
    const context = pinned.context;
    const samePixels = other => other && other.pngSha256 === context.pngSha256 && other.width === context.width && other.height === context.height;
    if (overlay && !overlay.imageMissing && samePixels(overlay.context)) {
      if (overlay.stage !== stage) {
        // Polling can rebuild the viewer's card. Move the already decoded nodes
        // during that same render turn instead of exposing the new live pixels.
        overlay.resize?.disconnect(); overlay.stage.classList.remove('comments-pinned');
        overlay.card.style.cssText = overlay.originalStyle; overlay.stage.style.aspectRatio = overlay.originalAspect;
        Object.assign(overlay, { card, stage, originalStyle: card.style.cssText, originalAspect: stage.style.aspectRatio });
        card.style.setProperty('--slide-aspect', context.width / context.height); stage.style.aspectRatio = `${context.width}/${context.height}`;
        stage.classList.add('comments-pinned'); overlay.nodes.forEach(node => stage.append(node));
        overlay.resize?.observe(stage);
      }
      cancelSurface(); overlay.context = context; overlay.canvas.hidden = false;
      syncCanvas(); pins(); showPopover(); focusDiscussion(); return Promise.resolve(true);
    }
    if (surfaceRequest?.stage === stage && samePixels(surfaceRequest.context)) { surfaceRequest.context = context; return surfaceRequest.promise; }
    cancelSurface();
    popover.hidden = true; preview.hidden = true;
    // Keep the previous pixels until the replacement is decoded. Its points cannot
    // accept input while a different immutable context is being prepared.
    if (overlay) overlay.canvas.hidden = true;
    const image = document.createElement('img'); image.className = 'comment-snapshot'; image.alt = 'Исходная версия слайда для комментариев';
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const next = { stage, context, image, promise, resolve, sequence: paintId };
    surfaceRequest = next; renderControls();
    const commit = missing => {
      if (surfaceRequest !== next || next.sequence !== paintId || !stage.isConnected || !card.classList.contains('is-active') || !open || !visible || presenting) { resolve(false); return; }
      surfaceRequest = null; removeSurface();
      installSurface(card, stage, next.context, image, missing);
      renderControls(); syncCanvas(); pins(); showPopover(); focusDiscussion(); resolve(true);
    };
    image.onload = async () => {
      try { if (image.decode) await image.decode(); } catch { commit(true); return; }
      commit(false);
    };
    image.onerror = () => commit(true);
    image.src = pinned.imageUrl;
    return promise;
  }
  function focusDiscussion() {
    if (focusPopover && !popover.hidden) { (composer.hidden ? popover.querySelector('[data-action=dismiss]') : textarea).focus(); focusPopover = false; }
  }
  function installSurface(card, stage, context, image, imageMissing) {
    const originalStyle = card.style.cssText, originalAspect = stage.style.aspectRatio;
    card.style.setProperty('--slide-aspect', context.width / context.height);
    stage.style.aspectRatio = `${context.width}/${context.height}`;
    stage.classList.add('comments-pinned');
    const canvas = document.createElement('div'); canvas.className = 'comments-canvas'; canvas.hidden = imageMissing;
    overlay = { stage, card, canvas, context, imageMissing, nodes: [canvas], originalStyle, originalAspect };
    if (imageMissing) {
      const missing = document.createElement('div'); missing.className = 'comment-missing'; missing.textContent = 'Исходный PNG недоступен. Импортируйте ZIP с картинками.';
      stage.append(missing); overlay.nodes.push(missing); announce(missing.textContent, 'context');
    } else { stage.append(image); overlay.nodes.push(image); }
    canvas.addEventListener('click', event => {
      if (!canPlace() || event.target.closest('button')) return;
      const rect = canvas.getBoundingClientRect();
      choosePoint({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
      event.stopPropagation();
    });
    canvas.addEventListener('pointermove', event => {
      if (!canPlace() || event.pointerType === 'touch') return;
      if (event.target.closest('[data-thread]')) { pointerInside = false; canvas.querySelector('.is-cursor')?.remove(); return; }
      pointerInside = true;
      const rect = canvas.getBoundingClientRect(); keyPoint = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
      let marker = canvas.querySelector('.is-cursor');
      if (!marker) { pins(); marker = canvas.querySelector('.is-cursor'); }
      if (marker) { marker.style.left = `${keyPoint.x * 100}%`; marker.style.top = `${keyPoint.y * 100}%`; }
    });
    canvas.addEventListener('pointerleave', () => { pointerInside = false; canvas.querySelector('.is-cursor')?.remove(); });
    canvas.addEventListener('focus', pins);
    canvas.addEventListener('blur', () => { if (!pointerInside) canvas.querySelector('.is-cursor')?.remove(); });
    canvas.addEventListener('keydown', event => {
      if (!canPlace() || event.target !== canvas || event.isComposing || event.keyCode === 229) return;
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (direction) { event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .005; keyPoint = { x: Math.max(0, Math.min(1, keyPoint.x + direction[0] * step)), y: Math.max(0, Math.min(1, keyPoint.y + direction[1] * step)) }; pins(); canvas.focus(); }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choosePoint(keyPoint); }
    });
    stage.append(canvas);
    if (window.ResizeObserver) { overlay.resize = new ResizeObserver(syncCanvas); overlay.resize.observe(stage); }
    syncCanvas(); pins();
  }
  function choosePoint(value) {
    saveDraft(); point = value; selected = null; editing = null; draftDeck = viewer.state.deckId;
    messages.replaceChildren(); composer.hidden = false; restoreDraft(); showPopover(); textarea.focus();
    renderControls(); pins();
  }
  function renderControls() {
    find('[data-action=import]').hidden = loaded?.importable === false;
    find('[data-action=import]').disabled = !loaded?.writable || busy || Boolean(pending);
    find('[data-close]').hidden = !selected || !loaded?.writable;
    find('[data-action=close]').disabled = busy || Boolean(pending);
    messages.querySelectorAll('button').forEach(button => { button.disabled = busy || Boolean(pending); });
    if (!loaded?.writable) { saveDraft(); composer.hidden = true; }
    textarea.readOnly = !loaded?.writable || busy || Boolean(pending);
    composer.querySelector('[type=submit]').disabled = !loaded?.writable || busy || Boolean(pending) || Boolean(point && pinned?.current === false);
    panel.querySelectorAll('[data-export]').forEach(link => { link.href = url('/export', { format: link.dataset.export }); link.setAttribute('download', ''); });
    toggle.setAttribute('aria-pressed', String(open)); listToggle.hidden = !open || presenting;
    listToggle.setAttribute('aria-expanded', String(sidebar));
    panel.hidden = !open || !sidebar; notice.hidden = !open;
    find('.comments-popover-header strong').hidden = !selected;
    find('[data-action=cancel]').hidden = !editing;
    pins();
  }
  function renderDiscussion() {
    if (!loaded) return;
    const thread = loaded.document.threads.find(thread => thread.id === selected);
    list.innerHTML = loaded.document.threads.length ? '' : '<p class="comments-muted">Открытых обсуждений пока нет.</p>';
    loaded.document.threads.forEach((item, i) => {
      const context = loaded.document.contexts.find(context => context.id === item.anchor.contextId);
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-current', String(item.id === selected));
      button.textContent = `${i + 1}. ${context.label} · ${item.messages[0].author.label} · ${item.messages[0].text.slice(0, 100)}`; button.onclick = () => { returnFocus = button; selectThread(item.id, true); }; list.append(button);
    });
    messages.replaceChildren();
    if (thread) {
      thread.messages.forEach(message => {
        const item = document.createElement('article'); item.className = 'comments-message';
        item.innerHTML = `<div class="comments-author">${authorBadge(message.author)}<span>${escape(message.author.label)}${message.author.sourceId !== loaded.author.sourceId ? ' · из файла' : ''}<small>${escape(new Date(message.createdAt).toLocaleString('ru-RU'))}</small></span></div><p>${escape(message.text)}</p>`;
        if (loaded.writable && (loaded.canModerate || message.author.sourceId === loaded.author.sourceId && message.author.id === loaded.author.id)) {
          const edit = document.createElement('button'); edit.type = 'button'; edit.innerHTML = icons.edit; edit.setAttribute('aria-label', 'Изменить'); edit.title = 'Изменить сообщение';
          edit.onclick = () => { saveDraft(); editing = message.id; editRevision = thread.revision; restoreDraft(); if (!textarea.value) textarea.value = message.text; composer.hidden = false; showPopover(); textarea.focus(); }; item.append(edit);
        }
        messages.append(item);
      });
    }
    if (!thread && selected) { selected = null; composer.hidden = true; if (pinned?.current === false) showCurrent(); }
    renderControls(); pins(); showPopover();
  }
  async function refresh() {
    if (!open || !viewer.state.deckId) return;
    const deck = viewer.state.deckId, sequence = ++refreshId;
    try {
      const next = await request(url()); if (sequence !== refreshId || deck !== viewer.state.deckId || !open) return;
      const unchanged = loadedDeck === deck && loaded && next.token === loaded.token && next.writable === loaded.writable
        && next.canModerate === loaded.canModerate && next.importable === loaded.importable && JSON.stringify(next.author) === JSON.stringify(loaded.author)
        && JSON.stringify(next.bindings) === JSON.stringify(loaded.bindings) && JSON.stringify(next.availableImages) === JSON.stringify(loaded.availableImages);
      if (unchanged) { loaded = next; renderControls(); return; }
      loaded = next; loadedDeck = deck; renderDiscussion();
    } catch (error) { announce(explain(error)); }
  }
  async function showCurrent() {
    const slide = activeSlide(), deck = viewer.state.deckId;
    if (!slide) return;
    const sequence = ++surfaceId;
    checkingContext = true; renderControls();
    const key = `${deck}:${slide.id}`;
    try {
      const next = await request(url('/context', { slide: slide.id }));
      if (!open || sequence !== surfaceId || viewer.state.deckId !== deck || activeSlide()?.id !== slide.id) return;
      pinned = { ...next, current: true }; currentSlideKey = key; if (notice.dataset.kind === 'context') announce(''); await renderSurface();
    } catch (error) { if (sequence === surfaceId && viewer.state.deckId === deck) { pinned = null; unpin(); announce(explain(error)); } }
    finally { if (sequence === surfaceId) { checkingContext = false; renderControls(); } }
  }
  async function verifyContext(context, viewerSlideId) {
    const deck = viewer.state.deckId;
    try {
      const current = await request(url('/context', { slide: viewerSlideId }));
      if (pinned?.context.id !== context.id || viewer.state.deckId !== deck || activeSlide()?.id !== viewerSlideId) return;
      pinned.current = current.context.id === context.id; renderControls();
      if (!pinned.current) announce(point ? 'Слайд изменился. Текст сохранён; скройте окно и выберите точку на текущей версии.' : 'Версия отличается от текущего слайда. Показан исходный PNG обсуждения; точка не перенесена. Скройте окно, чтобы комментировать текущую версию.', 'context');
      else if (notice.dataset.kind === 'context' && !overlay?.imageMissing) announce('');
    } catch { if (pinned?.context.id === context.id && viewer.state.deckId === deck) announce('Текущий слайд недоступен. Показан сохранённый контекст обсуждения.', 'context'); }
  }
  async function selectThread(id, focus = false) {
    if (busy || pending) return;
    saveDraft(); surfaceId++; checkingContext = false; selected = id; point = null; editing = null; draftDeck = viewer.state.deckId;
    const thread = loaded.document.threads.find(item => item.id === id); if (!thread) return;
    const context = loaded.document.contexts.find(context => context.id === thread.anchor.contextId);
    const binding = loaded.bindings.find(binding => binding.slideId === context.slideId);
    if (binding) { const index = viewer.state.slides.findIndex(slide => slide.id === binding.viewerSlideId); if (index >= 0) { selectingThread = true; viewer.openSlide(index); selectingThread = false; } }
    const knownCurrent = pinned?.current === true && currentSlideKey === `${viewer.state.deckId}:${activeSlide()?.id}` ? pinned.context.id : null;
    pinned = { context, imageUrl: url('/image', { sha: context.pngSha256 }), current: context.id === knownCurrent };
    currentSlideKey = `${viewer.state.deckId}:${activeSlide()?.id}`;
    visible = true; composer.hidden = !loaded.writable; restoreDraft(); focusPopover = focus; renderDiscussion(); renderSurface();
    if (binding) verifyContext(context, binding.viewerSlideId);
    else announce('Слайд отсутствует в текущей презентации. Показан сохранённый контекст обсуждения.', 'context');
  }
  async function send(operation, slideId = activeSlide()?.id, target = url()) {
    if (busy) return; const deck = new URL(target, location.href).searchParams.get('deck') || viewer.state.deckId;
    const closing = operation.kind === 'close' ? loaded?.document.threads.find(thread => thread.id === operation.threadId) : null;
    const storageKey = pendingKey(deck);
    const sentDraftKey = `${config.storagePrefix || 'deckloom'}:comments:${deck}:${operation.kind === 'edit' ? operation.messageId : operation.kind === 'reply' ? operation.threadId : 'new'}`;
    busy = true; pending = { operation, viewerSlideId: slideId, target };
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* Keep the in-memory retry when browser storage is unavailable. */ }
    renderControls();
    try {
      const saved = await request(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deckloom-Comment-Token': config.commentToken }, body: JSON.stringify({ operation, viewerSlideId: slideId }) });
      if (operation.kind !== 'close') { try { sessionStorage.removeItem(sentDraftKey); } catch { /* Optional draft cleanup. */ } }
      if (closing) {
        const prefix = `${config.storagePrefix || 'deckloom'}:comments:${deck}:`;
        for (const id of [closing.id, ...closing.messages.map(message => message.id)]) { try { sessionStorage.removeItem(prefix + id); } catch { /* Optional draft cleanup. */ } }
      }
      pending = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* Optional draft cleanup. */ }
      if (deck !== viewer.state.deckId) { await refresh(); return; }
      textarea.value = ''; composer.hidden = true; point = null; editing = null; selected = operation.kind === 'close' ? null : operation.threadId;
      announce(saved.cleanupPending ? 'Обсуждение удалено. Очистку PNG нужно повторить.' : '');
      await refresh();
      busy = false;
      if (selected) await selectThread(selected); else { composer.hidden = true; await showCurrent(); }
    } catch (error) {
      saveDraft();
      if (error.code === 'COMMENTS_VERSION_MISMATCH' && pinned) pinned.current = false;
      if (error.status && error.status !== 409 || error.code === 'COMMENTS_CONFLICT' || error.code === 'COMMENTS_VERSION_MISMATCH' || error.code === 'COMMENTS_CLOSED') pending = null;
      if (!pending) { try { sessionStorage.removeItem(storageKey); } catch { /* Optional draft cleanup. */ } }
      announce(explain(error));
      if (pending) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Повторить отправку';
        retry.onclick = () => send(pending.operation, pending.viewerSlideId, pending.target); notice.append(' ', retry);
      } else {
        await refresh();
        if (error.code === 'COMMENTS_CONFLICT' && editing) editRevision = loaded?.document.threads.find(thread => thread.id === selected)?.revision;
      }
    } finally { busy = false; renderControls(); }
  }
  async function setOpen(value) {
    if (presenting && value) return;
    saveDraft(); open = value; app.classList.toggle('comments-open', open); renderControls();
    if (!open) { focusPopover = false; popover.hidden = true; preview.hidden = true; unpin(); toggle.focus(); return; }
    visible = true;
    viewer.setMode('focus'); await refresh(); if (selected) await selectThread(selected, true); else await showCurrent();
    if (!pending) {
      try {
        const recovered = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null');
        if (recovered && recovered.target === url() && recovered.operation?.operationId) pending = recovered;
      } catch { /* Invalid or unavailable session data is ignored. */ }
    }
    if (pending) {
      announce('Есть неподтверждённая отправка из этой вкладки. Повтор безопасен: используется прежний ID операции.');
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Повторить отправку';
      retry.onclick = () => send(pending.operation, pending.viewerSlideId, pending.target); notice.append(' ', retry); renderControls();
    }
    if (!selected && !point && canPlace()) overlay?.canvas.focus();
  }
  async function toggleVisibility() {
    if (!open || presenting) return;
    saveDraft(); visible = !visible; pointerInside = false; popover.hidden = true; preview.hidden = true;
    if (visible) { if (pinned) await renderSurface(); else await showCurrent(); if (!selected && !point && canPlace()) overlay?.canvas.focus(); } else unpin();
    renderControls();
  }
  toggle.onclick = () => setOpen(!open);
  listToggle.onclick = () => { sidebar = !sidebar; renderControls(); if (sidebar) panel.querySelector('button').focus(); };
  root.addEventListener('wheel', event => event.stopPropagation());
  root.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
    if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, select, textarea, [contenteditable]') && event.key.toLowerCase() === 'c') {
      event.preventDefault(); if (event.shiftKey) toggleVisibility(); else setOpen(!open);
    }
    if (event.key === 'Escape' && !busy && !pending) { event.preventDefault(); if (!popover.hidden) dismissPopover(); else { sidebar = false; renderControls(); toggle.focus(); } }
    event.stopPropagation();
  });
  const handleAction = async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'list') { sidebar = !sidebar; renderControls(); listToggle.focus(); }
    if (action === 'dismiss') dismissPopover();
    if (action === 'refresh') { await refresh(); if (!selected && !point && !pending) await showCurrent(); }
    if (action === 'cancel' && !busy && !pending) { if (editing) { saveDraft(); editing = null; restoreDraft(); showPopover(); } else dismissPopover(); }
    if (action === 'close' && selected && !busy && !pending) {
      const thread = loaded.document.threads.find(item => item.id === selected);
      send({ kind: 'close', operationId: uuid(), threadId: selected, expectedRevision: thread.revision });
    }
    if (action === 'import' && !busy) input.click();
  };
  root.addEventListener('click', handleAction);
  input.onchange = async () => {
    const file = input.files[0]; if (!file || !loaded || busy) return;
    busy = true; renderControls();
    try {
      if (file.size > 308 * 1024 * 1024) throw { code: 'COMMENTS_BUDGET' };
      const zip = file.name.toLowerCase().endsWith('.zip');
      await request(url('/import'), { method: 'POST', headers: { 'Content-Type': zip ? 'application/zip' : 'application/json', 'X-Deckloom-Comment-Token': config.commentToken, 'X-Deckloom-Expected-Token': loaded.token || 'null' }, body: file });
      await refresh(); if (notice.dataset.kind !== 'context') announce('');
    } catch (error) { announce(error.details?.conflicts ? 'Есть конфликт правок. Файл не применён; исходный JSON/ZIP сохранён у вас.' : explain(error)); }
    finally { busy = false; input.value = ''; renderControls(); }
  };
  textarea.addEventListener('input', saveDraft);
  textarea.addEventListener('keydown', event => { if (!event.isComposing && event.keyCode !== 229 && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); composer.requestSubmit(); } });
  composer.onsubmit = event => {
    event.preventDefault(); if (!textarea.value.trim() || busy || pending) return;
    if (point && pinned) send({ kind: 'create', operationId: uuid(), threadId: uuid(), messageId: uuid(), context: pinned.context, x: point.x, y: point.y, text: textarea.value });
    else if (selected) {
      const thread = loaded.document.threads.find(item => item.id === selected);
      send(editing ? { kind: 'edit', operationId: uuid(), threadId: selected, messageId: editing, expectedRevision: editRevision, text: textarea.value }
        : { kind: 'reply', operationId: uuid(), threadId: selected, messageId: uuid(), text: textarea.value });
    }
  };
  document.addEventListener('keydown', event => {
    if (presenting || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, select, textarea, [contenteditable]')) return;
    if (!event.repeat && event.key.toLowerCase() === 'c') {
      event.preventDefault(); if (event.shiftKey) toggleVisibility(); else setOpen(!open); return;
    }
    if (!open || event.key !== 'Escape') return;
    if (!popover.hidden && !busy && !pending) { dismissPopover(); return; }
    if (!busy && !pending) setOpen(false);
  });
  window.addEventListener('resize', syncCanvas);
  if (window.ResizeObserver) new ResizeObserver(() => positionFloating(popover, threadPoint())).observe(popover);
  window.visualViewport?.addEventListener('resize', () => positionFloating(popover, threadPoint()));
  window.visualViewport?.addEventListener('scroll', () => positionFloating(popover, threadPoint()));
  window.addEventListener('scroll', () => { positionFloating(popover, threadPoint()); preview.hidden = true; }, true);
  // Presentation mode owns navigation and must not expose review overlays. Hosts dispatch
  // the same bridge as the viewer: CustomEvent('deckloom:presentation', {detail:{active}}).
  window.addEventListener('deckloom:presentation', event => {
    presenting = event.detail?.active === true;
    if (presenting) { saveDraft(); setOpen(false); toggle.blur(); }
    toggle.hidden = presenting;
  });
  window.addEventListener('deckloom:change', () => {
    if (!open || busy || selectingThread) return;
    const key = `${viewer.state.deckId}:${activeSlide()?.id}`;
    if (key !== currentSlideKey && !pending) {
      saveDraft(); selected = null; point = null; editing = null; composer.hidden = true;
      popover.hidden = true; preview.hidden = true;
      pinned = null; currentSlideKey = key; unpin();
      if (loadedDeck !== viewer.state.deckId) refresh().then(showCurrent); else { renderDiscussion(); showCurrent(); }
    } else if (overlay && (!overlay.stage.isConnected || !overlay.card.classList.contains('is-active'))) {
      renderSurface();
      if (!selected && !point && !pending) showCurrent();
      else if (!pending && loaded?.bindings.some(binding => binding.slideId === pinned?.context.slideId && binding.viewerSlideId === activeSlide()?.id)) {
        pinned.current = false; renderControls(); verifyContext(pinned.context, activeSlide().id);
      }
    }
  });
  // Navigation only toggles active classes, so also observe the selected hash.
  let lastHash = location.hash;
  setInterval(() => {
    if (!open || document.hidden) return;
    if (lastHash !== location.hash) {
      lastHash = location.hash;
      if (!selected && !point && !pending) showCurrent();
    }
    refresh();
  }, 4000);
})();
