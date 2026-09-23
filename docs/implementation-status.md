# 当前实现：0.5.1，区域截图自动捕获

2026-09-23。新增 Reader 区域批注自动捕获：无需拖拽即可通过 get_selection 读取实际 PNG、页码和来源。后台导入/同步不覆盖快照，异步图像不能覆盖更新的区域或文字选择。

本轮验证：37 项自动化测试、5 项真实 Reader 区域渲染/捕获检查、3 项 MCP stdio 图片检查通过。报告见 `region-host-result.json`、`region-stdio-result.json`。图形宿主测试使用程序创建真实 Reader 批注，未验收实际鼠标手势。

安装包：`dist/zotero-codex-0.5.1.xpi`。同时更新 Node 服务并重新加载 MCP。日常运行中的旧 XPI 未直接替换。

---

# 当前实现：0.5.0，Better Notes API 接入

2026-09-22。43 个 MCP 工具：复用上游 28 个工具，其中状态入口合并；15 个补充工具负责实时上下文、PDF 和 Better Notes。

新增 7 个工具：set_note_mode、set_note_markdown、get_note_structure、get_note_relations、convert_note_content、get_note_sync、sync_note。read_note/edit_note 自动适配 Markdown 源码；富文本编辑保留原有实现。Markdown 不需要外部 .md 文件，同步工具用于另行管理外部文件绑定。

- 编辑器写入有内容 revision 检查、请求去重和即时读回。Markdown 保存由 Better Notes 异步完成。
- Markdown 切回富文本时调用 Zotero 增量更新接口，避免读到旧的隐藏富文本文档。
- 首次导出拒绝覆盖已有文件。同步需关闭目标编辑器，等待 Better Notes 现有同步结束，检查笔记/文件快照与冲突，并在调用后检查实际哈希。
- 已保存结构、关系索引与即时源码明确区分；没有开放任意 JS 或模板执行工具。
- 原生文库、全文分页、PDF、选区工具和上游源码/许可证保持原有实现。

验证（2026-09-22）：本项目 32 项、上游 60 项自动化测试通过；Zotero 10.0.3 + Better Notes 3.3.3 的 118 项隔离宿主/stdio 检查通过，43 个工具全部通过真实 stdio 调用。另有 4 项退出后持久化与正式包检查通过。详见 [全流程测试报告](fullflow-test-report.md)。没有改动日常文库。

安装包：`dist/zotero-codex-0.5.0.xpi`。本轮未替换安装到日常 Zotero。安装后重新加载 MCP 清单，使用细节见 `better-notes-api.md`。
