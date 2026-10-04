# 创作者工作台

一个个人内容创作与分发工作台，支持本地运行和受认证的服务器部署：保存画像和原稿，为 102 个渠道（国内 61、海外 41）生成规则稿或 AI 稿，逐平台编辑、校验、审阅，再通过已配置连接发布、写入草稿或交接到浏览器。

## 主界面与功能

![创作者工作台主界面：左侧为七个功能入口，上方为写原稿、适配与审阅、分发三个阶段，中间编辑原稿和素材，右侧选择写作画像、目标平台及规则整理或 AI 改写](./docs/images/creator-platform-workbench.jpg)

主界面采用「**写原稿 → 适配与审阅 → 分发**」的创作流程。左侧导航管理内容与账号，中间编辑主题、正文和素材，右侧选择写作画像、目标平台与适配方式。截图采集于 2026-10-03，展示本地运行的初始工作台，默认目标包括 X / Twitter、Reddit、小红书、知乎和微信公众号，可在平台目录中扩展。

| 功能入口 | 可以做什么 |
| --- | --- |
| **创作工作台** | 输入主题或完整原稿，添加图片、视频与 PDF 附件；使用规则整理或 AI 改写生成平台版本，逐平台编辑、预览、校验和确认，再复制、导出或安排分发。 |
| **内容库** | 保存和检索原稿，按创作状态筛选内容，查看各平台版本的审阅进度与账号分发状态，继续编辑。 |
| **发布任务** | 创建即时或预约任务，查看各账号的内容快照、执行时间与结果；处理草稿、浏览器交接和待核实的发布结果。 |
| **平台目录** | 浏览 102 个目标（国内 61、海外 41），按地区、内容类型与发布路径筛选，查看接入条件并选择创作平台。 |
| **发布账号** | 管理同一平台的多个账号，配置原生 API、Postiz、小红书服务、Wechatsync、MultiPost 或自定义 Webhook，主动检查连接参数与凭据。 |
| **写作画像** | 保存受众、语气、语言、创作者背景与禁用词，在创作时选择画像，让各平台版本保持一致的表达偏好。 |
| **工作区设置** | 配置兼容 Chat Completions 的模型服务、模型名称与 API Key，设置记录显示时区，查看本地数据与备份说明。 |

渠道目录表示内容适配能力。连接器代码存在、填写了连接参数、连接测试通过、远端发布成功是不同状态。初次运行没有示例账号、模型凭据或虚构发布记录；开发验证没有使用真实平台账号。具体覆盖与限制见 [平台覆盖说明](./docs/PLATFORM-COVERAGE.md)，源码参考记录见 [参考分析](./docs/REFERENCE-ANALYSIS.md)。

自动分发取决于平台接口、账号授权与连接方式：支持的 API 连接可以执行发布或保存草稿，浏览器扩展渠道需要前台操作与确认。AI 改写需要先配置模型服务；规则整理无需模型。预约任务在工作台服务运行时执行。

## 本地启动

服务器部署支持 `https://myaistock.top/creator-platform/`，操作与云端连接器边界见 [部署说明](./deploy/README.md)。默认本地访问保护保持开启，只有显式远程模式和认证代理配置齐全才允许容器部署。

需要 Node.js **22.13 或更新版本**和 npm。SQLite 使用 Node 内置模块；无需 Docker、数据库服务器、Redis 或参考应用的整套基础设施。

```bash
git clone https://github.com/EthanAlgoX/creator-platform.git
cd creator-platform
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:4317 。开发 API 为 http://127.0.0.1:4318 ，Vite 代理 `/api` 与 `/uploads`。

构建后用单个本地服务运行：

```bash
npm run build
npm start
```

打开 http://127.0.0.1:4318 。`start` 仍使用 tsx，因此保留完整 npm 安装。

可选环境变量见 `.env.example`。默认 Host 为 `127.0.0.1`，本地模式拒绝绑定非回环地址。服务器部署必须显式启用远程模式并配置认证代理；应用仍为单用户工作台。环境变量通过启动 shell 设置，例如：

```bash
export CREATOR_DATA_DIR=/absolute/path/to/private/creator-data
export PORT=4318
npm start
```

仅复制 `.env.example` 为 `.env` 不会自动加载；主要配置可以直接在工作台界面中保存。修改 API 端口时，也要调整开发 Vite 代理地址。

## 第一次创作

导航包含七个页面：**创作工作台、内容库、发布任务、平台目录、发布账号、写作画像、工作区设置**。创作工作台分为「写原稿 → 适配与审阅 → 分发」三个阶段，可以随时返回核对。

1. 在「写作画像」保存读者、语气、语言、背景与禁用词；在「平台目录」按地区、内容类型和发布方式选择目标，查看各平台的接入条件。
2. 在「写原稿」填写主题、正文、画像和素材。只有一句主题时，应补充事实、观点或自己的例子；视频素材需自行上传。PDF 作为附件保存，需要改写的文字请粘贴到正文。浏览器草稿备份与保存到工作区分别提示；清空已保存原稿也算修改，空正文不能保存或安排分发。
3. 选择「规则整理」或「AI 改写」。默认只生成所选平台中**尚无版本**的目标，已有人工文案和审阅状态保留。规则整理调整结构、长度与段落，长文可能裁剪，完成后需要检查信息完整性。要重写已有版本，使用「重新生成」并在列出的目标范围中确认替换；替换会清除这些版本的人工编辑和审阅状态，需保留时先复制或导出。生成期间原稿、画像或目标版本变化，服务端拒绝覆盖。
4. AI 使用「工作区设置」中的兼容 Chat Completions 服务：地址填 API base（通常包含 `/v1`），模型填服务支持的名称，API Key 单独保存。工作台追加 `/chat/completions`，将原稿和选定画像发送给该服务。超过六个目标时每六个平台依次生成，全部成功后才保存；失败会明确提示，原有版本保留。
5. 在「适配与审阅」逐平台编辑、预览并检查标题、正文、标签、X 串帖、字数和素材。保存编辑会取消原审阅状态。修改原稿或画像后，需要重新核对版本；可以重新生成，也可以在「核对原稿，保留当前文案」中确认文案仍准确，再重新校验、审阅。未连接账号时也可复制、导出 Markdown、文章 HTML 或 JSON；导出不计为发布。
6. 在「发布账号」配置自己的平台账号或外部服务，主动点击「检查」。参数完整、参数检查通过、凭据检查通过和检查失败分别显示，并保留最近检查时间和说明。修改账号参数会清除旧检查结果；仅改名称或启停状态会保留。参数检查不验证账号授权，凭据检查也不保证某条稿件拥有实际发布权限。
7. 在「分发」选择已确认版本的账号，立即创建任务或预约时间，单批最多 200 个账号目标。同一内容、平台、账号已有活跃任务时不能重复安排。每个目标独立记录结果；在「发布任务」查看正文、串帖、标签和素材快照。后续编辑不会改变已有任务，调整排期内容时应先处理原任务，再重新安排。MultiPost 到期后仍需在前台交接。

记录显示时区默认是 `Asia/Shanghai`，可在「工作区设置」修改；排期输入按浏览器的本机时区解释，再保存为实际时间。应用停止时预约任务不会执行，重新启动后会处理已到期队列。

## 连接方式

账号管理和授权能力由目标平台或外部服务提供。工作台不代创建开发者应用或取得平台权限。连接表单以服务端 `ConnectorDefinition` 返回字段为准；以下说明主要使用路径。

### Postiz

先独立部署或使用一个可访问的 Postiz 实例，在 Postiz 内完成平台授权。连接字段是 `baseUrl`、`apiKey`、`integrationId`，以及可选 `postType`、`settingsJson`。`baseUrl` 必须包含公共 API 前缀，例如 `https://api.postiz.com/public/v1`；`integrationId` 来自该实例的 `/integrations`，目标必须对应同个平台。`postType=now` 提交发布任务，`draft` 保存 Postiz 草稿。平台专属设置填写为 JSON 对象；例如 Reddit 版块、Pinterest board、Instagram post_type 不能仅靠通用文案推导。

Postiz 的队列接收回执不直接视为已发布，工作台保留远端任务 ID 并查询状态。

此工作台通过外部 API 集成，未复制 Postiz 应用或自动安装它。Postiz API、媒体公开 URL 与目标平台权限仍由你的实例提供；不能把创建本地连接当成授权成功。

### 小红书 MCP / REST 服务

独立准备 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) 服务，默认地址 `http://127.0.0.1:18060`。在该服务完成登录，工作台填写 base URL 和服务启用鉴权时使用的 Bearer token。测试读取 `/api/v1/login/status`，不发帖。

连接字段是 `baseUrl`、可选 `apiKey` 和 `format`；`apiKey` 对应服务进程的 `AUTH_TOKEN`。`format=image`（默认）调用图文 `/api/v1/publish`，需要 1–18 张图片。`format=video` 调用 `/api/v1/publish_video`，需要工作台上传的单个 MP4；REST 服务必须直接运行在同一主机、使用回环地址且能读取工作台本机路径，未接入容器路径映射或远程视频服务。两者实际提交发布，没有标准草稿模式；MultiPost 小红书路径仍为图文。服务返回“发布完成”没有稳定帖子链接时，任务等待核对，不生成假 URL。

### Wechatsync

先安装/配置 [Wechatsync](https://github.com/wechatsync/Wechatsync) 浏览器扩展及它的本地桥接服务，浏览器登录目标平台。工作台连接只填写 `baseUrl`：HTTP forwarding 地址，默认 `http://127.0.0.1:9528`；扩展的 WebSocket 默认为 9527。桥接进程的 `WECHATSYNC_TOKEN` 或 `MCP_TOKEN` 要与扩展设置匹配；HTTP 客户端字段不能替代该进程 token。

工作台使用 17 个公开草稿适配器，包括知乎、公众号、微博长文章、百家号、CSDN、掘金、豆瓣、雪球、搜狐号、人人都是产品经理、语雀、51CTO、慕课网、开源中国、思否、博客园、东方财富。可安全展示的草稿 URL 保留在任务中；包含会话 token 等凭据的链接不会写入明文任务，草稿仍按远端 ID 记录。最终公开发布在平台后台完成。X、小红书产品适配器不在当前公开源码中，未作为本工作台的可复用 Wechatsync 能力。

### MultiPost 浏览器扩展

安装 [MultiPost](https://github.com/leaperone/MultiPost-Extension) 并在同一浏览器登录目标平台。已接入 69 个公开注册键；目录会标注上游实验性适配，需逐渠道验证当前页面。连接表单无需服务器密钥。将工作台当前 hostname（本地为 `localhost` 或 `127.0.0.1`，线上为 `myaistock.top`）加入扩展信任域名；不同 hostname 是不同条目。工作台通过前台页面消息桥交接，不保存目标平台 Cookie。

在「发布任务」点击「交给扩展」打开 MultiPost 审阅窗口；本桥接 `isAutoPublish:false`，由你在浏览器继续确认。收到 `received` 回执只表示扩展接收，任务仍为待操作；完成后主动选择「已发布」「草稿」或「失败」记录核实结果。**超时、未知错误或不完整回执进入 `unconfirmed`（结果未知）**，应先检查扩展窗口和目标平台，不能直接再次交接。信任域明确拒绝、发送前校验失败才可记录为失败。公众号适配只同步草稿。整条 X 串文不通过该桥一次提交；改用支持串文的连接或逐条复制。

素材在数据库中保持 `/uploads` 地址，页面按部署子路径访问。目标平台页面/扩展是否可以读取回环素材 URL 需要真实浏览器环境验证；失败时可下载素材后在平台后台上传。线上上传文件受登录保护，带此类素材的 MultiPost 交接会在发送前停止并提示改用文件上传方式。扩展商店版本的 Agent 模块并未全部开源，本工作台仅对接公开消息协议。

### 原生 API 与自定义 Webhook

当前实现清单与资源/权限限制在 [平台覆盖说明](./docs/PLATFORM-COVERAGE.md)。原生连接使用你提供的 token、资源 ID 或应用密码，不包含通用 OAuth 登录/刷新中心。平台额度、账号角色和开发者权限仍由平台校验。

| 原生连接 | 配置字段 |
| --- | --- |
| X | `accessToken`，用户上下文 OAuth 2 token |
| Reddit | `accessToken`、`subreddit`、`userAgent`；可选 `flairId` |
| Mastodon | `baseUrl`、`accessToken`；可选 `visibility` |
| Bluesky | `identifier`、`appPassword`；可选 `baseUrl`，默认 bsky.social |
| Telegram | `botToken`、`chatId` |
| Discord | `webhookUrl`；可选 `guildId` 用于消息链接 |
| Slack | `webhookUrl` |
| DEV | `apiKey`；可选 `postType=draft\|publish`，默认 draft |
| WordPress | `baseUrl`、`username`、`applicationPassword`；可选 `postType=draft\|publish`，默认 draft |
| Ghost | `baseUrl`、`adminApiKey`（Admin Integration Key）；可选 `postType`，默认 draft |
| Hashnode | `accessToken`、`publicationId`；可选 `postType`，默认 draft；需 Pro Publication 和写入权限 |
| Misskey | `baseUrl`、`accessToken`；可选 `visibility`、`cw` |
| Lemmy | `baseUrl`、`accessToken`、`communityId`；可选 `apiVersion=v3\|v4`，默认 v3 |
| Blogger | `accessToken`、`blogId`；可选 `postType`，默认 draft |
| 飞书 / 钉钉 | `webhookUrl`、可选 `secret`；钉钉可选 `format=text\|markdown` |
| 企业微信 | `webhookUrl`、可选 `format=text\|markdown`；正文按 UTF-8 字节限长 |
| Microsoft Teams | `webhookUrl`；使用 Anyone 认证的 Workflows 触发器，配置发送 Adaptive Card 动作 |

共 18 个原生连接器。飞书、钉钉、企业微信和 Teams 的连接测试只验证 URL/参数格式，不发消息，不能证明授权成功。Teams 的 2xx 仅表示工作流受理，需人工核对投递。Postiz 映射有 32 个目标；四个仅内容适配目标（Quora、Qiita、Zenn、note）可导出，专用发布尚未实现。

自定义 Webhook 字段为 `url`、可选 `apiKey` 和只读检查地址 `healthUrl`。工作台 POST 的 JSON 含 `platformId`、`variant`（title/body/tags/thread/html）和 `media`（name/mime/url）。接收器返回 `{ "status": "published", "remoteId": "...", "url": "https://..." }` 或明确的 `drafted`，且包含远端 ID 或链接，才计为完成；HTTP 202 或仅 2xx 均保留结果未知。除非明确确认远端结果，任务不应手工记为已发布。

部分外部服务需要能访问素材 URL。默认 `PUBLIC_BASE_URL` 是 API 回环地址，只适用于同机访问。配置它不会自动建立隧道、公开服务器或启用远程模式。DEV 等依赖公开 URL 的渠道不能读取受认证保护的线上上传素材，应用会在请求前明确拒绝；直接文件上传的连接器（包括 Postiz 的上传接口）继续读取文件上传。具体云端限制见部署说明。

## 状态、恢复与重复提交

任务区分排队、已预约、执行中、已发布、远端草稿、结果未知、待用户操作、失败和取消。浏览器交接、远端服务接收和导出不会冒充已发布。

网络超时/程序中断可能发生在远端接受请求之后。工作台保留「结果未知」，**不会自动重试原发布请求**；Postiz 有任务 ID 时只读查询已有任务状态。显式重试创建一个新任务，使用原任务已审核快照。先核对平台记录，避免重复。原任务执行中退出后，重新启动将其恢复为结果未知。

修改正文会重新要求审阅；已经创建的任务保留入队时的内容与素材快照，可在「发布任务」查看。同一内容、平台、账号的排队、预约、执行中、待操作或结果未知任务会阻止重复安排，即使重新生成了版本也不能绕过。明确重试保留旧快照，并检查同目标是否存在其他活跃任务。预约改变的是队列执行时间，不代表平台已经接收。浏览器桥接不会在后台自动打开平台或发布。

## 本地数据与备份

默认数据目录为项目下 `data/`，可通过 `CREATOR_DATA_DIR` 改为私有目录：

- `creator.sqlite`：内容、画像、版本、连接元信息、任务和加密 vault。
- `vault.key`：32 字节本地加密密钥，权限 0600。
- `uploads/`：实际上传素材。
- SQLite 运行时可能存在 `creator.sqlite-wal` 和 `creator.sqlite-shm`。

连接配置/API Key 用 AES-256-GCM、随机 nonce 加密保存在本地数据库中；接口不回显密钥，只返回哪些字段已保存。修改连接时密钥留空保留原值。原稿、画像和发布记录仍是正常本地数据，不等于整库加密。

备份前正常停止应用，再复制**整个数据目录，必须包含 `vault.key` 和素材**。仅备份数据库无法在密钥丢失后恢复凭据；密钥与备份目录一起妥善保存。恢复时停止应用、还原同一完整目录、通过相同 `CREATOR_DATA_DIR` 启动。不要将 data 或凭据提交到 Git。

## 开发验证

```bash
npm run typecheck
npm test
npm run build
```

最近一次验收记录（2026-10-03）中，自动测试 **124 项全部通过**，类型检查、服务端编译和前端生产构建通过，详见 [服务器部署与验收记录](./docs/SERVER-DEPLOYMENT-20261003.md)。测试使用模拟 HTTP 服务、假浏览器消息与临时 SQLite，不读取真实凭据，不连接真实社交平台发布。覆盖来源审阅、生成覆盖保护与并发修改、原稿重新核对、连接检查持久化与脱敏、逐目标去重/排期快照、扩展未知结果、存储/加密和连接器载荷等。本地界面已完成桌面与移动尺寸的浏览器验收，记录见 [验证说明](./docs/VALIDATION.md)；线上浏览器 UI 验收尚未完成，真实账号授权、视频加工、平台审核和页面变化仍需配置后逐渠道验收。

源码：`server/` 为 API、领域、存储、生成、队列和连接器；`client/` 为创作界面和浏览器桥；`tests/` 为隔离验证；`docs/` 记录能力边界与参考取舍。
