(() => {
  'use strict';
  const config = window.deckloomConfig || {}, viewer = window.deckloomViewer;
  if (!config.comments || !viewer) return;
  const app = document.getElementById('app');
  app.classList.add('comments-enabled');
  const base = config.commentsBase || '/api/comments';
  const toggle = document.createElement('button');
  toggle.className = 'button comments-toggle'; toggle.type = 'button'; toggle.setAttribute('aria-label', 'Комментарии'); toggle.title = 'Комментарии';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></svg><span>Комментарии</span>';
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'commentsPanel');
  document.querySelector('.header-actions').prepend(toggle);
  const panel = document.createElement('aside'); panel.id = 'commentsPanel'; panel.className = 'comments-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Комментарии к презентации');
  panel.innerHTML = `<div class="comments-actions"><h2>Комментарии</h2><button type="button" data-action="hide" aria-label="Скрыть комментарии">Скрыть</button></div>
    <div class="comments-actions"><button type="button" data-action="place" aria-pressed="false">Добавить точку</button><button type="button" data-action="refresh">Обновить</button></div>
    <p class="comments-notice" role="status" aria-live="polite"></p>
    <div class="comments-actions"><button type="button" data-action="import">Импорт</button><a data-export="json">JSON</a><a data-export="zip">ZIP с PNG</a><input type="file" accept=".json,.zip,application/json,application/zip" hidden></div>
    <div class="comments-scroll"><div class="comments-list"></div><div class="comments-messages"></div></div>
    <form class="comments-compose" hidden><label for="commentText">Комментарий</label><textarea id="commentText" maxlength="10000" required></textarea>
      <div class="comments-actions"><button type="submit">Отправить</button><button type="button" data-action="cancel">Отмена</button></div><small>Ctrl+Enter — отправить</small></form>
    <div class="comments-actions" data-close hidden><button type="button" data-action="close">Закрыть и удалить</button><small>Обсуждение удалится без восстановления.</small></div>`;
  app.append(panel);
  const find = selector => panel.querySelector(selector);
  const notice = find('.comments-notice'), list = find('.comments-list'), messages = find('.comments-messages');
  const composer = find('form'), textarea = find('textarea'), input = find('input[type=file]');
  let open = false, loaded = null, loadedDeck = '', selected = null, pinned = null, point = null, editing = null, editRevision = null;
  let placing = false, busy = false, pending = null, refreshId = 0, surfaceId = 0, currentSlideKey = '', overlay = null;
  let selectingThread = false;
  let keyPoint = { x: .5, y: .5 };
  const draftKey = () => `${config.storagePrefix || 'deckloom'}:comments:${viewer.state.deckId}:${editing || selected || 'new'}`;
  const pendingKey = () => `${config.storagePrefix || 'deckloom'}:commentPending:${viewer.state.deckId}`;
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const activeSlide = () => viewer.state.slides[viewer.state.index];
  const url = (suffix = '', values = {}) => {
    const target = new URL(base + suffix, location.href); target.searchParams.set('deck', viewer.state.deckId);
    Object.entries(values).forEach(([key, value]) => target.searchParams.set(key, value)); return target.href;
  };
  const uuid = () => crypto.randomUUID();
  function announce(text) { notice.textContent = text; }
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
  function unpin() {
    if (!overlay) return;
    overlay.stage.classList.remove('comments-pinned');
    overlay.nodes.forEach(node => node.remove());
    overlay.card.style.cssText = overlay.originalStyle;
    overlay.stage.style.aspectRatio = overlay.originalAspect;
    overlay = null;
  }
  function syncCanvas() {
    if (!overlay || !pinned) return;
    const stage = overlay.stage, canvas = overlay.canvas, context = pinned.context;
    const scale = Math.min(stage.clientWidth / context.width, stage.clientHeight / context.height);
    const width = context.width * scale, height = context.height * scale;
    Object.assign(canvas.style, { left: `${(stage.clientWidth - width) / 2}px`, top: `${(stage.clientHeight - height) / 2}px`, width: `${width}px`, height: `${height}px` });
  }
  function pins() {
    if (!overlay || !loaded || !pinned) return;
    const canvas = overlay.canvas; canvas.replaceChildren();
    canvas.classList.toggle('is-placing', placing); canvas.tabIndex = placing ? 0 : -1;
    canvas.setAttribute('aria-label', 'Выбор точки: стрелки перемещают, Enter подтверждает, Escape отменяет');
    loaded.document.threads.forEach((thread, i) => {
      if (thread.anchor.contextId !== pinned.context.id) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'comment-pin';
      button.textContent = String(i + 1); button.style.left = `${thread.anchor.x * 100}%`; button.style.top = `${thread.anchor.y * 100}%`;
      button.setAttribute('aria-label', `Комментарий ${i + 1}: ${thread.messages[0].text.slice(0, 70)}`);
      button.setAttribute('aria-current', String(selected === thread.id));
      button.onclick = event => { event.stopPropagation(); selectThread(thread.id); };
      canvas.append(button);
    });
    const draft = point || (placing ? keyPoint : null);
    if (draft) {
      const marker = document.createElement('span'); marker.className = 'comment-pin is-draft'; marker.textContent = '+';
      marker.style.left = `${draft.x * 100}%`; marker.style.top = `${draft.y * 100}%`; marker.setAttribute('aria-hidden', 'true'); canvas.append(marker);
    }
  }
  function renderSurface() {
    unpin(); if (!open || !pinned) return;
    const card = document.querySelector('.slide-card.is-active'), stage = card?.querySelector('.stage');
    if (!stage) return;
    const originalStyle = card.style.cssText, originalAspect = stage.style.aspectRatio;
    card.style.setProperty('--slide-aspect', pinned.context.width / pinned.context.height);
    stage.style.aspectRatio = `${pinned.context.width}/${pinned.context.height}`;
    stage.classList.add('comments-pinned');
    const image = document.createElement('img'); image.className = 'comment-snapshot'; image.alt = 'Исходная версия слайда для комментариев'; image.src = pinned.imageUrl;
    const canvas = document.createElement('div'); canvas.className = 'comments-canvas'; canvas.hidden = true;
    image.onload = () => { if (!image.isConnected) return; canvas.hidden = false; syncCanvas(); pins(); if (placing) canvas.focus(); };
    image.onerror = () => {
      if (!image.isConnected) return;
      const missing = document.createElement('div'); missing.className = 'comment-missing'; missing.textContent = 'Исходный PNG недоступен. Импортируйте ZIP с картинками.';
      stage.append(missing); overlay?.nodes.push(missing); canvas.hidden = true;
    };
    canvas.addEventListener('click', event => {
      if (!placing || event.target.closest('button')) return;
      const rect = canvas.getBoundingClientRect();
      choosePoint({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
      event.stopPropagation();
    });
    canvas.addEventListener('keydown', event => {
      if (!placing || event.target !== canvas) return;
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (direction) { event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .005; keyPoint = { x: Math.max(0, Math.min(1, keyPoint.x + direction[0] * step)), y: Math.max(0, Math.min(1, keyPoint.y + direction[1] * step)) }; pins(); canvas.focus(); }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choosePoint(keyPoint); }
    });
    stage.append(image, canvas); overlay = { stage, card, canvas, nodes: [image, canvas], originalStyle, originalAspect };
    syncCanvas(); pins();
  }
  function choosePoint(value) {
    point = value; placing = false; selected = null; editing = null;
    composer.hidden = false; restoreDraft(); textarea.focus();
    announce('Точка выбрана на исходном PNG. Напишите комментарий.'); renderControls(); pins();
  }
  function renderControls() {
    find('[data-action=import]').hidden = loaded?.importable === false;
    find('[data-action=place]').disabled = !loaded?.writable || busy || Boolean(pending);
    find('[data-action=import]').disabled = !loaded?.writable || busy || Boolean(pending);
    find('[data-action=place]').setAttribute('aria-pressed', String(placing));
    find('[data-close]').hidden = !selected || !loaded?.writable;
    find('[data-action=close]').disabled = busy || Boolean(pending);
    messages.querySelectorAll('button').forEach(button => { button.disabled = busy || Boolean(pending); });
    if (!loaded?.writable) { saveDraft(); composer.hidden = true; }
    textarea.readOnly = !loaded?.writable || busy || Boolean(pending);
    composer.querySelector('[type=submit]').disabled = !loaded?.writable || busy || Boolean(pending);
    panel.querySelectorAll('[data-export]').forEach(link => { link.href = url('/export', { format: link.dataset.export }); link.setAttribute('download', ''); });
    toggle.setAttribute('aria-expanded', String(open));
  }
  function renderDiscussion() {
    if (!loaded) return;
    const thread = loaded.document.threads.find(thread => thread.id === selected);
    list.innerHTML = loaded.document.threads.length ? '' : '<p class="comments-muted">Открытых обсуждений пока нет.</p>';
    loaded.document.threads.forEach((item, i) => {
      const context = loaded.document.contexts.find(context => context.id === item.anchor.contextId);
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-current', String(item.id === selected));
      button.textContent = `${i + 1}. ${context.label} · ${item.messages[0].text.slice(0, 100)}`; button.onclick = () => selectThread(item.id); list.append(button);
    });
    messages.replaceChildren();
    if (thread) {
      const heading = document.createElement('h3'); heading.textContent = 'Открытое обсуждение'; messages.append(heading);
      thread.messages.forEach(message => {
        const item = document.createElement('article'); item.className = 'comments-message';
        item.innerHTML = `<small>${escape(message.author.label)}${message.author.sourceId !== loaded.author.sourceId ? ' · из файла' : ''} · ${escape(new Date(message.createdAt).toLocaleString('ru-RU'))}</small><p>${escape(message.text)}</p>`;
        if (loaded.writable && (loaded.canModerate || message.author.sourceId === loaded.author.sourceId && message.author.id === loaded.author.id)) {
          const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Изменить';
          edit.onclick = () => { saveDraft(); editing = message.id; editRevision = thread.revision; textarea.value = message.text; composer.hidden = false; textarea.focus(); }; item.append(edit);
        }
        messages.append(item);
      });
    }
    if (!thread && selected) { selected = null; composer.hidden = true; }
    renderControls(); pins();
  }
  async function refresh() {
    if (!open || !viewer.state.deckId) return;
    const deck = viewer.state.deckId, sequence = ++refreshId;
    try {
      const next = await request(url()); if (sequence !== refreshId || deck !== viewer.state.deckId || !open) return;
      const unchanged = loadedDeck === deck && loaded && next.token === loaded.token && next.writable === loaded.writable
        && JSON.stringify(next.bindings) === JSON.stringify(loaded.bindings) && JSON.stringify(next.availableImages) === JSON.stringify(loaded.availableImages);
      if (unchanged) { loaded = next; renderControls(); return; }
      loaded = next; loadedDeck = deck; renderDiscussion();
    } catch (error) { announce(explain(error)); }
  }
  async function showCurrent() {
    const slide = activeSlide(), deck = viewer.state.deckId;
    if (!slide) return;
    const sequence = ++surfaceId;
    const key = `${deck}:${slide.id}`;
    try {
      const next = await request(url('/context', { slide: slide.id }));
      if (!open || sequence !== surfaceId || viewer.state.deckId !== deck || activeSlide()?.id !== slide.id) return;
      pinned = next; currentSlideKey = key; renderSurface();
    } catch (error) { if (sequence === surfaceId && viewer.state.deckId === deck) { pinned = null; unpin(); announce(explain(error)); } }
  }
  async function selectThread(id) {
    if (busy || pending) return;
    saveDraft(); surfaceId++; selected = id; point = null; editing = null; placing = false;
    const thread = loaded.document.threads.find(item => item.id === id); if (!thread) return;
    const context = loaded.document.contexts.find(context => context.id === thread.anchor.contextId);
    const binding = loaded.bindings.find(binding => binding.slideId === context.slideId);
    if (binding) { const index = viewer.state.slides.findIndex(slide => slide.id === binding.viewerSlideId); if (index >= 0) { selectingThread = true; viewer.openSlide(index); selectingThread = false; } }
    pinned = { context, imageUrl: url('/image', { sha: context.pngSha256 }) };
    currentSlideKey = `${viewer.state.deckId}:${activeSlide()?.id}`;
    composer.hidden = !loaded.writable; restoreDraft(); renderDiscussion(); renderSurface();
    announce(`Исходная версия от ${new Date(context.generatedAt).toLocaleString('ru-RU')}. Точка относится к этому PNG.`);
    if (binding) {
      const deck = viewer.state.deckId;
      request(url('/context', { slide: binding.viewerSlideId })).then(current => {
        if (selected !== id || viewer.state.deckId !== deck) return;
        if (current.context.id !== context.id) announce('Версия отличается от текущего слайда. Показан исходный PNG обсуждения; точка не перенесена.');
      }).catch(() => { if (selected === id) announce('Текущий слайд недоступен. Показан сохранённый контекст обсуждения.'); });
    } else announce('Слайд отсутствует в текущей презентации. Показан сохранённый контекст обсуждения.');
  }
  async function send(operation, slideId = activeSlide()?.id, target = url()) {
    if (busy) return; const deck = viewer.state.deckId;
    const closing = operation.kind === 'close' ? loaded?.document.threads.find(thread => thread.id === operation.threadId) : null;
    const storageKey = pendingKey();
    busy = true; pending = { operation, viewerSlideId: slideId, target };
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* Keep the in-memory retry when browser storage is unavailable. */ }
    renderControls();
    try {
      const saved = await request(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deckloom-Comment-Token': config.commentToken }, body: JSON.stringify({ operation, viewerSlideId: slideId }) });
      try { sessionStorage.removeItem(draftKey()); } catch { /* Optional draft cleanup. */ }
      if (closing) {
        const prefix = `${config.storagePrefix || 'deckloom'}:comments:${deck}:`;
        for (const id of [closing.id, ...closing.messages.map(message => message.id)]) { try { sessionStorage.removeItem(prefix + id); } catch { /* Optional draft cleanup. */ } }
      }
      pending = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* Optional draft cleanup. */ }
      if (deck !== viewer.state.deckId) { announce('Изменение сохранено в исходной презентации.'); await refresh(); return; }
      textarea.value = ''; point = null; editing = null; selected = operation.kind === 'close' ? null : operation.threadId;
      announce(operation.kind === 'close' ? (saved.cleanupPending ? 'Обсуждение удалено. Очистку PNG нужно повторить.' : 'Закрыто. Обсуждение удалено.') : 'Сохранено.');
      await refresh();
      busy = false;
      if (selected) await selectThread(selected); else { composer.hidden = true; await showCurrent(); }
    } catch (error) {
      saveDraft();
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
    saveDraft(); open = value; panel.hidden = !open; app.classList.toggle('comments-open', open); renderControls();
    if (!open) { placing = false; unpin(); toggle.focus(); return; }
    viewer.setMode('focus'); await refresh(); if (selected) await selectThread(selected); else await showCurrent();
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
  }
  toggle.onclick = () => setOpen(!open);
  panel.addEventListener('wheel', event => event.stopPropagation());
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy && !pending) setOpen(false); event.stopPropagation(); });
  panel.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'hide') setOpen(false);
    if (action === 'refresh') { await refresh(); if (!selected && !point && !pending) await showCurrent(); }
    if (action === 'place' && !busy && !pending) {
      viewer.setMode('focus');
      saveDraft(); selected = null; editing = null; point = null; placing = !placing; keyPoint = { x: .5, y: .5 }; composer.hidden = true;
      await showCurrent(); renderDiscussion(); renderControls(); pins();
      announce(placing ? 'Выберите точку на слайде. С клавиатуры: стрелки и Enter; Escape — отмена.' : 'Выбор точки отменён.');
      if (placing) overlay?.canvas.focus();
    }
    if (action === 'cancel' && !busy && !pending) { saveDraft(); point = null; editing = null; composer.hidden = !selected; pins(); }
    if (action === 'close' && selected && !busy && !pending) {
      const thread = loaded.document.threads.find(item => item.id === selected);
      send({ kind: 'close', operationId: uuid(), threadId: selected, expectedRevision: thread.revision });
    }
    if (action === 'import' && !busy) input.click();
  });
  input.onchange = async () => {
    const file = input.files[0]; if (!file || !loaded || busy) return;
    busy = true; renderControls();
    try {
      if (file.size > 308 * 1024 * 1024) throw { code: 'COMMENTS_BUDGET' };
      const zip = file.name.toLowerCase().endsWith('.zip');
      await request(url('/import'), { method: 'POST', headers: { 'Content-Type': zip ? 'application/zip' : 'application/json', 'X-Deckloom-Comment-Token': config.commentToken, 'X-Deckloom-Expected-Token': loaded.token || 'null' }, body: file });
      await refresh(); announce('Импортировано. Повторный импорт не создаёт дубли.');
    } catch (error) { announce(error.details?.conflicts ? 'Есть конфликт правок. Файл не применён; исходный JSON/ZIP сохранён у вас.' : explain(error)); }
    finally { busy = false; input.value = ''; renderControls(); }
  };
  textarea.addEventListener('input', saveDraft);
  textarea.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); composer.requestSubmit(); } });
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
    if (!open || event.defaultPrevented || event.key !== 'Escape') return;
    if (placing) { placing = false; pins(); renderControls(); announce('Выбор точки отменён.'); }
    else if (!busy && !pending) setOpen(false);
  });
  window.addEventListener('resize', syncCanvas);
  window.addEventListener('deckloom:change', () => {
    if (!open || busy || selectingThread) return;
    const key = `${viewer.state.deckId}:${activeSlide()?.id}`;
    if (key !== currentSlideKey && !pending) {
      saveDraft(); selected = null; point = null; editing = null; placing = false; composer.hidden = true;
      pinned = null; currentSlideKey = key; unpin();
      if (loadedDeck !== viewer.state.deckId) refresh().then(showCurrent); else { renderDiscussion(); showCurrent(); }
    } else if (overlay && (!overlay.stage.isConnected || !overlay.card.classList.contains('is-active'))) renderSurface();
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
