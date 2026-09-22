# 0.4.1 工具合并与能力保留

目标：相同能力只有一个公开入口和一份数据实现，避免模型在两套参数、两种文库身份和两份结果之间选择。合并后 40 → 36 个工具：删除三个自建重复能力，两个状态入口合为一个；移除 `zotero_library_` 双命名空间。

| 能力 | 原自建实现 | 上游实现 | 最终选择 |
| --- | --- | --- | --- |
| 搜索 | 仅标题 contains；先搜索所有 ID 再切页 | 原生 quicksearch、全文、作者年份、标签、分类、排序、群组、服务端分页 | 上游 `zotero_search_items`，删除 XPI 对应 schema/handler |
| 单条元数据 | 本机 ID/key 定位，默认返回附件和笔记 | itemKey/groupId；可选完整 envelope、includeChildren | 上游 `zotero_get_item`；独立 get_item_children 用于子条目分页，沿用同一原生 API |
| 索引全文 | 直接读私有缓存路径，有字符偏移，30 MB 限制 | 官方本地全文路由；支持附件和父文献，返回实际附件 key、索引页数、总字符数、截断提示 | 上游原全文处理函数补上 offset/revision 分页，取消 XPI 完整缓存读取端点 |
| 连接状态 | 只检查插件、Better Notes | 只检查原生 API、写授权、文库 | 一个 `zotero_status` 并发检查两者；分别返回 nativeAPI/plugin、错误、ready，单边失败不遮蔽另一边 |
| PDF 页面 | PDF.js 按真实页提取文字和图片 | 只提供全文索引和本地附件路径 | 保留 read_pdf，其路径解析继续调用唯一的上游 get_attachment_path |
| 实时笔记 | 读取未保存 doc、revision、冲突检查、事务改文、请求去重 | 普通条目 API 读取持久快照和覆盖字段 | read_note/edit_note/write_note 是已有笔记正文的入口；create_items 创建笔记仍用上游，阻止 update_item 绕过编辑器覆盖正文 |
| 选区和批注图片 | Reader 快照、图片数据和实际来源 | 普通子条目元数据，缺少实时选区和图片缓存联动 | 保留实时专用接口；与原生元数据用途不同 |

## 为什么没有保留两套旧接口作为别名

别名会继续让模型看到重复工具；自动接受旧参数又可能静默忽略筛选条件。因此 0.4.0 明确采用上游参数契约，旧名称返回 Unknown tool。客户端重新加载 MCP 工具清单；旧会话中的历史工具调用不会被改写。

| 0.3.0 调用 | 0.4.0 调用 |
| --- | --- |
| zotero_library_search_items / zotero_search_items(query) | zotero_search_items(q)，其它筛选沿用上游 |
| zotero_library_get_item / zotero_get_item(item) | zotero_get_item(itemKey, groupId?, includeChildren?) |
| zotero_library_get_item_fulltext / zotero_get_fulltext(attachment,offset,limit) | zotero_get_item_fulltext(itemKey,groupId?,offset?,maxCharacters?,expectedRevision?) |
| zotero_library_status + zotero_status | zotero_status → {ready,nativeAPI,plugin} |
| 其它 zotero_library_X | zotero_X，参数沿用上游 |

文库工具使用 itemKey/groupId；编辑器使用本机 libraryID/key。用 resolve_item 转换，不能把 Zotero 用户或群组 ID 当成本机 libraryID。后续可以进一步统一身份契约，这次保留已验证的转换入口。

## 全文能力合并（0.4.1 修正）

保留上游原生 API、父文献附件查找、群组文库和索引元数据，在同一个处理函数里补上字符偏移分页。没有另建读取接口，也没有恢复 XPI 私有缓存全文端点。单文件修改已记录补丁，不再声称全部上游源码未修改。

- offset 默认 0，单位是 UTF-16 code unit。请直接使用 nextOffset，不要自己按字数计算。
- maxCharacters 限制单次返回量，默认 50,000，上限 500,000；超过 500,000 的正文仍可继续读到末尾。
- 返回 offset、returnedCharacters、nextOffset、hasMore、revision。nextOffset=null 表示读完。truncated 表示本次不是完整全文（包含从非零位置读取的末段），判断续读请用 hasMore/nextOffset。
- 续读使用返回的 attachmentKey、原 groupId，并提交 expectedRevision=revision。版本校验可选，推荐续读时都传；正文或附件身份变化时拒绝混读。
- 不在 emoji 等 Unicode 代理对中间切段。非法/越界偏移报错；恰好位于末尾返回空字符串和 null。
- 不传新增参数时，兼容旧调用的前缀行为。这是 MCP 输出分页，底层 Zotero API 每次仍返回全文，不宣称减少 HTTP 传输或内存占用。

首次调用 `{itemKey:"ABCD1234",maxCharacters:50000}`；续读 `{itemKey:<attachmentKey>,offset:<nextOffset>,maxCharacters:50000,expectedRevision:<revision>}`。

## 验证要求

工具目录唯一；原生工具在插件未连接时仍可独立使用；统一状态检查覆盖两边成功、任意一边失败及双边失败；搜索筛选/群组/分页参数确实传给原生 API；条目子项读取和全文截断使用原处理函数；旧入口不调用宿主或数据库；完整 PDF → 笔记创建/编辑链路用隔离 Zotero 回归。

上游原始提交/许可证继续保留，全文分页通过单文件补丁扩展，其它源码不变。原始及修改后哈希均有记录。重复 schema 和 handler 已删除。
