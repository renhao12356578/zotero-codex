# Zotero Codex MCP v0.5.0

首次公开发布。通过 MCP 将 Zotero 文库、PDF 阅读上下文和 Better Notes 笔记接入 Codex 等支持 stdio MCP 的客户端。

- 43 个工具：文献搜索、分类/标签、附件、批注、PDF 按页读取及页面图像。
- Better Notes：富文本直接编辑、Markdown 源码编辑与模式切换、大纲/链接读取、HTML/Markdown 转换、外部 Markdown 双向同步。
- 写入支持内容版本校验和请求去重；文件同步拒绝冲突和覆盖已有目标文件。
- MIT 开源，保留复用的 zotero-native-mcp 上游版权、源码、补丁和来源记录。

安装需要 Zotero 10、Node.js 22.13+ 和 Better Notes（已验证 3.3.3）。下载 XPI 并在 Zotero 插件管理器中安装；同时下载本 Release 源码并运行 `npm ci`、`npm run build`，配置 MCP 服务。XPI 本身不包含 Node 服务及依赖。完整步骤见仓库的 `docs/local-setup.md`。

验证：本项目 32 项、上游 60 项自动化测试通过；macOS + Zotero 10.0.3 + Better Notes 3.3.3 的 118 项宿主/stdio 检查及 4 项持久化/包检查通过，43 个工具均实际调用。开源发布阶段再次运行 92 项自动化测试并构建正式包。发布包新增 LICENSE/第三方说明，manifest 更新地址指向本仓库，功能代码与全流程验收版一致。

已知边界：Windows/Linux 图形宿主和真实鼠标拖拽尚未验收；Markdown 写入使用 Better Notes 自动保存。使用相同版本的 Node 服务和 XPI。文件校验见 `SHA256SUMS`。
