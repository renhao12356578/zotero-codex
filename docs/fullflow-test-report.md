# MCP 全流程测试报告

日期：2026-09-22。版本：0.5.0。环境：macOS 26.4.1 arm64、Node.js 25.8.1、Zotero 10.0.3、Better Notes 3.3.3。

## 结论

隔离环境通过全部测试：92 项自动化测试，118 项真实宿主/端到端检查，以及 4 项退出后持久化与正式安装包检查。43/43 个 MCP 工具均通过标准 MCP SDK → stdio 服务 → Zotero 本地 API/插件调用；不是只检查工具名称是否注册。

本轮写入仅针对临时 profile 的合成数据，没有修改真实用户文库。隔离宿主均已退出；使用者需另行安装插件并检查自己的 MCP 连接。

## 结果与证据

| 测试层 | 通过数 | 报告 |
| --- | ---: | --- |
| 本项目自动化测试 | 32 | `npm test` 的本次运行结果 |
| 复用上游单元测试 | 60 | `npm run test:upstream` 的本次运行结果 |
| 真实 Zotero 普通宿主 | 20 | [host](fullflow-host-result.json) |
| 标准 MCP stdio | 17 | [stdio](fullflow-stdio-result.json) |
| 扩展 MCP stdio | 36 | [extra](fullflow-extra-result.json) |
| Better Notes 真实宿主 | 20 | [BN host](fullflow-better-notes-host-result.json) |
| Better Notes MCP stdio | 25 | [BN stdio](fullflow-better-notes-stdio-result.json) |
| 退出后持久化与正式包 | 4 | [persistence/package](fullflow-persistence-package-result.json) |

[工具调用覆盖表](fullflow-tool-coverage.json)逐一列出 43 个工具。

## 验证的操作链

- 文库：授权测试客户端、发现文库/字段、检索和创建条目、更新元数据、读取子条目、标签、保存的搜索和引文导出。
- 分类：创建父子分类、改名、移动、添加/移除条目、删除和恢复。
- 附件：链接/导入实际 PDF，读回路径并比较文件 SHA-256；从 PDF 读取文字及 PNG 页面图片。索引全文分页精确重组、末尾返回空正文。
- 回收站：删除、列举、恢复；清空前数量不符时拒绝且保留数据，再按正确数量清空隔离库测试条目。
- 阅读上下文：实际 Reader 中程序触发文字选区事件、切换 Reader 后隔离选区、读取批注、区域图片通过 MCP image content 返回。
- 富文本笔记：读取、追加、光标插入、唯一文字替换、保留加粗/链接、行替换/插入/区间删除、全文删除后保持有效文档、继续编辑；越界和批量失败不部分提交。
- Markdown：模式往返切换、整篇源码替换、按行补丁、HTML/Markdown 转换、自动保存和读回；过期 revision 拒绝写入，重复 requestID 不重复修改。
- Better Notes：保存后大纲、HTML 行、入链/出链接口；启用外部 Markdown 同步、文件导入笔记、笔记导出文件、识别双方冲突并拒绝覆盖、关闭绑定保留文件。补测过期同步快照、丢失文件、已有目标文件和重试去重。
- 连接保护：错误 token 被拒绝，浏览器 Origin 请求被 Zotero 关闭连接，随后正常状态查询仍成功；连接文件权限为 0600。
- 持久化：退出宿主后以只读 SQLite 连接确认 Markdown 编辑与同步导入内容确实落盘。正式 XPI 与 addon 源码逐文件一致，未包含测试宿主或自动授权替身。

## 本轮改动

新增 `scripts/fullflow-extra-smoke.mjs`；为普通宿主添加保存的搜索夹具；为普通 stdio 记录实际调用工具；扩展 Better Notes stdio 的源码、结构、链接与同步检查。本轮未修改生产逻辑，未发现需要修复的功能故障。

测试过程中修正了两项测试脚本假设：子条目结果字段为 `children`；带 Origin 的请求可能被 Zotero 直接断开，而不是返回 HTTP 403。连接断开后另行验证服务仍正常，报告保留了该具体拒绝形式。

全流程验收时的安装包：`dist/zotero-codex-0.5.0.xpi`。SHA-256：`1e13fd3496e4d60138b7c67f9b18397400ee5d94af98162c2643b206d0804ad3`。开源发布时补充包内许可证并更新 manifest 的更新地址，Release 的最终包校验值见随包提供的 `SHA256SUMS`；功能代码未变。

## 复现

在项目根目录执行基础检查：

```sh
npm test
npm run test:upstream
npm run build
```

普通流程：`python3 scripts/prepare-host-smoke.py` 创建全新的隔离 profile 并返回 base/profile。以以下命令运行该 profile；等待 base 下 `result.json` 生成，确认没有 error 或失败项后执行 stdio 测试。变量须换成准备脚本返回的实际路径。

```sh
smoke_base='/absolute/path/to/zotero-codex-host-...'
/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile "$smoke_base/profile"
# 在另一个终端执行
node scripts/mcp-smoke.mjs "$smoke_base/connection.json" "$smoke_base"
node scripts/fullflow-extra-smoke.mjs "$smoke_base"
```

关闭这个隔离 Zotero 后，另建 Better Notes 测试 profile：

```sh
ZOTERO_SMOKE_SCRIPT=better-notes-host-smoke.js python3 scripts/prepare-host-smoke.py
# 将 smoke_base 更新为本次返回的 base，再运行 Zotero
/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile "$smoke_base/profile"
# 等 result.json 和 bn-fixtures.json 生成且宿主检查通过后，在另一个终端执行
node scripts/better-notes-stdio-smoke.mjs "$smoke_base"
```

准备脚本自动发现唯一的 Better Notes 安装并复制到测试 profile；也可通过 `ZOTERO_BETTER_NOTES_XPI=/absolute/path/to/better-notes.xpi` 明确指定。各结果保存在对应 base 下。Better Notes stdio 流程使用宿主刚创建的内容，应每次从新 profile 开始。普通测试宿主的授权弹窗由隔离夹具模拟同意；正式安装仍使用 Zotero 正常授权。

## 验证边界

- 未验收日常 Codex 中的插件安装、MCP 配置加载和原生授权弹窗操作。
- 选区为真实 Reader 中的程序事件夹具；区域图片为合成数据，未验证实际鼠标框选/拖拽动作。
- 链接接口本轮验证正常返回数组，未验证含复杂双向链接的文库索引正确性。
- 仅测试 macOS 本机、个人文库和小型合成笔记；Windows、群组权限、多设备冲突、大型文库、复杂表格/公式编辑未覆盖。
- 工具全部调用不意味着每个参数组合、并发时序及第三方插件组合都经过测试。
