# 参考源码分析与实现取舍

核验日期：2026-10-03（Asia/Shanghai）。九个公共仓库均以 `git clone --depth 1 --filter=blob:none` 下载，静态阅读源码；没有安装、运行参考应用、读取账号 Cookie 或执行真实发布。以下 HEAD 是本地实际提交，所有工作树均干净。私有 submodule 未初始化。

## 下载来源

| 项目 | 精确本地路径 | origin | HEAD | Star 快照 | 根目录许可证及边界 |
| --- | --- | --- | --- | --- | --- |
| Easel | `/Users/hyx/Documents/workspace/reference/Easel` | https://github.com/ZJU-REAL/Easel.git | `cfa17a638ad8a76e65083b89e9f43471e18aa447` | [2,912](https://api.github.com/repos/ZJU-REAL/Easel) | Apache-2.0；内置 gzh-design 子目录另为 AGPL-3.0 |
| Postiz | `/Users/hyx/Documents/workspace/reference/postiz-app` | https://github.com/gitroomhq/postiz-app.git | `6b102afb7eb535d677aec3302d7816e2a211fe89` | [36,627](https://api.github.com/repos/gitroomhq/postiz-app) | AGPL-3.0 |
| Mixpost Lite | `/Users/hyx/Documents/workspace/reference/mixpost` | https://github.com/inovector/mixpost.git | `df57648b866310446703f5294350552b62735df5` | [3,762](https://api.github.com/repos/inovector/mixpost) | MIT；公开 Lite 不包含官网所有付费能力 |
| LangChain Social Media Agent | `/Users/hyx/Documents/workspace/reference/social-media-agent` | https://github.com/langchain-ai/social-media-agent.git | `586e4363aec51ff3e71d4925d45e97f16198d7b7` | [2,819](https://api.github.com/repos/langchain-ai/social-media-agent) | MIT |
| MultiPost Extension | `/Users/hyx/Documents/workspace/reference/MultiPost-Extension` | https://github.com/leaperone/MultiPost-Extension.git | `6269ab4ada1cf661a3624b2b9f496bb032a391d5` | [3,552](https://api.github.com/repos/leaperone/MultiPost-Extension) | Apache-2.0；商店版本另含未公开 Agent 模块 |
| 小红书 MCP | `/Users/hyx/Documents/workspace/reference/xiaohongshu-mcp` | https://github.com/xpzouying/xiaohongshu-mcp.git | `a5c8f7799980ba1fdd501999843eb2d17e4c9a9f` | [16,086](https://api.github.com/repos/xpzouying/xiaohongshu-mcp) | Apache-2.0 |
| Wechatsync | `/Users/hyx/Documents/workspace/reference/Wechatsync` | https://github.com/wechatsync/Wechatsync.git | `a98e42865387285afcc027c61836488748f3b30f` | [6,380](https://api.github.com/repos/wechatsync/Wechatsync) | GPL-3.0；X、小红书等适配器不在公开源码中 |
| social-auto-upload | `/Users/hyx/Documents/workspace/reference/social-auto-upload` | https://github.com/dreammis/social-auto-upload.git | `0012d2c355f88f683cc38dde2a2db209e14091bc` | [15,270](https://api.github.com/repos/dreammis/social-auto-upload) | MIT；依赖运行时仍有各自许可证 |
| doocs/md | `/Users/hyx/Documents/workspace/reference/doocs-md` | https://github.com/doocs/md.git | `a7c17fc4cda92e3c13aa7e24f06615cfa4219b31` | [13,385](https://api.github.com/repos/doocs/md) | WTFPL；第三方依赖另行授权 |

Star 快照为 GitHub 官方 REST API 的 `stargazers_count`，本次实际抓取时间为 2026-10-03 03:08:56 至 03:08:58（Asia/Shanghai；UTC 2026-10-02 19:08:56 至 19:08:58）。点击数字可查看对应官方 API；每项精确抓取时间和 API URL 保存在下载记录的 `starSnapshot` 中。数字仅反映抓取当时，会随时增减，不代表固定排名或功能成熟度。

本工作台采用独立的数据结构、界面和连接器实现。参考项目保留在独立目录，用于阅读协议与架构；没有批量复制 AGPL/GPL 应用、Easel 的 AGPL 排版子包或 MultiPost 未公开模块。实际运行的 npm 依赖以 `package.json` 和 lockfile 为准。

可机读下载记录另存于 [creator-platform-references.json](../../reference/creator-platform-references.json)，包含 origin、HEAD、commit URL、branch、提交时间、工作树状态、许可证边界和静态核验范围。它是新文件，未覆盖参考目录中的既有说明或索引。

## 1. Easel：画像与跨平台创作流程

主要阅读：`easel/persona.py`、`profiles/_template/`、`skills/openclaw/skill-content-repurposing/`、`skills/openclaw/skill-quality-gate/`、`skills/shared/scripts/manifest.py`、`web/app.py`、`docs/ACKNOWLEDGMENTS.md`。

有价值的模式是每次创作绑定明确画像：定位、读者、表达风格、禁区和经验；共同原稿与各平台成品分别保存；生成、质量检查、审阅和发布是独立步骤。产物 manifest 只保存索引、步骤与文件引用，不把所有内容复制到状态文件。

本工作台对应实现：`Profile`、`Content`、`Variant`、`sourceRevision`，位于 `server/types.ts`、`server/domain.ts`、`server/generation.ts`；来源文本与平台稿分别保存，修改正文或原稿后需重新审阅。创作画像不与账号凭据混存。

限制：Easel 的创作执行大量依赖 Agent 读取 Skills 和执行外部脚本，不能直接当成简单应用内生成 API。其某些平台规范是经验文件，字数方法也不等同于 X 官方计数。公众号路径主要是草稿。根 Apache-2.0 不能覆盖 `skills/openclaw/gzh-design/` 的 AGPL-3.0 许可。

## 2. Postiz：平台 Provider、账号和逐渠道发布任务

主要阅读：`libraries/nestjs-libraries/src/database/prisma/schema.prisma`、`integrations/social/social.integrations.interface.ts`、`integration.manager.ts`、`social.abstract.ts`、`apps/orchestrator/src/workflows/post-workflows/`、`agent/agent.graph.service.ts`。

可用模式：Provider 注册表描述认证、媒体、长度、平台设置；一份内容对应多个账号/平台发布记录；帖子线程、平台返回 ID/URL 和错误独立保存。实际发布 mutation 与状态查询、日志写入采用不同重试语义：网络超时后可能已被平台接受，不能当成安全失败自动再发。

本工作台对应实现：`server/catalog.ts` 的内容规格、`ConnectorDefinition` 和连接器接口、每个目标独立 `Job` 与批次 ID、结果未知/待人工状态；连接器通过外部 Postiz API 调用已授权的实例，不移植它的 NestJS/Temporal/Prisma 基础设施。

限制：本次读取的 Postiz registry 包含 X、Reddit 等海外渠道，没有小红书、知乎、公众号；“可生成中文”不等于可发布国内平台。它的完整运行栈较重，示例生成提示偏英语。AGPL 应用保持独立；外部服务是否已部署、账号是否授权另行确认。

## 3. Mixpost Lite：原稿与账号版本、排程批次

主要阅读：`src/Contracts/SocialProvider.php`、`src/Models/Post.php`、`PostVersion.php`、`Support/SocialProviderPostConfigs.php`、`PostContentParser.php`、`Actions/PublishPost.php`、`Jobs/AccountPublishPostJob.php`、`resources/js/Composables/usePostVersions.js`。

可用模式：原稿与账号覆写稿独立；媒体/文字约束序列化为前后端共同能力配置；批量任务按账号拆开，保留每个账号的错误和远端 ID。凭据由服务器加密保存，并从序列化输出隐藏。

本工作台对应实现：平台版本编辑、校验、审批、发布批次，SQLite 中的公开连接记录和独立加密 vault。首版保留任务列表与预约时间，不复制完整日历或 Laravel 宿主体系。

限制：实际公开 Lite Provider 是 Twitter、Facebook Page、Mastodon；没有 Reddit/国内渠道，也没有可识别的完整 LLM 生成服务。官网 Pro/Enterprise 的 AI、团队、多租户能力不能视为当前 MIT 仓库已包含。此项目用于参考，不作为当前发布依赖。

## 4. LangChain Social Media Agent：证据输入与人工审核

主要阅读：`langgraph.json`、`src/agents/generate-post/generate-post-graph.ts`、`shared/nodes/generate-post/human-node.ts`、`schedule-post.ts`、`reflection/`、`clients/twitter/client.ts`、`clients/linkedin.ts`、`clients/reddit/client.ts`。

可用模式：来源链接/报告与文案一起审阅；生成图、缩短内容、反馈规则、接受/编辑/拒绝分为可观察阶段；素材去重与用户明确反馈可以成为独立记忆。

本工作台对应实现：保留输入原稿、创作者画像和生成来源；AI 输出采用结构化 JSON，平台缺失/重复/格式错误显式失败；人工审核后才允许生成发布任务。首版不启动长期 Agent 反思循环，也不伪造检索证据。

限制：实际发布目标是 X、LinkedIn；Reddit client 是读取素材，不是 Reddit 发布器。固定品牌上下文、模型和排程时间属于示例设定；本地工作台使用用户配置的兼容模型接口与时区。

## 5. MultiPost：前台浏览器会话桥接

主要阅读：`src/types/external.ts`、`src/contents/extension.ts`、`src/background/index.ts`、`background/services/trust-domain.ts`、`src/sync/common.ts`、`sync/article.ts`、`dynamic.ts`、`video.ts` 和各平台文件。

协议：页面发送 `{type:'request',traceId,action,data}`，扩展响应 `{type:'response',traceId,action,code,message,data}`。服务 worker 从 content-script sender 推导来源；已信任域名才能执行。内容载荷按 article/dynamic/video 区分，平台必须用注册键如 `DYNAMIC_X`、`ARTICLE_ZHIHU`、`ARTICLE_WEIXIN`，不能发送“知乎”等显示名称。

本工作台对应实现：`client/bridge.ts` 检查来源窗口、origin、action 和 traceId，设置超时并清理监听器；映射审核后标题、正文、封面、图片/视频；使用 `MULTIPOST_EXTENSION_PUBLISH` 打开扩展审阅窗口，始终 `isAutoPublish:false`。`received` 只记为已交接，任务仍待用户确认。

限制：X、Reddit、小红书、知乎公开源码有条件式点击发布；公众号只创建文章并跳转编辑页，视为草稿。扩展收到任务或打开标签页不能证明最终发布；某些注入函数只记录错误，没有可靠远端回执。多条 X 串文不能通过本桥接一次完成。素材 URL 需在目标浏览器可访问。商店里的 Agent 不是全部开源。

## 6. 小红书 MCP：专用本地发布服务

主要阅读：`routes.go`、`service.go`、`handlers_api.go`、`middleware.go`、`login_session.go`、`browser/browser.go`、`cookies/cookies.go`、`xiaohongshu/publish.go` 和 `publish_video.go`。

实际 REST：`GET /api/v1/login/status`，`POST /api/v1/publish` 图文，`POST /api/v1/publish_video` 视频；另有 `/mcp`。图文输入 title/content/images/tags，定时为 RFC3339。它登录后保留自己的 Cookie，操作创作者页面并等待发布成功信号。

本工作台对应实现：`server/connectors.ts` 通过可配置本地服务 endpoint 调用图文 `/publish`，或以 `format=video` 调用 `/publish_video`；视频仅限同机回环 REST 服务与工作台上传的单个 MP4。连接测试读取登录状态，真实提交仅发生于已审阅内容的发布任务。工作台不读取小红书 Cookie 文件，也不向远程视频服务传送本机路径。

限制：原仓库无标准 save-draft API；不能把 `/publish` 当成保存草稿。响应有“发布完成”状态，但无稳定 post ID/URL，不虚构链接。视频绝对路径指服务主机/容器，和浏览器上传路径不是一回事。服务实例的 Cookie 上下文与账号绑定，多账号需隔离实例/路径。

## 7. Wechatsync：内容预处理与远端草稿

主要阅读：`packages/core/src/adapters/types.ts`、`runtime/interface.ts`、`adapters/platforms/zhihu.ts` 与 `weixin.ts`、`packages/extension/src/background/sync-service.ts`、`src/mcp/client.ts`、`packages/mcp-server/src/ws-bridge.ts`、`.gitignore`、`.gitmodules`。

可用模式：adapter 声明输出 HTML/Markdown、清理不支持标签/链接、懒加载图片与媒体上传；Runtime 把浏览器权限与平台逻辑分开。结果明确包含 draftOnly、postId、postUrl 和逐平台错误。

本工作台对应实现：独立的连接器调用 HTTP forwarding API，目录接入 17 个公开草稿键。默认 WS 9527、HTTP 9528；`GET /status` 检查扩展连接，`POST /request` 支持 checkAuth/syncArticle；结果映射为草稿，不把名为 publish 的方法当成最终发布。微博映射为长文章草稿；哔哩哔哩当前是视频目标，因此没有把其文章草稿接口混作视频上传。

限制：产品 README 的 29+ 能力大于公开源码范围；X、小红书文件被明确标记 non-open-source，private submodule 没有下载。公开知乎、公众号、CSDN、掘金、百家号、微博相关实现主要保存草稿。WordPress CMS 是扩展内生成的 `cms_<timestamp>` 账号 ID，不能猜成固定 `wordpress`。

## 8. social-auto-upload：上传契约与账号隔离

主要阅读：`sau_cli.py`、`uploader/base_video.py`、`uploader/xiaohongshu_uploader/main.py`、抖音/快手/视频号/Bilibili uploader 和 CLI 文档。

可用模式：login/check/upload-video/upload-note 分开；账号 alias 对应独立 Cookie 文件；媒体路径/格式和预约时间先校验；视频素材与视频说明分别传递。上传成功需要平台证据，而不是仅靠脚本启动或退出。

本工作台对应实现：内容模型包含上传素材、视频稿与媒体要求；首版实际集成使用 MultiPost/小红书服务/API。**没有实现 SAU subprocess connector**，保留为后续本地视频驱动参考。

限制：当前矩阵小红书、抖音、快手支持图文/视频，Bilibili、视频号等主要视频；视频号不是公众号。没有 X/Reddit/知乎的完整主线能力。upload 默认即发布，不能用于只读连接测试；Bilibili 还依赖 biliup 运行时。

## 9. doocs/md：原稿与安全 HTML 输出

主要阅读：`packages/core/src/renderer/renderer-impl.ts`、`utils/markdownHelpers.ts`、`packages/mcp-server/src/render-article.ts`、`apps/web/src/services/export/clipboard.ts`、`clipboard-dom.ts`、`wechat-svg.ts`、`stores/post.ts`。

可用模式：Markdown 是编辑原稿，HTML 是当前版本派生稿；主题、排版和写作内容分开；粘贴公众号时内联样式并清理 HTML；本地保存按文档跟踪脏状态，避免共享 debounce 漏写文档。

本工作台对应实现：`server/domain.ts` 使用独立 Markdown parser + HTML sanitizer 和简洁内联样式，预览/导出基于当前版本；SQLite 保存内容。没有搬入它的完整编辑器、云同步、主题市场或 UI。

限制：编辑、MCP 渲染、图片上传不等于完整公众号发布引擎。此版本有依赖外部扩展的发布界面；OpenAPI Worker 示例主要代理接口，不能由此宣称自动发布闭环已完成。

## 本工作台的实际边界

本地 Node/React/SQLite 支持画像、原稿、102 渠道的规则/AI 稿件、编辑/校验/审批、素材、导出、账号连接配置、逐目标队列和预约；新增平台目录与筛选，AI 每六个目标分批生成。内容适配目录与连接器实际发布能力独立，见 [平台覆盖说明](./PLATFORM-COVERAGE.md)。

模型、账号与扩展均未代用户配置。开发测试只使用临时本地数据和模拟 HTTP/浏览器响应；九个参考仓库的静态分析、连接器模拟测试与真实账号发布验证是三件不同的事。
