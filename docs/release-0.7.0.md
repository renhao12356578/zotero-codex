# 0.7.0 — 安装 XPI，一键连接 Codex

普通用户不再需要安装 Node.js、下载源码、执行 npm 或手动填写路径。

- Zotero 插件启动后自动检测、下载与系统匹配的完整运行组件，显示下载、校验、安装进度。
- 设置中的「连接 Codex」自动备份并更新 Zotero MCP 配置，同时开启 Zotero 本地 API。完成后重启 Codex 即可使用。
- 升级时自动准备匹配版本；校验或试运行失败保留原有安装；下载失败可重试。
- 保留其他 MCP、模型配置及工具权限；不同服务占用同名连接时提示冲突，不覆盖。
- 手动部署路径折叠到高级设置，继续支持其他 MCP 客户端。
- 提供 macOS arm64/x64、Windows x64、Linux x64/arm64 运行包，内含 Node、编译后的服务和 PDF 原生依赖。

只需下载 XPI；runtime ZIP 和清单由插件自动使用。Better Notes 仍需单独安装。

首次安装指南：https://github.com/renhao12356578/zotero-codex/blob/main/docs/local-setup.md

真实 Zotero 图形宿主流程验证于 macOS；其他平台验证范围为 CI 运行包与服务检查。
