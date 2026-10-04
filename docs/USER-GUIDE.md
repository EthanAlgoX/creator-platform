# Creator Studio user guide

[Project overview](../README.md) · [简体中文项目介绍](../README.zh-CN.md) · [Full platform matrix](./PLATFORM-COVERAGE.md)

This guide covers the personal workspace, account connections, publishing tasks, and data recovery. Availability depends on your account, its permissions, and the chosen connector. The catalog describes content adaptation targets; it does not promise automatic publishing to every site.

## Interface and content languages

The interface defaults to **English**. Use the **English / 简体中文** switch to change it; the choice is saved in that browser. Changing interface language does not translate saved drafts or change a writing profile's output language.

A writing profile has its own language, audience, tone, background, and forbidden words. Set its language for the content you want AI to produce. Rules-based adaptation restructures the supplied text; it is not a translation service. Review the output before publishing.

The seven navigation areas manage creation, the content library, publishing tasks, the platform directory, publishing accounts, writing profiles, and workspace settings. The workbench follows three stages: write, adapt and review, then distribute.

## Create and review content

### Prepare a source and profile

Create a writing profile with your intended audience, tone, output language, background, and forbidden words. Browse the platform directory by region, content format, and available connection route. Inspect a platform's requirements before adding it to your current creation.

In the source editor, enter a title and source text, select a profile, and add media. If starting with a topic, provide useful facts, opinions, or personal examples for the model to work from. The source must contain nonempty text to save or distribute.

Uploads accept PNG, JPEG, GIF, WebP, MP4, and PDF, up to **25 MB per file** and **20 attachments per source**. Connectors can have lower limits. PDF files are stored as attachments; paste text you want rewritten into the source. Video targets produce text, not video files; upload your own video.

Browser draft backup and a save to the workspace are separate states. A browser backup does not replace a server save or data-directory backup. Save changes before leaving or explicitly discard them when prompted. Clearing a saved source is still an edit; an empty source cannot be saved.

### Generate platform versions

Choose platforms in the picker. Search and filters narrow its list; bulk selection applies to the current filter. Changes are temporary until you apply them. Canceling keeps the original selection.

| Mode | Behavior |
| --- | --- |
| Rules-based adaptation | Restructures existing text for platform conventions, length, and paragraphs. No model key is needed. Long text may be truncated; check that important information survives. |
| AI writing | Sends the source and selected profile to your model service. Generates structured versions in sequential batches of up to six platforms. All batches must succeed before saving results. |

By default, generation creates only missing versions for selected platforms. Existing edits and approvals stay intact. To replace versions, explicitly regenerate and confirm the listed targets. Replacement removes their manual edits and approvals; copy or export anything you want to keep first.

The server rejects generation results if the source, profile, or relevant platform versions changed while generation ran. A failed provider request or later batch does not overwrite old versions or invent a successful fallback.

### Edit, validate, and approve

Review each platform's title, body, tags, length, media, and format issues. Article versions have a sanitized HTML preview. X supports threads: the body is the first post and stays synchronized with the first thread entry; separate thread parts with a line containing `---`.

Saving a text edit removes approval. Changes to the source or selected profile require another review. Regenerate, or explicitly confirm that the current wording still matches the updated source, retaining its wording and then approving it again. Versions with validation errors cannot be approved for distribution.

Copy or export without connecting an account. Exports are Markdown, article HTML, and JSON; exporting does not publish. Local upload links in HTML previews and Markdown/HTML downloads resolve through the deployment path. Files retain their authentication requirements; export does not make private uploads public.

## Configure AI

In workspace settings, configure a **Chat Completions-compatible** service:

| Field | Value |
| --- | --- |
| Service base URL | API base, commonly ending in `/v1`; omit `/chat/completions` and credentials. |
| Model | A model ID supported by that service. |
| API key | Service key, saved separately from the URL. |

The workbench appends `/chat/completions`. Enabling AI and saving configuration does not call the model; choose AI when generating. The current source and selected profile are sent to that provider. Platform account credentials are not included in the prompt.

An empty saved-key field retains the key. Use the explicit clear-key option to remove it. Rules-based adaptation remains available without AI configuration.

## Manage publishing accounts

Choose a platform and one of its available connection definitions. Forms come from the server's connector schema; their fields and requirements are authoritative. Store multiple accounts for the same platform if needed.

You supply credentials, resource IDs, and external services. The workbench does not create developer applications or provide a general OAuth login/refresh center. Tokens can expire and need manual replacement.

Save an account, then deliberately run its check. The UI distinguishes completeness, passed configuration checks, passed credential checks, and failures, storing the last check's time and message. Configuration-only checks do not prove login; a credential check does not guarantee publishing permission for a particular draft.

Changing connection parameters invalidates the old check; changing only its name or enabled state preserves it. Outdated asynchronous checks cannot verify changed credentials. Pending work prevents changing its publishing route or effective account configuration.

The API does not echo secrets. Forms indicate which secret fields already have values. When editing the same connection, leave a saved secret blank to retain it or enter a new value to replace it.

## Connection setup

### Postiz

Deploy or obtain access to a [Postiz](https://github.com/gitroomhq/postiz-app) instance and authorize accounts inside it. This workbench integrates the external API; it does not install or copy the Postiz application.

| Field | Meaning |
| --- | --- |
| `baseUrl` | Public API base with its prefix, for example `https://api.postiz.com/public/v1`. |
| `apiKey` | Your instance's public API key. |
| `integrationId` | Authorized account ID from the instance's `/integrations`; the provider must match the selected platform. |
| `postType` | `now` submits a remote publishing task; `draft` saves a Postiz draft. Default: `now`. |
| `settingsJson` | Optional JSON object with provider-specific settings. |

Reddit needs subreddit settings, Pinterest its board, Instagram its post type, and YouTube its required fields. These cannot be reliably inferred from generic copy; follow the Postiz provider's schema.

Local media is read from private storage and uploaded to Postiz's media API. The returned media URL is used in the post. Postiz and the provider control supported media, permissions, and quotas.

Queue acceptance does not prove publication. The workbench stores the remote task ID and checks that task's status without repeating the publish request.

### Xiaohongshu MCP REST

Run [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) separately and log in there. The default service address is `http://127.0.0.1:18060`. Checks read `/api/v1/login/status`; they do not post.

| Field | Meaning |
| --- | --- |
| `baseUrl` | Reachable REST service address. |
| `apiKey` | Optional Bearer token, matching its `AUTH_TOKEN` when enabled. |
| `format` | `image` for image posts, or `video`. Default: `image`. |

`image` calls `/api/v1/publish` and requires **1–18 images**. `video` calls `/api/v1/publish_video` and requires a **single uploaded MP4**. The video service must run directly on the same host, use a loopback address, and read the workbench's actual upload path. Remote video services and container path mapping are not implemented.

These routes submit posts, with no standard draft mode. A completion message without a stable post ID or link still requires verification. MultiPost's Xiaohongshu route handles image posts only.

The image route sends media URLs. Protected cloud uploads cannot be downloaded by an external service, so this route rejects protected local media in remote mode. See [server media access](#media-access-in-server-deployments).

### Wechatsync

Configure [Wechatsync](https://github.com/wechatsync/Wechatsync), its extension, and HTTP forwarding bridge. Log in to the target sites in the browser.

The workbench field is `baseUrl`, normally `http://127.0.0.1:9528` for HTTP. The extension's WebSocket default is `9527`. The bridge process's `WECHATSYNC_TOKEN` or `MCP_TOKEN` must match extension settings; an HTTP client field cannot replace that process configuration.

The 17 public draft mappings are Zhihu, WeChat Official Accounts, Weibo long-form articles, Baijiahao, CSDN, Juejin, Douban, Xueqiu, Sohu, Woshipm, Yuque, 51CTO, Imooc, OSChina, SegmentFault, Cnblogs, and Eastmoney. X and Xiaohongshu are not included in the current public adapter mapping.

This path writes target-site drafts, not public posts. Complete publication in the platform editor. Safe draft URLs can be retained in tasks; URLs containing session tokens or other credential parameters are not returned or stored as plaintext task links. A remote draft ID can still identify the draft for manual verification.

### MultiPost browser extension

Install [MultiPost](https://github.com/leaperone/MultiPost-Extension) and log in to target sites in the same browser. The workbench maps 69 public registration keys; some upstream adapters are experimental and require target-by-target verification.

Add the workbench's current **hostname** to trusted domains: for example `localhost`, `127.0.0.1`, or the deployed hostname. These are distinct entries. No server secret is needed, and the workbench does not store target-site cookies.

From publishing tasks, hand the reviewed content to the extension. The bridge opens MultiPost's review window with `isAutoPublish:false`; you complete the action. A matching `received` response means only receipt, and the task still needs user action. Check the platform, then record published, drafted, or failed as the actual result.

Timeouts, unknown runtime errors, and incomplete responses preserve `unconfirmed`: content might already have been received. Inspect the extension window and target site before retrying. Explicit trust rejection or validation failure before sending is a definite failure. Multi-post X threads cannot be sent in one handoff. The WeChat adapter writes drafts; publishing is separate.

Local media might not be readable by the extension in every setup. Verify in your browser, or upload downloaded files in the target editor. In remote mode, protected local attachments are blocked **before** handoff, leaving the task unchanged. Cancel it and rebuild without attachments, or choose a connector that uploads files directly. The extension's store version contains modules not fully open source; this workbench uses its public message protocol.

### Native APIs and incoming webhooks

There are 18 native connectors. Detailed media, role, quota, and response limits are in the [platform matrix](./PLATFORM-COVERAGE.md). Connector configuration does not grant platform permission.

| Connector | Fields and key conditions |
| --- | --- |
| X | `accessToken`: user-context OAuth 2 token, not an app-only read token. Needs `tweet.write`; images also need `media.write`. Text threads and up to four images on the first post. |
| Reddit | `accessToken`, `subreddit`, `userAgent`; optional `flairId`. Self-text posts only; no image/video upload. Follow subreddit rules. |
| Mastodon | `baseUrl`, `accessToken`; optional `visibility`. Instance limits apply; up to four images or one video. |
| Bluesky | `identifier`, `appPassword`; optional `baseUrl` (default `https://bsky.social`). Use a dedicated app password. |
| Telegram | `botToken`, `chatId`. The bot needs permission to send to the selected chat/channel. |
| Discord | `webhookUrl`; optional `guildId` for message links. Uses `wait=true` for a message receipt. |
| Slack | `webhookUrl`. Text-only; explicit HTTP 200 with `ok` required, no message ID invented. |
| DEV | `apiKey`; optional `postType=draft` or `publish`, default `draft`. Images use public URLs rather than file upload. |
| WordPress | `baseUrl`, `username`, `applicationPassword`; optional `postType`, default `draft`. Site REST API with direct media upload. |
| Ghost | `baseUrl`, `adminApiKey` (Admin Integration Key); optional `postType`, default `draft`. Direct image upload; no newsletter send. |
| Hashnode | `accessToken`, `publicationId`; optional `postType`, default `draft`. Current API requires a Pro Publication and write permissions. |
| Misskey | `baseUrl`, `accessToken`; optional `visibility`, `cw`. Account-read permission for checking, note/drive-write permissions for publishing/media. Up to 16 attachments; instance limits apply. |
| Lemmy | `baseUrl`, `accessToken`, `communityId`; optional `apiVersion=v3` or `v4`, default `v3`. Numeric community ID and matching API version; public image URLs, no pictrs upload. |
| Blogger | `accessToken`, `blogId`; optional `postType`, default `draft`. User OAuth token with Blogger scope; public image URLs. Explicit `LIVE`/`DRAFT` states confirm results. |
| Feishu / Lark bot | `webhookUrl`; optional `secret`. Text payload and numeric success code; no message ID. |
| DingTalk bot | `webhookUrl`; optional `secret`, `format=text` or `markdown`. Signature and bot security rules apply. |
| WeCom bot | `webhookUrl`; optional `format=text` or `markdown`. Text: 2,048 UTF-8 bytes; Markdown: 4,096 bytes. |
| Microsoft Teams Workflows | `webhookUrl`. Anyone-authenticated Workflows trigger with an Adaptive Card send action. HTTP acceptance is not delivery proof. |

Feishu, DingTalk, WeCom, and Teams checks validate configuration only: no test message or proof of webhook authorization. These enterprise connectors do not upload attachments. Teams remains pending confirmation after workflow acceptance.

### Custom publishing webhook

Provide your own publishing receiver. Fields are `url`, optional `apiKey` (Bearer token), and optional `healthUrl` for a read-only check. Without a health URL, the check verifies configuration only.

POST JSON includes `platformId`, `variant` (`title`, `body`, `tags`, `thread`, `html`), and `media` entries (`name`, `mime`, `url`). The receiver implements the platform protocol and authorization; the workbench does not supply that service.

An explicit result like this counts as completion with a real remote ID or safe URL:

```json
{
  "status": "published",
  "remoteId": "remote-post-id",
  "url": "https://your-platform.example/posts/remote-post-id"
}
```

`drafted` is also supported. HTTP 202 or bare 2xx without explicit proof remains uncertain. Do not manually record publication without verifying the remote result.

Quora, Qiita, Zenn, and note have no dedicated publisher; copy/export works. A custom webhook for these requires your implementation. Zenn GitHub repository synchronization is not implemented.

## Distribute and track tasks

After approval, choose compatible, enabled, configured accounts. Create immediate tasks or schedule them. A batch supports up to **200 account targets**, each with an independent result and the reviewed content/media snapshot at creation time.

Later edits do not rewrite existing tasks. To change scheduled content, cancel the pending task and create another. Active queued, scheduled, running, needs-action, or unconfirmed work for the same source/platform/account blocks duplicate scheduling, even after regeneration.

| State | Meaning and next action |
| --- | --- |
| `queued` | Waiting for execution. |
| `scheduled` | Waiting for its recorded time. |
| `running` | A publishing request is executing; avoid duplicate action. |
| `published` | Explicit remote proof, or a result you recorded after verification. |
| `drafted` | Remote draft confirmed; public publication is separate. |
| `needs_action` | Browser/user action required; extension receipt does not finish it. |
| `unconfirmed` | Unknown outcome: check the remote site before retrying or recording a result. |
| `failed` | Definite failure recorded: inspect before deliberate retry. |
| `cancelled` | Local pending work stopped; does not undo remote content or browser handoff. |

Display timezone defaults to `Asia/Shanghai` and can be changed in settings. Schedule inputs use your browser's local timezone, then store an actual timestamp. The service must run to execute schedules; restarting processes overdue work. MultiPost still needs a foreground browser handoff when due.

Timeouts or process exits can occur after remote acceptance. Unknown outcomes are never automatically republished. Formerly running tasks become unconfirmed after restart. Postiz tasks with remote IDs can be reconciled by read-only status checks.

An explicit retry creates a new task with the original reviewed snapshot and checks for other active work on that target. Verify remote records first. For needs-action/unconfirmed tasks, record results only after checking the real post or draft. Cancelling cannot retract already received extension content or published posts.

## Run locally or on a server

From the project root, use `npm ci` and `npm run dev`. The UI is at `http://127.0.0.1:4317`; Vite proxies the API/uploads to port `4318`.

For a compiled local service, run `npm run build`, then `npm run start:production`; open `http://127.0.0.1:4318`. Run from the project root so relative static/data paths resolve correctly. `npm start` is an alternative using `tsx` and needs development dependencies installed.

Set environment variables in the launching shell; copying `.env.example` to `.env` does not load them:

```bash
export HOST=127.0.0.1
export PORT=4318
export CREATOR_DATA_DIR=/absolute/path/to/private/creator-data
npm run start:production
```

Changing the development API port also requires changing Vite's proxy. Default local mode rejects non-loopback binding/access. A public media base does not enable remote mode or create a tunnel.

The [deployment guide](../deploy/README.md) covers Docker/Nginx hosting: explicit remote mode, HTTPS/Basic Auth, private proxy token, single queue instance, writable volume, and health checks. Build with the required path, for example:

```bash
CREATOR_BASE_PATH=/creator-platform/ npm run build
```

The app remains single-user. Hosted connection settings using `127.0.0.1` refer to the **server/container**, not your laptop. HTTP services must be reachable from that runtime. MultiPost's handoff happens in your current browser and needs its extension and target-site login.

### Media access in server deployments

Uploaded URLs remain `/uploads/...` storage identifiers; the UI adds the deployment prefix. `PUBLIC_BASE_URL` supplies the externally reachable base for URL-based integrations; it does not expose private files or change access policy.

Protected remote mode authenticates pages, APIs, and uploads. Third parties cannot download private URLs. DEV, Lemmy, Blogger, Xiaohongshu image posts, Wechatsync, and custom webhook routes passing local media URLs reject them before a remote publishing request. MultiPost attachments are blocked before handoff, leaving task status unchanged; no handoff is recorded.

Connectors that upload file bytes directly remain usable within their media rules, including Postiz. Do not disable upload authentication to make URL-based integrations fetch private media. Exported links retain authentication requirements; download and upload files in the target editor when appropriate.

## Backup and restore

Data defaults to `data/`; use `CREATOR_DATA_DIR` for another private directory. It contains:

| File or directory | Purpose |
| --- | --- |
| `creator.sqlite` | Sources, profiles, versions, account metadata, tasks, and encrypted credential vault. |
| `vault.key` | 32-byte encryption key, mode `0600`. |
| `uploads/` | Uploaded media/attachments. |
| `creator.sqlite-wal`, `creator.sqlite-shm` | SQLite runtime files that may exist while open. |

Account and AI secrets use AES-256-GCM with random nonces. The API does not return saved secret values. Sources, profiles, and task records remain normal database data; this is not full-database encryption.

For a file-copy backup:

1. Stop the service normally and wait for exit.
2. Copy the **entire data directory**, including the matching database, `vault.key`, and uploads. Preserve permissions and protect the backup.
3. To restore, stop the service, restore the complete directory, and start with the same `CREATOR_DATA_DIR`. Docker restores must preserve the configured container user's ownership and writable mount.

The database alone cannot recover credentials without its key. Keep them paired and out of Git. Online backup requires a consistent SQLite backup process, not a copy of a live database. Code rollback should not overwrite newer user data with an old database.

## Validation and live-account checks

From the project root:

```bash
npm run typecheck
npm test
npm run build
```

Tests use mock HTTP services, fake browser messages, and temporary SQLite. They validate workflow, payloads, media, errors, and results, not real-account permissions or current site adapters. Development validation did not publish to real social accounts. See the dated [UI validation](./VALIDATION.md) and [server deployment record](./SERVER-DEPLOYMENT-20261003.md).

After configuring an account, run its read-only check, then deliberately submit a recognizable reviewed test draft when ready. Verify text, media, public/draft state, and the actual remote result. Permissions, quotas, moderation, and browser pages can change. Never retry uncertain publishing until you check whether it succeeded.
