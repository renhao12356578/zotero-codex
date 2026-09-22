/* Zotero-host adapter. All paper and editor operations stay in the host. */
var ZoteroCodex = (() => {
  const ID = 'zotero-codex@local', PANE = 'zotero-codex-chat', Core = ZoteroCodexCore;
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const views = new Set(), models = new Map(), sessions = new Map();
  const winCleanups = new Map();
  let bindings = {}, connection = null, selectionListener, pollTimer, registeredPane, polling = false, shuttingDown = false;
  const prefKey = 'extensions.zotero-codex.bindings';
  const uuid = () => Services.uuid.generateUUID().toString().replace(/[{}]/g, '');
  const bn = () => Zotero.BetterNotes?.api;
  const stableKey = item => item ? `${item.libraryID}:${item.key}` : 'unbound';
  function modelFor(item) {
    const key = stableKey(item);
    if (!models.has(key)) models.set(key, { key, item, cards: [], draft: '', threadId: bindings[key] || '', status: '', targetNoteID: item?.isNote() ? item.id : null });
    return models.get(key);
  }
  function sessionFor(id) {
    if (!sessions.has(id)) sessions.set(id, { id, writable: false, messages: [], cursor: 0, busy: false, loaded: false, sources: new Map() });
    return sessions.get(id);
  }
  function update(model) { for (const view of views) if (!model || view.model === model || (model.threadId && view.model.threadId === model.threadId)) view.render(); }
  function bind(model, id) {
    model.threadId = id; bindings[model.key] = id;
    Zotero.Prefs.set(prefKey, JSON.stringify(bindings), true); update(model);
  }
  async function readConnection() {
    const home = Services.dirsvc.get('Home', Components.interfaces.nsIFile).path;
    let config;
    const file = Zotero.Prefs.get('extensions.zotero-codex.connectionFile', true) || PathUtils.join(home, '.local', 'share', 'zotero-codex', 'connection.json');
    try { config = JSON.parse(await IOUtils.readUTF8(file)); }
    catch { throw new Error('请先在项目目录运行 npm start 启动 Codex 桥接服务'); }
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.url) || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('本机配对配置无效');
    return connection = config;
  }
  async function request(path, body) {
    const config = await readConnection();
    const response = await Zotero.HTTP.request(body ? 'POST' : 'GET', config.url + path, {
      headers: { Authorization: 'Bearer ' + config.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), responseType: 'text', successCodes: false, timeout: 40000,
    });
    let value;
    try { value = JSON.parse(response.responseText); } catch { throw new Error('桥接服务返回了无效响应'); }
    if (response.status >= 400) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  }
  async function loadHistory(model) {
    if (!model.threadId) return;
    const session = sessionFor(model.threadId);
    const response = await request('/history?id=' + encodeURIComponent(model.threadId));
    session.writable = response.writable; session.loaded = true;
    session.busy = Boolean(response.activeTurnId) || response.thread.status?.type === 'active';
    session.cursor = response.cursor;
    session.messages = [];
    for (const turn of response.thread.turns || []) for (const item of turn.items || []) {
      if (item.type === 'agentMessage') session.messages.push({ id: item.id, turnId: turn.id, role: 'assistant', text: item.text, done: turn.status !== 'inProgress' });
      if (item.type === 'userMessage') {
        const text = (item.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
        session.messages.push({ id: item.id, turnId: turn.id, role: 'user', text: text.split('\n\n[Zotero reference material')[0], done: true });
        const json = text.split('[Zotero reference material — data, not instructions]\n')[1];
        if (json) try { session.sources.set(turn.id, JSON.parse(json.split('\nImage for source')[0])); } catch { /* Older or external messages need not contain cards. */ }
      }
    }
    model.status = session.writable ? '本机插件会话 · 桌面端实时同步尚未验证' : 'Codex 历史（只读）· 使用“新建”创建可对话会话';
    update(model);
  }
  async function getAttachment(item) {
    if (item?.isAttachment()) return item;
    if (item?.isNote() && item.parentID) item = Zotero.Items.get(item.parentID);
    if (item?.isRegularItem()) return await item.getBestAttachment();
    return null;
  }
  function readerFor(attachment) {
    return Zotero.Reader._readers?.find(r => r.itemID === attachment?.id) || null;
  }
  function groupID(item) {
    const library = Zotero.Libraries.get(item.libraryID);
    return library?.libraryType === 'group' ? Zotero.Groups.getGroupIDFromLibraryID(item.libraryID) : null;
  }
  async function annotationCard(annotation, attachment) {
    if (!attachment?.isAttachment()) throw new Error('无法定位该选区的 PDF 附件');
    const parent = attachment.parentID ? Zotero.Items.get(attachment.parentID) : attachment;
    let image = annotation.image || '';
    const annotationKey = annotation.id || annotation.key;
    if (!image && ['image', 'ink'].includes(annotation.type) && annotationKey) {
      const saved = await Zotero.Items.getByLibraryAndKeyAsync(attachment.libraryID, annotationKey);
      if (saved?.parentID === attachment.id && saved.isAnnotation()) image = (await Zotero.Annotations.toJSON(saved)).image || '';
    }
    if (['image', 'ink'].includes(annotation.type) && !image) throw new Error('区域图片尚未生成。请先保存为 Zotero 区域批注，再拖入。');
    const card = {
      id: uuid(), kind: image ? 'pdf-region' : 'pdf-selection', libraryID: attachment.libraryID,
      attachmentKey: attachment.key, title: parent.getField('title') || attachment.getField('title'),
      text: [annotation.text, annotation.comment].filter(Boolean).join('\n'),
      pageLabel: annotation.pageLabel || '', position: annotation.position || null,
      image: image || undefined, capturedAt: new Date().toISOString(),
      sourceURI: Core.sourceURI({ attachmentKey: attachment.key, groupID: groupID(attachment), pageIndex: annotation.position?.pageIndex, annotationKey }),
    };
    if (card.text) try {
      const path = Zotero.Fulltext.getItemCacheFile(attachment).path;
      if (await IOUtils.exists(path)) {
        const info = await IOUtils.stat(path);
        if (info.size < 15 * 1024 * 1024) card.surroundingText = Core.nearbyText(await IOUtils.readUTF8(path), card.text);
      }
    } catch { /* The selection remains useful when the text cache is unavailable. */ }
    return Core.validateCards([card])[0];
  }
  function addCards(model, cards) { model.cards = Core.validateCards([...model.cards, ...cards]); model.status = `已加入 ${cards.length} 条材料；发送前可移除`; update(model); }
  async function drop(model, dataTransfer) {
    const annotations = dataTransfer.getData('zotero/annotation');
    if (annotations) {
      const values = JSON.parse(annotations);
      if (!Array.isArray(values) || values.length > 12) throw new Error('一次最多拖入 12 条批注');
      const cards = [];
      for (const value of values) {
        const attachment = Zotero.Items.get(Number(value.attachmentItemID));
        cards.push(await annotationCard(value, attachment));
      }
      addCards(model, cards); return;
    }
    const text = dataTransfer.getData('text/plain');
    if (text) addCards(model, [{ id: uuid(), kind: 'text', title: '拖入的文本（无页码来源）', text, capturedAt: new Date().toISOString() }]);
    else throw new Error('请拖入 Zotero 文字或区域批注');
  }
  function editorFor(noteID) { return bn()?.editor.getEditorInstance(noteID); }
  function noteCard(note, selectionOnly) {
    const api = bn(); if (!api) throw new Error('需要启用 Better Notes');
    const editor = editorFor(note.id); if (!editor) throw new Error('请先打开目标 Better Notes 笔记');
    if (api.editor.isMarkdownMode?.(editor)) throw new Error('当前原型请切换到 Better Notes 富文本模式后读取选区');
    const { from, to } = api.editor.getRangeAtCursor(editor);
    let text;
    if (selectionOnly) {
      if (from === to) throw new Error('请先在笔记中选中文字');
      text = api.editor.getTextBetween(editor, from, to);
    } else {
      // The editor document reflects unsaved changes; the persisted note may lag.
      const core = editor._iframeWindow?.wrappedJSObject?._currentEditorInstance?._editorCore;
      const doc = core?.view?.state?.doc;
      if (!doc) throw new Error('当前 Better Notes 编辑器版本尚未适配全文读取；可选中文字加入');
      text = doc.textBetween(0, doc.content.size, '\n');
    }
    if (text.length > 30000) throw new Error('笔记过长，请选中需要讨论的部分');
    return { id: uuid(), kind: selectionOnly ? 'note-selection' : 'note-context', libraryID: note.libraryID, noteKey: note.key, title: note.getNoteTitle(), text, capturedAt: new Date().toISOString(), sourceURI: `zotero://note/${groupID(note) ? groupID(note) : 'u'}/${note.key}/` };
  }
  async function insertAnswer(model, message, atCursor, capturedPosition) {
    const note = Zotero.Items.get(model.targetNoteID);
    if (!note?.isNote() || !note.isEditable()) throw new Error('请先选择一个可编辑的目标笔记');
    const api = bn(); if (!api) throw new Error('Better Notes 未启用');
    const sources = sessionFor(model.threadId).sources.get(message.turnId) || [];
    const html = Core.noteHTML(message.text, sources);
    const editor = editorFor(note.id);
    if (editor && api.editor.isMarkdownMode?.(editor)) throw new Error('当前原型请切换到 Better Notes 富文本模式后写入');
    if (atCursor) {
      if (!editor) throw new Error('请先打开目标笔记，放置光标');
      api.editor.insert(editor, html, capturedPosition ?? 'cursor');
    } else await api.note.insert(note, html);
    model.status = `已写入「${note.getNoteTitle()}」${atCursor ? '光标位置' : '末尾'}（v0.1 按纯文本段落保存，附来源）`;
    update(model);
  }
  function el(doc, tag, attrs = {}, text) {
    const node = doc.createElementNS(XHTML, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  class View {
    constructor(body, item) {
      this.body = body; this.doc = body.ownerDocument; this.model = modelFor(item); this.threadChoices = [];
      this.build(); views.add(this); this.render();
      if (this.model.threadId) this.run(() => loadHistory(this.model));
    }
    async run(fn) { try { await fn(); } catch (error) { this.model.status = error.message; update(this.model); } }
    button(label, handler, cls = '') {
      const node = el(this.doc, 'button', { type: 'button', class: cls }, label);
      node.addEventListener('click', () => this.run(handler)); return node;
    }
    build() {
      const d = this.doc; this.body.replaceChildren();
      const style = el(d, 'link', { rel: 'stylesheet', href: 'chrome://zotero-codex/content/panel.css' });
      this.root = el(d, 'div', { class: 'zc-panel' }); this.body.append(style, this.root);
      this.status = el(d, 'div', { class: 'zc-status', role: 'status' });
      const row = el(d, 'div', { class: 'zc-row' });
      this.select = el(d, 'select', { 'aria-label': 'Codex 会话' });
      this.select.addEventListener('change', () => this.run(async () => { bind(this.model, this.select.value); await loadHistory(this.model); }));
      row.append(this.select, this.button('历史', async () => {
        const response = await request('/threads'); this.threadChoices = response.data;
        this.model.status = '选择已有会话；桌面历史只读，同一插件会话可绑定到论文和笔记'; this.render();
      }), this.button('新建', async () => {
        const result = await request('/session', { title: this.model.item?.getField('title') || 'Zotero 论文阅读' });
        bind(this.model, result.thread.id); sessionFor(result.thread.id).writable = true; await loadHistory(this.model);
      }), this.button('刷新', () => loadHistory(this.model)));
      this.transcript = el(d, 'div', { class: 'zc-transcript', 'aria-label': '对话记录' });
      this.dropzone = el(d, 'div', { class: 'zc-drop' });
      this.dropzone.append(el(d, 'div', { class: 'zc-muted' }, '把文字、批注或图片区域拖到这里'));
      this.cards = el(d, 'div', { class: 'zc-cards' }); this.dropzone.append(this.cards);
      this.dropzone.addEventListener('dragover', event => { event.preventDefault(); this.dropzone.dataset.drag = 'true'; });
      this.dropzone.addEventListener('dragleave', () => delete this.dropzone.dataset.drag);
      this.dropzone.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); delete this.dropzone.dataset.drag; void this.run(() => drop(this.model, event.dataTransfer)); });
      const contextButtons = el(d, 'div', { class: 'zc-row' });
      contextButtons.append(this.button('加入笔记选区', () => {
        const note = Zotero.Items.get(this.model.targetNoteID); if (!note?.isNote()) throw new Error('请先选择目标笔记');
        addCards(this.model, [noteCard(note, true)]);
      }), this.button('加入当前笔记', () => {
        const note = Zotero.Items.get(this.model.targetNoteID); if (!note?.isNote()) throw new Error('请先选择目标笔记');
        addCards(this.model, [noteCard(note, false)]);
      }));
      // Keep reader/editor focus while clicking context controls.
      contextButtons.addEventListener('mousedown', event => event.preventDefault());
      this.input = el(d, 'textarea', { placeholder: '解释选区、讨论图表，或结合笔记提问…', 'aria-label': '问题' });
      this.input.value = this.model.draft;
      this.input.addEventListener('input', () => { this.model.draft = this.input.value; });
      this.input.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); this.run(() => this.send()); } });
      const actions = el(d, 'div', { class: 'zc-row' });
      this.sendButton = this.button('发送', () => this.send(), 'zc-send');
      this.stopButton = this.button('停止', () => request('/stop', { threadId: this.model.threadId }));
      actions.append(this.sendButton, this.stopButton, el(d, 'span', { class: 'zc-muted' }, '⌘ / Ctrl + Enter'));
      const notes = el(d, 'div', { class: 'zc-row' });
      notes.append(el(d, 'span', { class: 'zc-muted' }, '写入目标'));
      this.noteSelect = el(d, 'select', { 'aria-label': '目标 Better Notes 笔记' });
      this.noteSelect.addEventListener('change', () => { this.model.targetNoteID = Number(this.noteSelect.value) || null; });
      notes.append(this.noteSelect, this.button('更新列表', () => this.refreshNotes()));
      this.root.append(row, this.status, this.transcript, notes, this.dropzone, contextButtons, this.input, actions, el(d, 'div', { class: 'zc-muted' }, 'Zotero Codex 0.1.0 · 联动原型'));
      this.refreshNotes();
    }
    refreshNotes() {
      const ids = new Set();
      if (this.model.item?.isNote()) ids.add(this.model.item.id);
      for (const editor of Zotero.Notes._editorInstances || []) if (editor._item?.isNote()) ids.add(editor._item.id);
      let parent = this.model.item;
      if ((parent?.isAttachment() || parent?.isNote()) && parent.parentID) parent = Zotero.Items.get(parent.parentID);
      if (parent?.isRegularItem()) for (const id of parent.getNotes()) ids.add(id);
      this.noteSelect.replaceChildren(el(this.doc, 'option', { value: '' }, '请选择目标笔记'));
      for (const id of ids) {
        const note = Zotero.Items.get(id); if (note?.isEditable()) this.noteSelect.append(el(this.doc, 'option', { value: String(id) }, note.getNoteTitle() || '未命名笔记'));
      }
      this.noteSelect.value = this.model.targetNoteID ? String(this.model.targetNoteID) : '';
    }
    render() {
      const model = this.model, session = model.threadId ? sessionFor(model.threadId) : null;
      this.status.textContent = model.status || '选择或新建 Codex 会话，然后加入论文材料';
      const choices = new Map(this.threadChoices.map(t => [t.id, t]));
      if (model.threadId && !choices.has(model.threadId)) choices.set(model.threadId, { id: model.threadId, title: model.threadId.slice(0, 18), writable: session?.writable });
      this.select.replaceChildren(el(this.doc, 'option', { value: '' }, '选择 Codex 会话'));
      for (const t of choices.values()) this.select.append(el(this.doc, 'option', { value: t.id }, `${t.writable ? '' : '[只读] '}${t.title.slice(0, 70)}`));
      this.select.value = model.threadId;
      this.cards.replaceChildren();
      for (const card of model.cards) {
        const div = el(this.doc, 'div', { class: 'zc-card' });
        const row = el(this.doc, 'div', { class: 'zc-row' });
        row.append(el(this.doc, 'span', {}, card.title + (card.pageLabel ? ` · p. ${card.pageLabel}` : '')));
        if (card.sourceURI) row.append(this.button('原文', () => Zotero.launchURL(card.sourceURI)));
        row.append(this.button('移除', () => { model.cards = model.cards.filter(c => c.id !== card.id); update(model); }));
        div.append(row, el(this.doc, 'div', { class: 'zc-muted' }, card.text.slice(0, 160) + (card.text.length > 160 ? '…' : '')));
        if (card.image) div.append(el(this.doc, 'img', { src: card.image, alt: '待发送区域图片' }));
        this.cards.append(div);
      }
      const wasBottom = this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight < 60;
      this.transcript.replaceChildren();
      for (const message of session?.messages || []) {
        const div = el(this.doc, 'div', { class: 'zc-message', 'data-role': message.role });
        div.append(el(this.doc, 'div', {}, message.text));
        if (message.role === 'assistant' && message.done && message.text) {
          const row = el(this.doc, 'div', { class: 'zc-row zc-message-tools' });
          let position;
          const cursor = this.button('插入光标', () => insertAnswer(model, message, true, position));
          cursor.addEventListener('mousedown', event => {
            event.preventDefault();
            try { const editor = editorFor(model.targetNoteID); position = editor ? bn().editor.getRangeAtCursor(editor).to : undefined; } catch { position = undefined; }
          });
          row.append(cursor, this.button('追加笔记', () => insertAnswer(model, message, false))); div.append(row);
        }
        this.transcript.append(div);
      }
      if (!session?.messages.length) this.transcript.append(el(this.doc, 'div', { class: 'zc-muted' }, '选区会保留论文、页码和来源信息。图片会作为图像交给 Codex。'));
      if (wasBottom) this.transcript.scrollTop = this.transcript.scrollHeight;
      this.sendButton.disabled = !session?.writable || Boolean(session?.busy);
      this.stopButton.disabled = !session?.writable || !session?.busy;
      if (this.doc.activeElement !== this.input) this.input.value = model.draft;
    }
    async send() {
      const model = this.model, session = sessionFor(model.threadId);
      if (!model.threadId || !session.writable) throw new Error('请先新建插件会话，或选择已有插件会话');
      if (session.busy) throw new Error('请等待当前回答完成');
      const question = model.draft, cards = Core.validateCards(model.cards);
      Core.buildInput(question, cards);
      session.busy = true; model.status = '正在发送材料…'; update(model);
      const fingerprint = JSON.stringify({ question, cards });
      if (!session.pending || session.pending.fingerprint !== fingerprint) session.pending = { requestId: uuid(), fingerprint };
      const requestId = session.pending.requestId;
      try {
        const response = await request('/turn', { threadId: model.threadId, requestId, question, cards });
        session.sources.set(response.turn.id, cards);
        session.messages.push({ id: requestId, turnId: response.turn.id, role: 'user', text: question, done: true });
        session.pending = null;
        if (model.draft === question) { model.draft = ''; this.input.value = ''; }
        const sentIDs = new Set(cards.map(c => c.id));
        model.cards = model.cards.filter(c => !sentIDs.has(c.id));
        model.status = 'Codex 正在阅读并回答…';
      } catch (error) { session.busy = false; model.status = error.message + '\n问题与材料已保留；请刷新确认是否已发送。'; }
      update(model);
    }
    destroy() { views.delete(this); this.body.replaceChildren(); }
  }
  async function poll() {
    if (polling || shuttingDown) return; polling = true;
    try {
      const visibleIDs = new Set([...views].map(v => v.model.threadId).filter(Boolean));
      for (const id of visibleIDs) {
        const session = sessionFor(id);
        if (!session.loaded) continue;
        try {
          const response = await request(`/events?id=${encodeURIComponent(id)}&since=${session.cursor}`);
          if (response.reset) { const model = [...models.values()].find(m => m.threadId === id); if (model) await loadHistory(model); continue; }
          session.cursor = response.cursor;
          for (const event of response.events) {
            const p = event.params || {};
            if (event.method === 'item/agentMessage/delta') {
              let message = session.messages.find(m => m.id === p.itemId);
              if (!message) { message = { id: p.itemId, turnId: p.turnId, role: 'assistant', text: '', done: false }; session.messages.push(message); }
              message.text += p.delta;
            }
            if (event.method === 'item/completed' && p.item?.type === 'agentMessage') {
              let message = session.messages.find(m => m.id === p.item.id);
              if (!message) { message = { id: p.item.id, turnId: p.turnId, role: 'assistant' }; session.messages.push(message); }
              message.text = p.item.text; message.done = true;
            }
            if (event.method === 'turn/completed') {
              session.busy = false;
              for (const m of session.messages) if (m.turnId === p.turn?.id) m.done = true;
              for (const model of models.values()) if (model.threadId === id) model.status = p.turn?.error?.message || (p.turn?.status === 'interrupted' ? '已停止' : '回答已完成');
            }
            if (event.method === 'bridge/unsupportedRequest' || event.method === 'bridge/disconnect' || event.method === 'error') {
              for (const model of models.values()) if (model.threadId === id) model.status = p.message || p.error?.message || `当前原型暂不支持交互请求：${p.method}`;
            }
          }
          if (response.events.length) update();
        } catch (error) {
          for (const model of models.values()) if (model.threadId === id) model.status = error.message;
          update();
        }
      }
    } finally { polling = false; }
  }
  function prepareWindow(window) {
    if (winCleanups.has(window)) return;
    window.document.l10n?.addResourceIds(['zotero-codex.ftl']);
    winCleanups.set(window, () => window.document.l10n?.removeResourceIds(['zotero-codex.ftl']));
  }
  function unloadWindow(window) { winCleanups.get(window)?.(); winCleanups.delete(window); for (const v of [...views]) if (v.doc.defaultView === window) v.destroy(); }
  async function start() {
    try { bindings = JSON.parse(Zotero.Prefs.get(prefKey, true) || '{}'); } catch { bindings = {}; }
    for (const win of Zotero.getMainWindows()) prepareWindow(win);
    const registered = Zotero.ItemPaneManager.registerSection({
      paneID: PANE, pluginID: ID,
      header: { l10nID: 'zotero-codex-title', icon: 'chrome://zotero-codex/content/icon.svg', darkIcon: 'chrome://zotero-codex/content/icon-dark.svg' },
      sidenav: { l10nID: 'zotero-codex-tab', icon: 'chrome://zotero-codex/content/icon.svg', darkIcon: 'chrome://zotero-codex/content/icon-dark.svg' },
      onInit: ({ body }) => prepareWindow(body.ownerDocument.defaultView),
      onItemChange: ({ item, setEnabled }) => { setEnabled(Boolean(item)); return true; },
      onRender: ({ body, item }) => {
        for (const v of [...views]) if (v.body === body) { if (v.model.key === stableKey(item) && v.root.isConnected) { v.render(); return; } v.destroy(); }
        if (item) new View(body, item);
      },
      onDestroy: ({ body }) => { for (const v of [...views]) if (v.body === body) v.destroy(); },
    });
    if (!registered) throw new Error('Zotero 拒绝注册 Codex 侧栏');
    registeredPane = registered;
    selectionListener = event => {
      const annotation = JSON.parse(JSON.stringify(event.params.annotation || {}));
      const attachment = Zotero.Items.get(event.reader.itemID);
      const button = el(event.doc, 'button', { type: 'button' }, '加入 Codex');
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', async () => {
        try {
          const card = await annotationCard(annotation, attachment);
          const target = [...views].find(v => v.model.item?.id === attachment.id || v.model.item?.id === attachment.parentID)?.model || modelFor(attachment);
          addCards(target, [card]); button.textContent = '已加入 Codex';
        } catch (error) { button.textContent = error.message; }
      });
      event.append(button);
    };
    Zotero.Reader.registerEventListener('renderTextSelectionPopup', selectionListener, ID);
    const main = Zotero.getMainWindow(); pollTimer = main.setInterval(() => void poll(), 1200);
    Zotero.ZoteroCodex = { version: '0.1.0', models, sessions, annotationCard, noteCard, captureDrop: drop, sourceURI: Core.sourceURI, checkConnection: () => request('/status'), getViewDiagnostics: () => [...views].map(v => ({ connected:v.root.isConnected, bodyConnected:v.body.isConnected, key:v.model.key })) };
  }
  async function stop() {
    shuttingDown = true;
    Zotero.getMainWindow()?.clearInterval(pollTimer);
    Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', selectionListener);
    if (registeredPane) Zotero.ItemPaneManager.unregisterSection(registeredPane);
    for (const view of [...views]) view.destroy();
    for (const window of [...winCleanups.keys()]) unloadWindow(window);
    delete Zotero.ZoteroCodex;
  }
  return { start, stop, prepareWindow, unloadWindow };
})();
