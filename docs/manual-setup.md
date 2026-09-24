# 开发者手动部署（普通用户无需执行）

需要 Zotero 10、Node.js 22.13 或更新版本，以及 Better Notes（已验证 3.3.3）。建议使用 Node.js 24 LTS。项目包含 Zotero XPI 和 Node MCP 服务，两个组件均需安装。

## 1. 准备服务

```sh
git clone https://github.com/renhao12356578/zotero-codex.git
cd zotero-codex
npm ci
npm run build
```

保留这个目录。Codex 会从这里启动服务；无需手动常驻运行终端。不要只安装 XPI 后删除源码和 node_modules。

## 2. 安装插件

Zotero → 工具 → 插件 → 齿轮菜单 → 从文件安装插件，选择 `dist/zotero-codex-0.7.0.xpi`。也可从 [Release](https://github.com/renhao12356578/zotero-codex/releases/latest) 下载同版本 XPI。

在 Zotero 高级设置开启“允许此计算机上的其他应用程序与 Zotero 通信”，并启用 Better Notes。插件启用后，Zotero profile 目录会生成 `zotero-codex-mcp.json`；它含有本机连接令牌，不要公开或上传。profile 是 Zotero 的配置目录，通常不同于存储论文和数据库的数据目录。

profile 的常见父目录：

- macOS：`~/Library/Application Support/Zotero/Profiles/`
- Windows：`%APPDATA%\Zotero\Zotero\Profiles\`
- Linux：`~/.zotero/zotero/`

选择正在使用的 profile，以其中生成的连接文件为准；不要复制到另一个位置，插件重启会更新令牌。

## 3. 添加 MCP

在终端配置 Codex，替换下列三个绝对路径：

```sh
codex mcp add zotero -- /absolute/path/to/node /absolute/path/to/zotero-codex/mcp/server.mjs --connection-file '/absolute/path/to/profile/zotero-codex-mcp.json'
```

已有同名 MCP 时更新已有配置，避免重复添加。也可在支持 stdio MCP 的客户端中填写：

```json
{
  "mcpServers": {
    "zotero": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/zotero-codex/mcp/server.mjs",
        "--connection-file",
        "/absolute/path/to/profile/zotero-codex-mcp.json"
      ]
    }
  }
}
```

Windows JSON 路径中的反斜线需写为 `\\`。配置格式以客户端要求为准；上例为常见 stdio MCP 结构。

保持 Zotero 打开，重新加载客户端 MCP。首次原生 API 写入由 Zotero 弹窗请求授权；不需要 Zotero 云端 API key，也不需要向本项目填写 OpenAI API key。

## 4. 检查连接

```sh
node scripts/mcp-smoke.mjs '/absolute/path/to/profile/zotero-codex-mcp.json'
```

不传隔离测试 base 时，此命令只检查握手、43 个工具、连接状态和当前上下文，不写文库。如果 status 未就绪：

- API 无法连接：打开 Zotero，检查本地 API 开关及端口。默认端口为 23119。
- 连接文件不存在：检查 XPI 已启用、Zotero 版本兼容，并确认选择的是正确 profile。
- 笔记功能不可用：启用 Better Notes；某些操作需要先打开笔记编辑器。
- 文件同步被拒绝：关闭该笔记的全部编辑器，必要时选中另一篇笔记，再重新查询同步状态。冲突需在 Better Notes 内解决。

安装后可在客户端请求“检查 Zotero 连接状态”，再尝试搜索一篇论文或读取当前 PDF。

## 插件设置

Zotero → 设置 → 左侧「Zotero MCP」。阅读侧栏也有「打开 MCP 设置」按钮。

- **连接状态**：分别显示插件桥接是否就绪、原生 API 开关、Better Notes、最近访问插件的时间与识别到的 Node 服务版本。客户端访问插件的时间不等于持续在线；纯原生 API 工具调用不会更新这个时间。
- **阅读上下文**：文字与区域自动捕获默认开启，开关持久保存在本机，立即生效。关闭某项会清除该类型的自动快照；手动添加和拖入批注仍可用。清除上下文会清除所有阅读器的 MCP 快照及待生成截图，不删除已保存批注、笔记或客户端已有对话。
- **连接配置**：0.7.0 Node 服务访问插件后可识别 Node 和脚本路径；首次安装或旧服务需手动填写。复制的是通用 `mcpServers` JSON，包含连接文件路径但不含令牌。Codex CLI 配置命令仍见上文，修改本页路径不会自动重写客户端配置。
- **诊断**：检查本机桥接、原生 API 和连接文件，不验证 Codex 的配置，也不请求 AI。复制的报告不含令牌、绝对路径、论文标题或笔记内容。
- **版本与更新**：打开 GitHub Release；实际 XPI 更新仍由 Zotero 插件管理器执行。

## 更新

插件通过本仓库的 `updates.json` 获取 XPI 更新信息。更新时也要更新对应版本的 Node 服务：下载相同 Release 的源码，运行 `npm ci` 和 `npm run build`，再重新加载 MCP。不同版本混用可能导致工具清单与宿主功能不一致。

## 平台验证范围

真实 Zotero 宿主目前在 macOS 验证。Windows/Linux 的安装路径可参考上文，但图形宿主与拖拽操作尚未完成验收。测试证据见 [全流程报告](fullflow-test-report.md)。
