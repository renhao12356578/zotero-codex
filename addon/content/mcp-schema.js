/* Shared MCP tool contract and validation, used by Node and Zotero. */
(function (root) {
  const str = (maxLength = 200) => ({ type: 'string', minLength: 1, maxLength });
  const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
  const ref = { type: 'object', properties: { libraryID: integer(1, 2147483647), key: { type: 'string', pattern: '^[A-Z0-9]{8}$' } }, required: ['libraryID', 'key'], additionalProperties: false };
  const tool = (name, description, properties = {}, required = [], write = false) => ({ name: 'zotero_' + name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: false } });
  const tools = [
    tool('status', '统一检查本地 API 和实时插件：分别返回 nativeAPI/plugin 状态、错误、写权限与版本。部分不可用时仍返回另一部分。'),
    tool('get_context', '读取当前 Zotero 标签、论文、阅读页码、打开的笔记及选区快照摘要。先用此工具确定条目身份。'),
    tool('resolve_item', '将上游文库工具返回的 itemKey/groupId 转为本机 libraryID/key，供 read_note、edit_note 等实时工具使用。省略 groupId 表示个人文库。', { itemKey: { type:'string',pattern:'^[A-Z0-9]{8}$' }, groupId: integer(1,2147483647) }, ['itemKey']),
    tool('get_selection', '读取当前阅读器自动捕获的文字选区或新建区域批注截图（无需拖拽），或指定 readerID 的快照；带时间、来源、邻近正文和实际区域图片。这是快照，不代表仍高亮。', { readerID: str(), maxAgeSeconds: integer(1, 86400) }),
    tool('get_annotations', '分页列出附件的已保存批注。指定 annotationKey 获取单条，includeImages=true 返回实际 PNG/JPEG 图片（最多 3 张）。', { attachment: ref, annotationKey: { type: 'string', pattern: '^[A-Z0-9]{8}$' }, includeImages: { type: 'boolean' }, offset: integer(0, 1000000), limit: integer(1, 30) }, ['attachment']),
    tool('read_note', '读取指定笔记。返回未保存内容、光标及 revision。需要编辑时传 openEditor=true 自动在 Better Notes 打开笔记。自动识别富文本/Markdown 模式；format=markdown 时 text 是即时 Markdown 源码，行号对应源码行。', { note: ref, openEditor: { type: 'boolean' }, offset: integer(0, 100000000), limit: integer(1, 30000) }, ['note']),
    tool('edit_note', '像编辑代码一样直接修改已有笔记。先 read_note(openEditor=true)，再提交 revision 和 edits。兼容按唯一原文替换 {oldText,newText}；也支持按 1-based 行号的补丁：{operation:"replace",startLine,endLine,newText} 替换行区间，{operation:"delete",startLine,endLine} 删除行区间，{operation:"insert",startLine,newText} 在该行前插入。富文本的行号指顶层段落，替换内容为纯文本；Markdown 模式的行号指源码行，支持跨行原文替换；同一次请求不能混用两种格式。富文本以编辑器事务提交；Markdown 通过 Better Notes setMarkdownSource 写回并安排自动保存，返回不代表已落盘。', { note: ref, revision: str(), requestID: str(), edits: { type: 'array', minItems: 1, maxItems: 30, items: { oneOf: [
      { type: 'object', properties: { oldText: { ...str(10000), pattern: '^[^\\uFFFC]+$' }, newText: { type: 'string', maxLength: 10000, pattern: '^[^\\uFFFC]*$' } }, required: ['oldText','newText'], additionalProperties: false },
      { type: 'object', properties: { operation: { type: 'string', enum: ['replace'] }, startLine: integer(1, 1000000), endLine: integer(1, 1000000), newText: { type: 'string', maxLength: 60000, pattern: '^[^\\uFFFC]*$' } }, required: ['operation','startLine','endLine','newText'], additionalProperties: false },
      { type: 'object', properties: { operation: { type: 'string', enum: ['delete'] }, startLine: integer(1, 1000000), endLine: integer(1, 1000000) }, required: ['operation','startLine','endLine'], additionalProperties: false },
      { type: 'object', properties: { operation: { type: 'string', enum: ['insert'] }, startLine: integer(1, 1000000), newText: { type: 'string', minLength: 1, maxLength: 60000, pattern: '^[^\\uFFFC]*$' } }, required: ['operation','startLine','newText'], additionalProperties: false }
    ] } } }, ['note','revision','requestID','edits'], true),
    tool('set_note_mode', '打开笔记并切换 Better Notes 编辑模式（markdown/richtext），返回新的 read_note 快照和 revision。需先 read_note 获取 revision；不导出文件。', { note: ref, mode: {type:'string',enum:['markdown','richtext']}, revision:str(), requestID:str() }, ['note','mode','revision','requestID'], true),
    tool('set_note_markdown', '替换当前 Markdown 编辑器的完整源码。先 read_note，必要时 set_note_mode。支持空字符串清空；必须使用最新 revision。通过 Better Notes 自动保存，不保证返回时已落盘。', { note:ref, markdown:{type:'string',maxLength:60000}, revision:str(), requestID:str() }, ['note','markdown','revision','requestID'], true),
    tool('get_note_structure', '通过 Better Notes 读取已保存笔记的大纲与 HTML 行（可分页）。这是已保存快照，不代表编辑器即时状态，行号也不等同于 Markdown 源码行。', {note:ref,offset:integer(0,1000000),limit:integer(1,100)}, ['note']),
    tool('get_note_relations', '通过 Better Notes 读取已索引的笔记出链和反向链接（分页），不触发全库重建。索引可能晚于编辑器内容。', {note:ref,direction:{type:'string',enum:['outbound','inbound']},offset:integer(0,1000000),limit:integer(1,100)}, ['note','direction']),
    tool('convert_note_content', '通过 Better Notes 进行 HTML 与 Markdown 文本转换，仅返回结果，不保存笔记或文件，也不等价于完整保真导入。', {content:{type:'string',maxLength:60000},from:{type:'string',enum:['html','markdown']}}, ['content','from']),
    tool('get_note_sync', '查询 Better Notes 笔记是否启用外部 Markdown 同步、文件路径、两边是否改动以及冲突状态；返回 syncRevision，供 sync_note 使用。不返回文件正文。', {note:ref}, ['note']),
    tool('sync_note', '管理明确指定笔记的 Better Notes 文件同步：enable 导出到绝对目录并建立绑定（拒绝覆盖现有文件）；sync 双向同步；disable 解除绑定但保留文件。必须先 get_note_sync 获取 syncRevision。要求关闭该笔记的所有编辑器；两边同时改动时拒绝自动覆盖。不会代为处理冲突对话框。', {note:ref,action:{type:'string',enum:['enable','sync','disable']},directory:str(2000),syncRevision:str(),requestID:str()}, ['note','action','syncRevision','requestID'], true),
    tool('read_pdf', '读取本地 Zotero PDF 的指定页，不依赖全文索引。itemKey 可为 PDF 附件或只有一个 PDF 的文献。includeImage=true 且 pageCount=1 时返回页面图片，可理解图表和扫描页；没有自动 OCR。页号从 1 开始。通过直接复用的上游文件定位工具解析路径。', { itemKey: {type:'string',pattern:'^[A-Z0-9]{8}$'}, groupId: integer(1,2147483647), startPage: integer(1,1000000), pageCount: integer(1,5), includeImage: {type:'boolean'} }, ['itemKey']),
    tool('write_note', '向明确指定的笔记追加，或在 read_note 捕获的光标位置插入纯文本段落，可附来源。必须先 read_note 获得 revision；内容变化会拒绝。仅用户要求写笔记时调用。相同 requestID 可在本次 Zotero 运行中去重，超时不要换 ID 重试。', { note: ref, revision: str(), requestID: str(), text: str(60000), mode: { type: 'string', enum: ['append', 'cursor'] }, sources: { type: 'array', maxItems: 12, items: { type: 'object', properties: { title: str(500), sourceURI: { type: 'string', maxLength: 500, pattern: '^zotero://(open-pdf|note)/' }, pageLabel: str(40) }, required: ['sourceURI'], additionalProperties: false } } }, ['note', 'revision', 'requestID', 'text', 'mode'], true),
  ];
  function validate(schema, value, path = 'arguments') {
    if (schema.oneOf) {
      const matches = schema.oneOf.filter(candidate => {
        try { validate(candidate, value, path); return true; } catch { return false; }
      });
      if (matches.length !== 1) throw new Error(path + ' does not match exactly one supported shape');
      return;
    }
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(path + ' must be an object');
      for (const key of schema.required || []) if (!(key in value)) throw new Error(path + '.' + key + ' is required');
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) throw new Error(path + '.' + key + ' is not supported');
        validate(schema.properties[key], value[key], path + '.' + key);
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value) || value.length > schema.maxItems || value.length < (schema.minItems || 0)) throw new Error(path + ' invalid array');
      value.forEach((v, i) => validate(schema.items, v, path + '[' + i + ']'));
    } else if (schema.type === 'integer') {
      if (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum) throw new Error(path + ' invalid integer');
    } else if (typeof value !== schema.type) throw new Error(path + ' invalid type');
    if (schema.type === 'string' && ((schema.minLength && value.length < schema.minLength) || (schema.maxLength && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw new Error(path + ' invalid string');
    if (schema.enum && !schema.enum.includes(value)) throw new Error(path + ' invalid value');
  }
  function validateCall(name, args) {
    const definition = tools.find(t => t.name === name);
    if (!definition) throw new Error('Unknown tool: ' + name);
    validate(definition.inputSchema, args);
    return definition;
  }
  const api = { tools, validateCall };
  if (typeof module !== 'undefined') module.exports = api;
  root.ZoteroMCPContract = api;
})(globalThis);
