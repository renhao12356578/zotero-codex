# 0.8.1 高级设置验证

验证日期：2026-09-25。

- 本机 53 项测试通过，包括自定义配置导出不修改自动组件偏好、无效路径拒绝导出、普通导出继续使用原路径。
- [云端构建](https://github.com/renhao12356578/zotero-codex/actions/runs/36092850533)：macOS arm64/x64、Windows x64、Linux arm64/x64 通过测试及运行包自检；Node 22.13.1 兼容性测试通过。
- [真实 Zotero 设置页](advanced-settings-host-result.json)：在隔离的 Zotero 10.0.3 宿主中通过 19 项检查，包含默认隐藏编辑区、自定义导出、错误提示、关闭开发者模式恢复自动路径、只读信息保持原路径、连接诊断及无横向溢出。使用测试笔记与测试路径，没有修改日常文库或 Codex 配置。
- 正式 XPI 与源码逐文件核对，12 个发布附件齐全，10 个运行 ZIP 的大小与清单一致。

XPI SHA256：`c5bee1540255c669fa4ebd73a7142a3658d9377ca230d34e3a5c3bd75fef73d3`。

真实设置页验收覆盖 macOS。Windows/Linux 完成服务测试和运行包自检，未进行图形宿主验收。
