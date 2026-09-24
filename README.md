# Zotero Codex MCP 0.6.1

在 Zotero 看论文、写 Better Notes，在 Codex 中直接读 PDF、讨论选区、编辑笔记。

[下载 XPI](https://github.com/renhao12356578/zotero-codex/releases/latest) · [安装指南](docs/local-setup.md) · [MIT 许可证](LICENSE)

本项目为社区开发，与 OpenAI、Zotero 官方无隶属关系。通过本地 MCP 连接 Zotero；选中的论文/笔记内容会作为上下文交给你使用的 AI 客户端。

这版**直接包含并运行** [dvdsosa/zotero-native-mcp](https://github.com/dvdsosa/zotero-native-mcp) 的源码：复用原生 API 客户端及 28 个工具实现，其中状态检查与插件状态合并为一个入口。移除原来重复的搜索、元数据和全文缓存实现，补充 15 个实时联动、PDF 和 Better Notes 工具。共 43 个工具，仍使用一个 Codex MCP 配置。

## 直接复用的代码

- 源码：`vendor/zotero-native-mcp/src`，固定提交 `4bd9972e93e2336db99320c935d9ea2cbb1615a4`。
- MIT 许可证原文和完整仓库快照已保留；`UPSTREAM.json` 保存来源与每个源码文件的 SHA-256。除全文分页扩展外，源码与上游逐字节一致；该扩展的补丁、原始哈希及修改后哈希均有记录。
- `npm run build:native` 编译这些 TypeScript 文件，`mcp/native.mjs` **直接导入执行**原客户端和五个工具注册模块。
- 通过官方 SDK 的进程内 MCP 连接挂接，工具沿用上游 `zotero_*` 名称、参数、校验和授权流程；状态检查由外层合并返回，其他工具直接调用原实现。
- 附件定位与已有全文读取使用原代码；按页文字和图片直接使用 Mozilla PDF.js。归属说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

合并依据、工具迁移和取舍见 [docs/tool-consolidation.md](docs/tool-consolidation.md)。旧 `zotero_library_*` 名称不再暴露；搜索使用 `q`，条目读取使用 `itemKey`，不再使用旧版 `query`/`item` 参数。

0.6.1 新增 Zotero 原生设置页：在「设置 → Zotero MCP」查看连接状态、控制自动捕获、复制连接配置和运行脱敏诊断。0.5.1 起支持区域截图自动捕获，无需拖入侧栏。

## 可以做什么

| 场景 | 工具/实现 |
| --- | --- |
| 搜索文献、读取元数据、分类、标签和保存的搜索 | 上游 `zotero_*` 工具 |
| 读取已有全文索引 | 上游 `zotero_get_item_fulltext` |
| 读取 PDF 指定页、返回页面图片 | `zotero_read_pdf`，复用上游附件定位 + PDF.js |
| 知道当前论文、阅读页码、文字选区/区域图 | `zotero_get_context` / `zotero_get_selection` |
| 获取已保存批注和来源 | `zotero_get_annotations` |
| 新建普通 Zotero/Better Notes 笔记 | 上游 `zotero_create_items`，itemType 为 note |
| 读取未保存的笔记 | `zotero_read_note`，支持自动打开编辑器 |
| 替换或删除笔记中指定原文 | `zotero_edit_note`，通过编辑器事务修改 |
| 追加段落、光标插入、附来源 | `zotero_write_note` |
| 将上游 itemKey/groupId 转换成本机笔记身份 | `zotero_resolve_item` |

原生工具还包括附件导入、文献导出、分类管理等上游功能；只有用户要求时才执行相应写操作。上游已有笔记正文的直接 JSON 覆盖在适配层拦截，转用编辑器工具，避免覆盖尚未保存的内容。新建笔记和文献元数据修改仍执行上游原处理函数。

常用说法：
- “看看我正在读哪篇论文，解释刚选中的段落。”
- “读这篇 PDF 第 5 页，把图也看一下。”
- “创建一篇这篇论文的阅读笔记。”
- “把笔记中这句话改成……，直接替换原文。”
- “把刚才的总结追加到笔记末尾，保留论文来源。”

0.5.0 同时更新 Node MCP 服务和 XPI，新增 Better Notes Markdown 源码、结构、链接、格式转换和文件同步接口。重新加载 MCP 并安装新的 XPI 后即可使用。

## 安装和接入

需要 Zotero 10、Node.js（具体最低版本见 package.json）；实时笔记编辑需要 Better Notes，已验证版本 3.3.3。

1. 克隆源码并安装服务依赖（或下载 Release 对应的源码压缩包）：

   ```sh
   git clone https://github.com/renhao12356578/zotero-codex.git
   cd zotero-codex
   npm ci
   npm run build
   ```
2. Zotero → 工具 → 插件 → 齿轮 → 从文件安装，选择 `dist/zotero-codex-0.6.1.xpi`。
3. 添加 MCP，路径替换为本机绝对路径：

```sh
codex mcp add zotero -- /absolute/path/to/node /absolute/path/to/zotero-codex/mcp/server.mjs --connection-file '/absolute/path/to/Zotero/profile/zotero-codex-mcp.json'
```

4. 保持 Zotero 打开，重新加载 Codex MCP 或重启 Codex。已有 `zotero` 配置指向本项目时不用重复添加。

上游文库工具默认连接 `http://127.0.0.1:23119`，需要在 Zotero 高级设置启用“允许此计算机上的其他应用程序与 Zotero 通信”。首次原生 API 写入沿用 Zotero 自身的授权弹窗，可以授予单次或持久访问；使用的是本机 API key，不是云端 key。可通过 `ZOTERO_LOCAL_PORT` / `ZOTERO_LOCAL_BASE_URL` 指定本机地址。原生工具读取和 PDF 按页读取无需 XPI；实时选区和笔记编辑需要 XPI。

XPI 启用后在 profile 生成权限为 0600 的连接文件，令牌随插件启动刷新。Codex 自动启动 Node 服务，不需要自己常驻运行终端。

安装和排查步骤见 [docs/local-setup.md](docs/local-setup.md)。Release 中的 XPI 只包含 Zotero 端插件；Node MCP 服务仍需保留上述源码目录和依赖。

## 笔记编辑如何工作

先使用 `zotero_resolve_item` 将 `itemKey`（以及群组的 `groupId`）换成本机 `{libraryID,key}`，不要把云端 userID/groupID 当作 libraryID。然后：

```text
read_note(note, openEditor=true)
    ↓ 返回当前未保存文本和 revision
edit_note(note, revision, requestID,
          edits=[{oldText:"原文",newText:"修改后的文字"}])
```

富文本模式下，每个原文匹配必须位于一个段落内且唯一。一次可以提交多处修改；全部匹配后才提交一个 ProseMirror 事务，支持编辑器撤销。空 newText 表示删除匹配的文字。未修改区域的格式、链接、图片保留，新文字继承插入位置的样式。原文不唯一、跨段落或用户已经修改内容时返回错误，不进行部分修改。

也可以按笔记段落进行代码式编辑。`read_note` 返回 `lineCount`，行号从 1 开始；`edit_note` 的 `edits` 可使用 `{operation:"replace",startLine:3,endLine:5,newText:"..."}`、`{operation:"delete",startLine:8,endLine:9}` 或 `{operation:"insert",startLine:4,newText:"..."}`。行补丁中的每个换行会生成一个新的段落，适合重写连续笔记内容；一次请求不能混用行补丁和 `oldText/newText`。所有行补丁也会先检查范围和重叠，再作为一个可撤销事务提交。

追加和光标插入仍用 `write_note`。revision 校验笔记内容和编辑器状态；requestID 在本次 Zotero 运行内去重。超时后先读回确认，不要换 ID 盲目重试；重启 Zotero 后去重记录不保留。

## Better Notes API（0.5.0）

| 工具 | 能力 |
| --- | --- |
| `zotero_set_note_mode` | 打开笔记并切换 `markdown` / `richtext`，需要当前 revision，返回新快照 |
| `zotero_set_note_markdown` | 设置完整 Markdown 源码，支持空字符串，带 revision / requestID |
| `zotero_get_note_structure` | 分页读取已保存 HTML 行、大纲、章节范围 |
| `zotero_get_note_relations` | 分页读取出链或反向链接索引 |
| `zotero_convert_note_content` | 调用 Better Notes 将 HTML 与 Markdown 文本互转，不保存 |
| `zotero_get_note_sync` | 查询同步绑定、文件路径、双方改动和冲突，返回 syncRevision |
| `zotero_sync_note` | enable 导出并绑定文件、sync 双向同步、disable 解除绑定并保留文件 |

不需要文件同步也能编辑 Markdown：`read_note → set_note_mode(mode="markdown") → edit_note / set_note_markdown`。每一步使用最新快照里的 revision。`read_note.format` 表示当前模式；Markdown 下 `text` 是源码，行号包括空行，原文替换允许跨行。`cursor` 为 null，暂未接 Markdown 选区读取。Markdown 写入通过 Better Notes `setMarkdownSource`，返回 `persistence: "autosave-scheduled"` 表示已更新编辑器并安排自动保存，不宣称已落盘；返回的 snapshot 可验证即时内容。富文本模式的局部编辑仍走编辑器事务。

外部文件同步流程：关闭目标笔记的所有编辑器，`get_note_sync → sync_note`。enable 需要绝对 `directory`，会创建目录，拒绝覆盖已有目标文件；已绑定笔记使用 sync。两边同时改动、文件元数据身份不符、快照过期或文件缺失时拒绝同步。先在 Better Notes 自身界面处理冲突，再重新读取状态。首次导出会执行用户已有的 Better Notes 导出模板；本 MCP 不暴露任意模板执行接口。

`get_note_structure` 返回已保存 HTML 结构的行号，不是 Markdown 源码行号，也不能把它的分页结果当成即时编辑快照。链接来自 Better Notes 索引，可能有延迟。格式转换不是包含图片与引用元数据的完整保真文件导入。

示例与 API 对应关系见 [docs/better-notes-api.md](docs/better-notes-api.md)。

## PDF 和选区

- `zotero_read_pdf` 页号从 1 开始，一次最多 5 页；需要页面图片时传 `includeImage=true,pageCount=1`。基于实际 PDF 页而非全文缓存猜页码。
- 全文索引入口统一为 `zotero_get_item_fulltext(itemKey,offset,maxCharacters,expectedRevision?)`：默认每次读取 5 万字符，单次最多 50 万字符；这不是全文总长度限制。用返回的 attachmentKey、nextOffset 和 revision（传入 expectedRevision）继续读，直到 nextOffset=null。正文变化时有校验，UTF-16 偏移不会拆开 Unicode 代理对。按页看图仍使用 read_pdf。
- 默认只读文件内的文字层；扫描件可传页面图片给 Codex 理解，没有独立 OCR 引擎。
- 文献有多个 PDF 时必须选择明确的附件 key。
- PDF 文字弹窗出现时保存选区快照；使用 Zotero 区域批注工具框选后，自动等待截图生成并保存区域快照，无需拖拽。读取 `get_selection` 即返回图片、页码和来源；已有批注仍可拖入侧栏。只捕获 Reader 新建区域，后台同步/导入不覆盖当前上下文。
- 快照按 readerID 分开，默认 30 分钟过期，带来源和时间，不代表当前仍高亮。

## 验证

2026-09-22 在 macOS arm64、Zotero 10.0.3、Better Notes 3.3.3 上完成全流程回归。43/43 个工具均经过真实 MCP SDK stdio 调用；118 项宿主/端到端检查及 4 项退出后持久化与安装包检查通过。完整结果与复现步骤见 [全流程测试报告](docs/fullflow-test-report.md)。

- `npm test`：32 项本项目测试通过。
- `npm run test:upstream`：60 项上游单元测试通过。
- 普通宿主 20 项、标准 stdio 17 项、扩展 stdio 36 项、Better Notes 宿主 20 项、Better Notes stdio 25 项全部通过。
- 覆盖文献/分类/标签/回收站、真实 PDF 文字及页面图像、富文本行编辑、Markdown 模式切换、双向同步、请求重试与冲突保护。
- 所有写入只涉及隔离文库及测试文件；未改动真实用户文库。隔离测试不代替安装后的本机连接检查。

```sh
# 只读诊断：握手、列工具、读取 API/插件状态和上下文
node scripts/mcp-smoke.mjs '/absolute/path/to/profile/zotero-codex-mcp.json'
```

`prepare-host-smoke.py` 准备隔离宿主；以独立 profile 启动 Zotero 后，给 smoke 脚本第三个参数传该测试 base 路径，才启用写入检查。测试包仅在独立 profile 中模拟原生授权弹窗的同意结果，正式 XPI 不含该测试逻辑。

## 当前边界

编辑已有笔记支持富文本模式的段内文字替换/删除，以及按段落行号的插入、替换和删除；支持 Markdown 源码编辑，但没有复杂富文本结构的专门编辑接口。富文本行补丁和 write_note 插入纯文本段落；Markdown 模式交由 Better Notes 处理语法、公式及引用转换。Reader/即时编辑器部分依赖 Zotero 内部接口，升级后需要回归验证。真实鼠标拖拽及 Windows 宿主还未验收。Release 提供 XPI；MCP 服务源码和依赖也需与 XPI 保持相同版本。

旧聊天原型源码留在 `legacy/chat-v0.1`、`bridge`，当前入口不运行 Codex App Server；聊天和会话仍由 Codex 自己负责。

## 开源与贡献

本项目原创代码采用 [MIT](LICENSE) 许可证；复用的上游代码保留其原始 MIT 许可证与版权声明，见 [第三方说明](THIRD_PARTY_NOTICES.md)。

欢迎提交 Issue 和 Pull Request。提交前运行 `npm test`、`npm run test:upstream` 和 `npm run build`。需要 Zotero 的写入测试请使用隔离 profile，复现步骤见全流程报告。GitHub Actions 在 Linux 和 macOS 上运行自动化测试及 XPI 构建；这些检查不包含 Zotero 图形宿主测试。
