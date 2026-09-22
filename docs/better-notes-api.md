# Better Notes API → MCP（0.5.0）

这些接口由 Zotero 内的 XPI 调用本机 Better Notes API，外部只暴露明确的 MCP 操作，不提供任意 JavaScript 执行。

## 无需导出文件的 Markdown 编辑

1. `zotero_read_note({note,openEditor:true})` 读取即时内容和 revision。
2. 若 format 为 richtext，调用 `zotero_set_note_mode({note,mode:"markdown",revision,requestID})`。使用返回 snapshot 的新 revision。
3. 局部修改用 `zotero_edit_note`；完整替换用 `zotero_set_note_markdown`。
4. 返回中的 snapshot 是编辑后即时内容。必要时再次 read_note 读回。

```json
{
  "note": {"libraryID": 1, "key": "NOTE0001"},
  "revision": "上一份快照的 revision",
  "requestID": "本次写入的唯一 ID",
  "edits": [
    {"operation": "replace", "startLine": 3, "endLine": 5, "newText": "## 主要发现\n\n- 发现一\n- 发现二"}
  ]
}
```

Markdown 的行号从 1 开始，包括空行，范围闭区间；insert 在指定行之前插入，lineCount+1 表示追加。一次行补丁均相对于读取时的原始文档。重叠区间、同位置插入、插入点位于被替换区间内均拒绝。也可以用 `{oldText,newText}` 做唯一原文替换，Markdown 下允许跨行。不同格式不能混用。

底层调用 `api.editor.isMarkdownMode / toggleMarkdownMode / getMarkdownSource / setMarkdownSource`。整篇 Markdown 设置和补丁最后都是一次 setMarkdownSource，不等同于富文本 ProseMirror 撤销事务。Better Notes 按自己的保存策略转换为 Zotero HTML；`persistence: autosave-scheduled` 不代表落盘成功。通过 read_note 可核对即时源码。光标和选区 API 目前只接富文本；Markdown 返回 cursor=null。

所有源码写入需匹配 note 身份、即时内容、模式与 revision。requestID 在当前 Zotero 运行内去重，超时后先读回，不能更换 ID 盲目重发。同一个失败 ID 保留错误；明确修正请求并重新读取后再创建新操作。模式切换也有 revision 检查和去重。

## 结构、链接与转换

| MCP | Better Notes API | 数据语义 |
| --- | --- | --- |
| get_note_structure | note.getLinesInNote / getNoteTreeFlattened | 已保存 HTML 快照；返回分页行及起点落在当前页内的大纲节点，HTML 行超过 1 万字符会标注截断 |
| get_note_relations | relation.getNoteLinkInboundRelation / getNoteLinkOutboundRelation | 已索引关系，分页，可能晚于编辑器修改 |
| convert_note_content | convert.html2md / md2html | 输入文本转换，不写文件或笔记，不保证复杂内容往返无损 |

结构快照行号不等同于 Markdown 源码行号，修改前必须 read_note。不要将转换后的 HTML 当作已经导入图片、批注和引用的完整笔记。

## 外部 Markdown 同步

1. 关闭目标笔记的所有编辑器，包括文库右侧当前选中的笔记（若侧栏保留编辑器，切换到另一篇笔记使其卸载）。
2. `get_note_sync({note})` 查询状态，获取 syncRevision。
3. `sync_note({note,action:"enable",directory:"/absolute/path",syncRevision,requestID})` 首次导出并绑定。
4. 编辑文件后，再次 get_note_sync，然后 `sync_note({note,action:"sync",syncRevision,requestID})` 双向同步。
5. `action:"disable"` 解除绑定，保留文件和笔记。

enable 调用 `api.sync.getMDFileName` 与 `api.$export.syncMDBatch`，不覆盖已有文件；sync 调用 `hooks.onSyncing`，复用 Better Notes 的比较、导入和再导出流程；disable 调用 `api.sync.removeSyncNote`。同步前读取实际文件和笔记状态建立快照，并核对文件元数据的文库、条目身份。冲突、文件缺失、版本变化、打开的编辑器、超 8 MB 文件均会拒绝。调用后再次核对哈希，不能把 Better Notes 静默失败当成同步成功。

Better Notes 文件同步可能执行用户已有导出模板及图片转换逻辑；它不是文件系统事务，遇到磁盘错误或其他进程同时写入时可能需要在插件界面恢复。MCP 不提供强制覆盖和自动解决双向冲突。

## 本轮边界

- 没有暴露模板代码执行、内部 DOM 操作和任意 API 名称调用。
- 未新增整份 HTML 源码覆盖、图像/表格/章节移动的专门工具；已有富文本局部编辑仍可用。
- PDF 选区与来源、原生文库工具保持原有入口。
- 安装 0.5.0 XPI 后需重新加载 MCP 清单；工具数从 36 增至 43。
