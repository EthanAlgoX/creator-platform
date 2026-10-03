# 平台覆盖与发布边界

核验日期：2026-10-03（Asia/Shanghai）。本说明以当前 [平台目录](../server/catalog.ts)、[连接器实现](../server/connectors.ts)、[企业消息实现](../server/enterprise.ts) 和 [浏览器桥](../client/bridge.ts) 为准；逐平台表通过导入目录与 `getConnectorDefinitions()` 生成。开发验证没有使用真实账号凭据、发送群消息或调用平台发布接口。目录收录、参数已保存、连接检查通过和真实发布完成分别判断。

当前目录有 **102 个内容适配目标：国内 61 个、海外 41 个**。实际路径为 **18 个原生连接器**（14 个社交 / 博客 / Incoming Webhook + 4 个企业消息）、**32 个 Postiz 目标映射**、**69 个 MultiPost 公共注册键**、**17 个 Wechatsync 草稿映射**，以及 **1 个小红书 MCP REST 专用服务（图文 / 同机视频）**。仅导出目标 4 个。集合互有重叠，不能相加成独立平台数，也不表示 102 个目标都支持无需人工的自动公开发布。

所有目标均支持共同原稿、画像、规则适配、兼容模型生成、独立平台稿、编辑/审阅及导出。规则适配整理既有内容，长文可能按默认限制裁剪；AI 生成按每批最多 6 个平台调用，平台越多等待越久，批次失败不会替换旧稿。视频目标生成文案和脚本，视频文件须自行上传。Markdown/JSON 可导出各平台版本，HTML 用于文章排版；导出不执行发布。目录长度是工作台默认值，最终约束取决于连接器、实例与账号；X 按加权字符拆帖，实例制平台可能有不同上限。

## 完整逐平台映射

表中“原生”是本工作台实现的官方 API 或原生群机器人/Incoming Webhook；“专用”是独立服务；Postiz 对接已授权外部实例；MultiPost 是前台浏览器交接；Wechatsync 是远端**草稿**路径。`—` 表示当前未提供该路径。所有 102 个目标另可使用自供发布服务的通用 Webhook，这不算现成平台连接器，也不改变“仅导出”目标的默认能力。表中提到的实验性路径只能作为逐渠道人工核验的入口。

| 目标 / ID | 地区 | 适配格式 | 原生 / 专用服务 | Postiz provider | MultiPost 注册键 | Wechatsync 草稿键 | 发布边界 / 特别条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| X / Twitter / `x` | 海外 | 动态 | X 官方 API | `x` | `DYNAMIC_X` | — | 原生首条最多4图；浏览器不交接整条串帖；前台交接 |
| Reddit / `reddit` | 海外 | 动态 | Reddit 官方 API | `reddit` | `DYNAMIC_REDDIT` | — | 原生仅self文字帖；需subreddit；前台交接 |
| 小红书 / `xiaohongshu` | 国内 | 动态 / 视频 | 小红书 MCP REST（图文/同机视频） | — | `DYNAMIC_REDNOTE` | — | REST图文1–18图或同机单MP4；无ID仍待确认；浏览器仅图文；前台交接 |
| 知乎 / `zhihu` | 国内 | 文章 | — | — | `ARTICLE_ZHIHU` | `zhihu` | 前台交接；Wechatsync仅草稿 |
| 微信公众号 / `wechat` | 国内 | 文章 | — | — | `ARTICLE_WEIXIN` | `weixin` | 公众号草稿与正式发布分别核对；前台交接；Wechatsync仅草稿 |
| LinkedIn / `linkedin` | 海外 | 动态 | — | `linkedin` | `DYNAMIC_LINKEDIN` | — | 前台交接 |
| Threads / `threads` | 海外 | 动态 | — | `threads` | `DYNAMIC_THREADS` | — | 前台交接 |
| Bluesky / `bluesky` | 海外 | 动态 | Bluesky AT Protocol | `bluesky` | `DYNAMIC_BLUESKY` | — | 前台交接 |
| Mastodon / `mastodon` | 海外 | 动态 | Mastodon 官方 API | `mastodon` | — | — | 原生需实例 Token；Postiz 路径需已授权实例与目标设置 |
| Facebook / `facebook` | 海外 | 动态 | — | `facebook` | `DYNAMIC_FACEBOOK` | — | 前台交接 |
| Instagram / `instagram` | 海外 | 动态 | — | `instagram` | `DYNAMIC_INSTAGRAM` | — | 前台交接 |
| TikTok / `tiktok` | 海外 | 视频 | — | `tiktok` | `VIDEO_TIKTOK` | — | 前台交接 |
| YouTube / `youtube` | 海外 | 视频 | — | `youtube` | `VIDEO_YOUTUBE` | — | 前台交接 |
| Pinterest / `pinterest` | 海外 | 动态 | — | `pinterest` | `DYNAMIC_PINTEREST` | — | 前台交接 |
| 哔哩哔哩 / `bilibili` | 国内 | 视频 | — | — | `VIDEO_BILIBILI` | — | 前台交接 |
| 抖音 / `douyin` | 国内 | 视频 | — | — | `VIDEO_DOUYIN` | — | 前台交接 |
| 快手 / `kuaishou` | 国内 | 视频 | — | — | `VIDEO_KUAISHOU` | — | 前台交接 |
| 微信视频号 / `wechat_channels` | 国内 | 视频 | — | — | `VIDEO_WEIXINCHANNEL` | — | 前台交接 |
| 微博 / `weibo` | 国内 | 动态 | — | — | `DYNAMIC_WEIBO` | `weibo`（长文章） | Wechatsync为长文章草稿；前台交接；Wechatsync仅草稿；MultiPost 对应微博动态；Wechatsync 对应微博长文章草稿，最终发布需在后台确认。 |
| 今日头条 / `toutiao` | 国内 | 文章 | — | — | `ARTICLE_TOUTIAO` | — | 前台交接 |
| 百家号 / `baijiahao` | 国内 | 文章 | — | — | `ARTICLE_BAIJIAHAO` | `baijiahao` | 前台交接；Wechatsync仅草稿 |
| CSDN / `csdn` | 国内 | 文章 | — | — | `ARTICLE_CSDN` | `csdn` | 前台交接；Wechatsync仅草稿 |
| 掘金 / `juejin` | 国内 | 文章 | — | — | `ARTICLE_JUEJIN` | `juejin` | 前台交接；Wechatsync仅草稿 |
| DEV Community / `devto` | 海外 | 文章 | DEV / Forem API（默认草稿） | `devto` | — | — | 需已授权Postiz实例及目标设置 |
| Hashnode / `hashnode` | 海外 | 文章 | Hashnode GraphQL API（默认草稿） | `hashnode` | — | — | 原生需Pro Publication + 写角色；默认草稿 |
| WordPress / `wordpress` | 海外 | 文章 | WordPress REST API（默认草稿） | `wordpress` | `ARTICLE_WORDPRESS` | — | 前台交接 |
| Medium / `medium` | 海外 | 文章 | — | `medium` | `ARTICLE_MEDIUM` | — | 前台交接 |
| Telegram / `telegram` | 海外 | 动态 | Telegram Bot API | `telegram` | — | — | 需已授权Postiz实例及目标设置 |
| Discord / `discord` | 海外 | 动态 | Discord Incoming Webhook | `discord` | — | — | 需已授权Postiz实例及目标设置 |
| Slack / `slack` | 海外 | 动态 | Slack Incoming Webhook | `slack` | — | — | 原生仅文字；HTTP 200+ok，无消息ID |
| Lemmy / `lemmy` | 海外 | 动态 | Lemmy 官方 API | `lemmy` | — | — | 原生需实例/JWT/社区ID；联邦等待仍待确认 |
| Nostr / `nostr` | 海外 | 动态 | — | `nostr` | — | — | 需已授权Postiz实例及目标设置 |
| VK / `vk` | 海外 | 动态 | — | `vk` | — | — | 需已授权Postiz实例及目标设置 |
| Tumblr / `tumblr` | 海外 | 文章 | — | `tumblr` | — | — | 需已授权Postiz实例及目标设置 |
| 简书 / `jianshu` | 国内 | 文章 | — | — | `ARTICLE_JIANSHU` | — | 前台交接 |
| 博客园 / `cnblogs` | 国内 | 文章 | — | — | `ARTICLE_CNBLOGS` | `cnblogs` | 前台交接；Wechatsync仅草稿 |
| SegmentFault 思否 / `segmentfault` | 国内 | 文章 | — | — | `ARTICLE_SEGMENTFAULT` | `segmentfault` | 前台交接；Wechatsync仅草稿 |
| 开源中国 / `oschina` | 国内 | 文章 | — | — | `ARTICLE_OSCHINA` | `oschina` | 前台交接；Wechatsync仅草稿 |
| 少数派 / `sspai` | 国内 | 文章 | — | — | `ARTICLE_SSPAI` | — | 前台交接 |
| InfoQ / `infoq` | 国内 | 文章 | — | — | `ARTICLE_INFOQ` | — | 前台交接 |
| 阿里云开发者社区 / `aliyun` | 国内 | 文章 | — | — | `ARTICLE_ALIYUN` | — | 实验性浏览器路径；前台交接 |
| 腾讯云开发者社区 / `tencent_cloud` | 国内 | 文章 | — | — | `ARTICLE_TENCENTYUN` | — | 实验性浏览器路径；前台交接 |
| 火山引擎开发者社区 / `volcengine` | 国内 | 文章 | — | — | `ARTICLE_VOLCENGINE` | — | 实验性浏览器路径；前台交接 |
| 语雀 / `yuque` | 国内 | 文章 | — | — | — | `yuque` | Wechatsync仅草稿 |
| 51CTO / `cto51` | 国内 | 文章 | — | — | `ARTICLE_51CTO` | `51cto` | 前台交接；Wechatsync仅草稿 |
| 慕课手记 / `imooc` | 国内 | 文章 | — | — | — | `imooc` | Wechatsync仅草稿 |
| 人人都是产品经理 / `woshipm` | 国内 | 文章 | — | — | `ARTICLE_WOSHIPM` | `woshipm` | 前台交接；Wechatsync仅草稿 |
| 豆瓣日记 / `douban` | 国内 | 文章 | — | — | `ARTICLE_DOUBAN` | `douban` | 前台交接；Wechatsync仅草稿 |
| 雪球 / `xueqiu` | 国内 | 文章 | — | — | `ARTICLE_XUEQIU` | `xueqiu` | 前台交接；Wechatsync仅草稿 |
| 东方财富 / `eastmoney` | 国内 | 文章 | — | — | `ARTICLE_EASTMONEY` | `eastmoney` | 前台交接；Wechatsync仅草稿 |
| 搜狐号 / `sohu` | 国内 | 文章 | — | — | `ARTICLE_SOHU` | `sohu` | 实验性浏览器路径；前台交接；Wechatsync仅草稿 |
| 网易号 / `netease` | 国内 | 文章 | — | — | `ARTICLE_NETEASE` | — | 实验性浏览器路径；前台交接 |
| 企鹅号 / `qie` | 国内 | 文章 | — | — | `ARTICLE_QQ` | — | 实验性浏览器路径；前台交接 |
| 大鱼号 / `dayuhao` | 国内 | 文章 | — | — | `ARTICLE_DAYUHAO` | — | 实验性浏览器路径；前台交接 |
| 一点资讯 / `yidian` | 国内 | 文章 | — | — | `ARTICLE_YIDIANZIXUN` | — | 实验性浏览器路径；前台交接 |
| 顶端号 / `dingduanhao` | 国内 | 文章 | — | — | `ARTICLE_DINGDUANHAO` | — | 实验性浏览器路径；前台交接 |
| 快传号 / `kuaichuanhao` | 国内 | 文章 | — | — | `ARTICLE_KUAICHUANHAO` | — | 实验性浏览器路径；前台交接 |
| 简篇 / `jianpian` | 国内 | 文章 | — | — | `ARTICLE_JIANPIAN` | — | 实验性浏览器路径；前台交接 |
| 什么值得买 / `smzdm` | 国内 | 文章 | — | — | `ARTICLE_SMZDM` | — | 前台交接 |
| 汽车之家 / `autohome` | 国内 | 文章 | — | — | `ARTICLE_AUTOHOME` | — | 前台交接 |
| 懂车帝 / `dongchedi` | 国内 | 文章 | — | — | `ARTICLE_DONGCHEDI` | — | 实验性浏览器路径；前台交接 |
| 同花顺 / `tonghuashun` | 国内 | 文章 | — | — | `ARTICLE_TONGHUASHUN` | — | 实验性浏览器路径；前台交接 |
| 知识星球 / `zsxq` | 国内 | 文章 | — | — | `ARTICLE_ZSXQ` | — | 实验性浏览器路径；前台交接 |
| 即刻 / `jike` | 国内 | 动态 | — | — | `DYNAMIC_OKJIKE` | — | 前台交接 |
| V2EX / `v2ex` | 国内 | 动态 | — | — | `DYNAMIC_V2EX` | — | 前台交接 |
| 得到 / `dedao` | 国内 | 动态 | — | — | `DYNAMIC_DEDAO` | — | 前台交接 |
| 小黑盒 / `xiaoheihe` | 国内 | 动态 | — | — | `DYNAMIC_XIAOHEIHE` | — | 前台交接 |
| 脉脉 / `maimai` | 国内 | 动态 | — | — | `DYNAMIC_MAIMAI` | — | 前台交接 |
| 格隆汇 / `gelonghui` | 国内 | 文章 | — | — | `ARTICLE_GELONGHUI` | — | 实验性浏览器路径；前台交接 |
| 健康界 / `jiankangjie` | 国内 | 文章 | — | — | `ARTICLE_JIANKANGJIE` | — | 实验性浏览器路径；前台交接 |
| 凯迪网 / `kaidiwang` | 国内 | 文章 | — | — | `ARTICLE_KAIDIWANG` | — | 实验性浏览器路径；前台交接 |
| 支付宝生活号 / `alipay` | 国内 | 视频 | — | — | `VIDEO_ALIPAY` | — | 前台交接 |
| 爱奇艺号 / `iqiyi` | 国内 | 视频 | — | — | `VIDEO_IQIYI` | — | 前台交接 |
| 优酷号 / `youku` | 国内 | 视频 | — | — | `VIDEO_YOUKU` | — | 前台交接 |
| 腾讯视频 / `tencent_video` | 国内 | 视频 | — | — | `VIDEO_TENCENTVIDEO` | — | 前台交接 |
| 拼多多视频 / `pinduoduo` | 国内 | 视频 | — | — | `VIDEO_PINDUODUO` | — | 前台交接 |
| vivo 短视频 / `vivo_video` | 国内 | 视频 | — | — | `VIDEO_VIVOVIDEO` | — | 前台交接 |
| 得物 / `dewu` | 国内 | 视频 | — | — | `VIDEO_DEWU` | — | 前台交接 |
| 易车 / `yiche` | 国内 | 视频 | — | — | `VIDEO_YICHE` | — | 前台交接 |
| 搜狐视频 / `sohu_video` | 国内 | 视频 | — | — | `VIDEO_SOHUTV` | — | 前台交接 |
| Google Business Profile / `google_business` | 海外 | 动态 | — | `gmb` | — | — | 需要 Postiz 中已授权的商家及地点，活动或按钮等字段需配置 settingsJson。 |
| Dribbble / `dribbble` | 海外 | 动态 | — | `dribbble` | — | — | 需已授权Postiz实例及目标设置 |
| Kick / `kick` | 海外 | 动态 | — | `kick` | — | — | 当前 Postiz 路径发布直播聊天消息，不上传直播或视频。 |
| Twitch / `twitch` | 海外 | 动态 | — | `twitch` | — | — | 当前 Postiz 路径为聊天/频道公告，不创建直播视频。 |
| Farcaster / `farcaster` | 海外 | 动态 | — | `wrapcast` | — | — | 需已授权Postiz实例及目标设置 |
| listmonk / `listmonk` | 海外 | 文章 | — | `listmonk` | — | — | 用于自建通讯/邮件系统；收件列表、发布模式与实际发送由实例设置决定。 |
| Moltbook / `moltbook` | 海外 | 动态 | — | `moltbook` | — | — | 面向 AI 代理社区，需要目标平台允许的代理账号与版块。 |
| Whop / `whop` | 海外 | 文章 | — | `whop` | — | — | 需已授权Postiz实例及目标设置 |
| Skool / `skool` | 海外 | 动态 | — | `skool` | — | — | 需已授权Postiz实例及目标设置 |
| MeWe / `mewe` | 海外 | 动态 | — | `mewe` | — | — | 需已授权Postiz实例及目标设置 |
| Ghost / `ghost` | 海外 | 文章 | Ghost Admin API（默认草稿） | — | — | — | 默认草稿；不发送Newsletter |
| Misskey / `misskey` | 海外 | 动态 | Misskey HTTP API | — | — | — | 实例权限及大小限制；最多16附件 |
| Blogger / `blogger` | 海外 | 文章 | Blogger API v3（默认草稿） | — | — | — | 默认草稿；需blogger OAuth权限 |
| 飞书群机器人 / `feishu` | 国内 | 动态 | 飞书群机器人 | — | — | — | 文本；20KiB JSON；code=0，无消息ID |
| 钉钉群机器人 / `dingtalk` | 国内 | 动态 | 钉钉群机器人 | — | — | — | 文本/Markdown；20KiB应用上限；errcode=0，无消息ID |
| 企业微信群机器人 / `wecom` | 国内 | 动态 | 企业微信群机器人 | — | — | — | 文本2048/Markdown4096 UTF-8字节；errcode=0 |
| Microsoft Teams / `teams` | 海外 | 动态 | Microsoft Teams Workflows | — | — | — | Workflows Anyone；2xx仅受理，待人工确认 |
| Substack / `substack` | 海外 | 文章 | — | — | `ARTICLE_SUBSTACK` | — | 前台交接；公开参考扩展提供文章编辑页交接；通讯发送与最终发布仍在平台确认。 |
| Quora / `quora` | 海外 | 文章 | — | — | — | — | 当前提供内容适配、复制和导出；未实现专用发布连接。 |
| Qiita / `qiita` | 海外 | 文章 | — | — | — | — | 当前提供内容适配、复制和导出；未实现专用发布连接。 |
| Zenn / `zenn` | 海外 | 文章 | — | — | — | — | 当前提供内容适配、复制和导出；未实现 GitHub 仓库同步发布。 |
| note / `note` | 海外 | 文章 | — | — | — | — | 当前提供内容适配、复制和导出；未实现专用发布连接。 |

知乎桥接为文章编辑，不支持向任意 question ID 自动发回答。Reddit 原生连接指定 subreddit；MultiPost 通用动态载荷不带 subreddit，需要在目标页面选择。微信视频号与微信公众号是不同目标。微博的 Wechatsync 路径使用 `card.weibo.com/article/v5/editor`，创建的是**长文章草稿**，不是直接发布普通微博动态。[下载的微博适配器](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/core/src/adapters/platforms/weibo.ts)

## 14 个社交、博客及原生 Webhook 连接器

以下媒体范围来自本应用当前实现，不能推断平台的全部 API 能力。工作台上传上限是单文件 25 MB；连接器的图片数量、格式及大小限制仍独立生效。

| 连接器 | 当前支持格式 | 权限、限制与完成证据 |
| --- | --- | --- |
| X | 文字 / 回复串帖；首条最多 4 张图 | 用户上下文 OAuth 2 Access Token，文字需 `tweet.write`，图片另需 `media.write`；不上传视频。全部线程返回 ID 才完成，部分提交或未知回执保留待确认 |
| Reddit | `kind=self` 文字帖 | subreddit / User-Agent 必填，Flair 可选；不上传图片或视频。帖子 ID / URL 判断完成 |
| Mastodon | 文字；最多 4 张图或单个视频 | 用户实例地址 / Token；等待媒体就绪后创建状态。帖子 ID / URL 判断完成；长度和素材硬上限由实例决定 |
| Bluesky | 300 grapheme 文字；最多 4 张、每张 2 MB 的图片 | 专用 App Password；不上传视频。AT record URI / CID 判断完成 |
| Telegram | 文字、单图 / 视频、2–10 个图视频媒体组 | Bot 需目标聊天发言权限；有媒体时说明最多 1024 字符。消息 ID 判断完成 |
| Discord | 文字；最多 10 个附件 | Incoming Webhook 使用 `wait=true`；禁用自动 mentions。消息 ID 判断完成，服务器 ID 可补链接 |
| Slack | 文字 | Incoming Webhook；不上传附件。只有 HTTP 200 且正文 `ok` 记完成；接口不提供消息 ID |
| DEV / Forem | Markdown 文章，公网图片 URL 嵌入 | API Key；默认草稿，显式 `postType=publish` 发布；不为 Forem 上传本地文件。明确文章状态与 ID 判断结果 |
| WordPress | HTML 文章；上传本地图片 / 视频 | Application Password；默认草稿，显式 `postType=publish` 发布。明确文章状态和 ID / URL 判断结果 |
| Ghost | HTML 文章；最多 20 张图片上传 | Admin Integration Key 生成短时 JWT，不能使用 Content API Key；默认草稿，显式 publish 才发表；不发送 Newsletter。明确 `draft` / `published` 与文章 ID / URL 判断结果 |
| Hashnode | Markdown 文章；最多 20 张、每张 8 MiB 图片 | PAT、Publication ID；当前官方写入 API 要求 **Pro Publication** 及对应写入角色，Contributor 不能直接发布。默认草稿，显式 publish；图片经签名 PUT + 上传确认，拒绝 SVG。草稿 ID 或发布文章 ID / URL 判断结果 |
| Misskey | 文字 / MFM 与最多 16 个 Drive 附件 | 实例 Token：检查需 `read:account`，发布需 `write:notes`，附件需 `write:drive`；文字与文件硬上限由实例决定。不提供草稿模式；创建的 Note ID / URI 判断完成 |
| Lemmy | Markdown 社区帖；最多 20 张公网图片 URL 嵌入 | 用户 JWT、正整数 Community ID；明确选择 v3 / v4 匹配实例，不失败后切换版本重发；不上传 pictrs。`federation_pending`、远端排期、移除 / 删除状态均待确认；结果链接使用 `ap_id`，`post.url` 是外链 |
| Blogger | HTML 文章；最多 20 张公网图片 URL 嵌入 | Google 用户 OAuth `blogger` scope 和数字 Blog ID；不上传 Google Photos，Token 过期需自行更新。默认草稿，返回明确 `DRAFT` / `LIVE` 与 ID / URL 判断结果；仅有 ID / URL 不推断状态 |

新增五个原生路径的实现按官方资料核对：Ghost 的 [Admin API](https://docs.ghost.org/admin-api)、[创建文章](https://docs.ghost.org/admin-api/posts/creating-a-post) 和 [上传图片](https://docs.ghost.org/admin-api/images/uploading-an-image)；Hashnode 官方维护的 [认证与角色](https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/auth-and-roles.md)、[调用流程](https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/recipes.md) 与 [GraphQL schema](https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/schema.graphql)。

Misskey 参照 [Token 权限](https://misskey-hub.net/en/docs/for-developers/api/token/)、[创建 Note](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/notes/create.ts) 和 [Drive 上传实现](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/drive/files/create.ts)；Lemmy 参照 [官方 API 说明](https://join-lemmy.org/docs/contributors/04-api.html)、[当前客户端](https://github.com/LemmyNet/lemmy-js-client/blob/main/src/http.ts)、[0.19 / v3 客户端](https://github.com/LemmyNet/lemmy-js-client/blob/release/v0.19/src/http.ts) 与 [Post 状态字段](https://github.com/LemmyNet/lemmy-js-client/blob/main/src/types/Post.ts)；Blogger 参照 [posts.insert](https://developers.google.com/blogger/docs/3.0/reference/posts/insert) 和 [Post 资源状态](https://developers.google.com/blogger/docs/3.0/reference/posts)。

原生连接检查不创建帖子。X、Reddit、Mastodon、Telegram、DEV、WordPress、Ghost、Hashnode、Misskey、Lemmy、Blogger 查询账号、目标或受鉴权资源；Bluesky 创建认证 session；Discord 查询 Webhook。Ghost 使用受鉴权 posts 列表核对密钥，公开 site 信息不能证明密钥有效。Slack 只能检查官方 URL 格式，无法无消息验证频道授权。检查成功不证明写入角色、套餐或素材权限满足所有条件。当前没有通用 OAuth 回调、Token 自动刷新、视频转码和各平台所有富媒体类型。

## 4 个企业消息连接器

企业连接暂不上传文件 / 图片，不接收 Thread，且没有读取个人会话或企业通讯录的功能。所有企业“检查连接”都仅验证本地配置和官方 URL 格式，**不发消息、不触发工作流、不验证密钥、权限或可达性**。签名、关键词、IP 白名单和机器人配额仍需用户在平台满足。

| 连接器 | 当前载荷与鉴权 | 成功与限制 |
| --- | --- | --- |
| 飞书群机器人 | 文本；平台自定义机器人 Webhook；可选签名 | 完整 JSON 请求体最多 20 KiB；明确 `code=0` 才记官方接口发送完成；不返回消息 ID，202 / 缺少结果仍待确认 |
| 钉钉群机器人 | 文本或 Markdown 子集；Webhooks 与可选加签 | 本应用限制完整 JSON 20 KiB，所查官方页面没有明确文本硬上限；官方每机器人 20 条 / 分钟。明确 `errcode=0` 才记完成；不返回消息 ID，202 / 缺少结果仍待确认 |
| 企业微信群机器人 | 文本或 Markdown 子集；Webhooks 自带 key | 文本 2048 UTF-8 字节，Markdown 4096 UTF-8 字节。明确 `errcode=0` 才记完成；不返回消息 ID，202 / 缺少结果仍待确认 |
| Microsoft Teams Workflows | 含正文的 Adaptive Card；用户创建的 `When a Teams webhook request is received` 触发器，认证为 `Anyone` | 用户另配置发送到目标频道的动作；不支持租户认证头模式，拒绝旧 Office 365 Connector 地址。本应用限制 JSON 28 KiB；**HTTP 2xx 只确认工作流受理，始终待人工核对消息投递** |

企业来源与 [ENTERPRISE_SOURCES](../server/enterprise.ts) 一致：飞书 [自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)；钉钉 [群消息](https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages)、[消息类型](https://open.dingtalk.com/document/orgapp/custom-bot-send-message-type) 与 [安全设置](https://open.dingtalk.com/document/orgapp/customize-robot-security-settings)；企业微信 [群机器人](https://developer.work.weixin.qq.com/document/path/91770)。

Teams 参照 [Webhook 触发器](https://learn.microsoft.com/en-us/connectors/teams/#when-a-teams-webhook-request-is-received)、[入站 Webhook / Workflows 配置](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)、[工作流触发问题](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot) 和 [旧 Office 365 Connector 退役公告](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)。

## 外部服务和浏览器路径

### Postiz：32 个映射

先在独立 Postiz 实例授权账号，再填写 API base、API Key、Integration ID 和 `settingsJson`。表中 provider 来自 [已下载的 Provider 注册表](https://github.com/gitroomhq/postiz-app/blob/6b102afb7eb535d677aec3302d7816e2a211fe89/libraries/nestjs-libraries/src/integrations/integration.manager.ts)；它不保证某个已部署版本提供全部目标。连接检查会核对 Integration 与 provider。Google 商家需地点 / 商家授权和具体平台设置；Kick / Twitch 是聊天或频道公告路径，不创建直播视频；listmonk 是通讯 / 邮件系统，列表、模式和真实发送由实例决定。

提交回执或远端排队状态保留为待确认，后台只读查询原任务，只有远端 `PUBLISHED` 与发布凭据才计完成；draft 是 Postiz 的远端草稿。远端最终内容、媒体、审查和授权仍由实例 / 平台决定。

### 小红书 MCP REST：图文和同机视频

图文默认为 `format=image`，调用 `/api/v1/publish`，需 1–18 张图片；独立服务必须已经登录，并能访问图片 URL。视频选择 `format=video`，调用 `/api/v1/publish_video`，只接受工作台上传的**单个 MP4**，不同时附带图片或其他文件。视频服务地址仅支持 `127.0.0.1`、`localhost`、`[::1]` 回环地址，并须直接运行在工作台同一主机、能读取工作台文件的绝对路径；路径由服务端安全取得，不在前端录入。远程、容器及路径映射部署不在当前视频路径范围内。全局单文件上限 25 MB。服务的登录上下文与账号绑定，多账号需隔离服务实例。

上游只支持单个本地视频文件，不能把浏览器文件名当服务主机路径；本应用使用队列提供的本机媒体路径。无论图文 / 视频，当前上游响应没有稳定帖子 ID / URL，即使回报“发布完成”，工作台也保留待确认，由用户核对。上游没有标准 save-draft API。MultiPost 小红书路径仍为图文键 `DYNAMIC_REDNOTE`，不会代替视频 REST 路径。[已下载 REST 路由](https://github.com/xpzouying/xiaohongshu-mcp/blob/a5c8f7799980ba1fdd501999843eb2d17e4c9a9f/routes.go)，[视频输入及服务实现](https://github.com/xpzouying/xiaohongshu-mcp/blob/a5c8f7799980ba1fdd501999843eb2d17e4c9a9f/service.go)

### Wechatsync：17 个草稿映射

需要 HTTP 桥、浏览器扩展与对应网站的登录会话；默认 WS 9527 / HTTP 9528。本工作台选择映射公开适配器中的 17 个草稿目标，使用 `syncArticle` 转发 HTML / Markdown，素材为最多 20 张图片，不上传视频。只有逐平台 `success=true`、`draftOnly=true` 和可核对的 postId / 安全 postUrl 才记草稿完成；收到请求或不明确状态保留待确认。微博是长文章草稿。公众号等后台草稿链接可能带 session token；含凭据参数的回执链接不会保存或返回前端，可凭 postId 记录草稿并到目标后台核对。扩展回报成功仍需检查草稿内容和素材。

映射来自 [已下载公开适配器列表](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/core/src/adapters/platforms/index.ts)，不把 README 中的私有 / 商业适配器计入当前复用能力。X、小红书不在公开适配器路径中。WordPress CMS 账号 ID 由扩展动态生成 `cms_<timestamp>`，未作为静态 Wechatsync 映射。[HTTP / WebSocket 桥源码](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/mcp-server/src/ws-bridge.ts)

### MultiPost：69 个公共注册键

本工作台使用公开的 [文章注册表](https://github.com/leaperone/MultiPost-Extension/blob/6269ab4ada1cf661a3624b2b9f496bb032a391d5/src/sync/article.ts)、[动态注册表](https://github.com/leaperone/MultiPost-Extension/blob/6269ab4ada1cf661a3624b2b9f496bb032a391d5/src/sync/dynamic.ts) 和 [视频注册表](https://github.com/leaperone/MultiPost-Extension/blob/6269ab4ada1cf661a3624b2b9f496bb032a391d5/src/sync/video.ts)；其中 17 个目录目标保留上游实验性标记。公开注册键证明有交接入口，不证明页面填充、媒体上传、授权或自动点击在真实账号可用。Substack 提供编辑页交接，通讯发送 / 最终发表仍在平台确认。

前台页面在同一浏览器检测扩展，并信任工作台 hostname。桥使用 `MULTIPOST_EXTENSION_PUBLISH` 与 `isAutoPublish:false` 打开审阅窗口，响应需匹配同窗口、origin、traceId、action 和结构。`received` 仅记交接，状态仍需用户处理；没有无人值守发布。多条 X 串帖不能经本桥一次提交。文章 HTML 清理后传递；公众号需要封面，视频载荷需要单个视频。扩展若不能读取工作台回环素材，可下载后在目标页面手动上传。浏览器路径可能受页面变化、上游实验性代码和目标审核影响。

### 仅导出和自供 Webhook

Quora、Qiita、Zenn、note 当前只有内容适配、复制和导出；Zenn 没有实现 GitHub 仓库同步。可以为这些及其他目标自行配置通用 Webhook 接收器，但用户须提供真实发布协议、账号授权和服务。HTTP 2xx / 202 只是受理，需明确 `published` / `drafted` 与远端 ID / URL 才计完成。`social-auto-upload` 未作为本应用子进程安装或调用；不因为下载参考仓库就宣称其发布能力已经接入。

## 验证和实际账号验收

没有账号时可以验证本地编辑、规则 / 模型配置、审批、导出、持久化、草稿备份及队列语义。开发 mock 验证载荷、签名、媒体限制、错误和回执判定，不能证明真实账号有目标平台发布权限。企业机器人格式检查尤其不等于鉴权成功。

配置渠道后，由用户先检查可只读验证的连接，再用可辨认的测试稿执行一次已审阅提交，核对最终内容、素材、草稿 / 公开状态和远端凭据。结果未知不自动重发；明确重试会创建新任务，先确认远端避免重复。预约到期时工作台服务须运行，浏览器交接还须前台用户操作。

启动、字段、素材访问与备份说明见 [README](../README.md)，九个参考仓库的实际提交及许可证边界见 [参考分析](./REFERENCE-ANALYSIS.md)。源码链接固定在本次下载提交；官方资料和平台权限可能变化，正式账号验收须以当前接口响应为准。
