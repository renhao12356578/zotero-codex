# 0.7.0 自动安装验证

验证日期：2026-09-24。

- [运行包 CI](https://github.com/renhao12356578/zotero-codex/actions/runs/35963559516)：macOS arm64/x64、Windows x64、Linux arm64/x64 全部成功；各平台通过 49 项单元测试和运行包自检。Node 24 LTS、PDF 原生画布、编译后的原生 API 工具均包含在运行包中。
- [隔离 Zotero 宿主](runtime-host-result.json)：11/11。覆盖 SHA256 不符拒绝安装、重试、真实 ZIP 解压和 Node 进程执行、配置备份、保留其他设置、本地 API 开启、复用已安装组件、损坏后换目录修复和更新托管配置。此组测试替换下载传输为本地运行包，以稳定注入损坏清单。
- [托管服务 stdio](runtime-stdio-result.json)：3/3。直接使用插件写入的命令和参数启动安装目录中的 Node/MCP，列出 43 个工具、连接真实 Zotero、读取上下文。
- [日常安装只读验证](runtime-daily-result.json)：5/5。在 Zotero 10.0.4 中通过插件管理器安装正式 XPI，插件从公开 GitHub Release 自动下载并校验 Node 24 运行包，一键迁移已有源码配置。比较备份与新 TOML，其他 Codex 设置完全保留。托管进程与插件均为 0.7.0，43 个工具可用，并成功读取当前阅读器上下文。没有写入或删除用户文库条目/笔记。

发布运行包的源码文件与发布提交逐字节核对，五个 ZIP 大小和 SHA256 均与清单一致。本机安装 XPI 与发布 XPI 相同：`c0bda466c6c9e48a9b8ce9ea649620d62bdcd5a75b33084b08430c77561b2d67`。

真实图形宿主覆盖 macOS；Windows/Linux 目前覆盖 CI 服务测试和运行包自检，尚未完成真实 Zotero 图形安装验收。
