# 2026-10-03 服务器部署记录

本次将创作者工作台部署到 **[https://myaistock.top/creator-platform/](https://myaistock.top/creator-platform/)**。这是服务器上的首个独立工作区，使用新建的数据目录；**没有迁移本机稿件、画像、账号连接或密钥**。入口启用 HTTPS 和 BasicAuth，使用现有服务器的访问账号，本文不记录任何凭据。

## 发布版本

| 项目 | 实际值 |
| --- | --- |
| 发布编号 | `20261003T083742Z` |
| 源码基线提交 | `25e11d9aac74f4d28a3ec18bc66e9fdbdc83f394`；部署改动另按文件摘要封签 |
| 应用镜像 | `creator-platform:20261003T083742Z` |
| 应用镜像 ID | `sha256:516c48e38cbaed0c6461a3f317c6ccdc4e7da923ea4bcd371de2feb24891f4af` |
| Node.js 实际版本 | `v22.23.3` |
| 构建与运行固定的 Node 基础镜像 | `node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c` |
| 发布包 SHA-256 | `edb2a6a6a536dca98a71f59ca50c910dade209dad692c6ffb3dc7829e8ca814d` |
| 发布包大小 | `391577` 字节 |
| 发布完成 | `2026-10-03 16:47:39`，北京时间（`08:47:39Z`） |
| 最终服务器复核 | `2026-10-03 16:54:27`，北京时间（`08:54:27Z`） |

发布计划封签了 76 个文件。传输包、服务镜像与公网前端产物经过摘要核对，公网实际提供的文件为 `index-CRyEdSKk.js` 和 `index-T6Pv6MrE.css`。Node 版本和 SQLite 可用性经过运行检查，最终服务器回执为 `DEPLOYED_VERIFIED`，容器健康状态为 `healthy`。

## 服务器布局与保护

| 用途 | 路径或配置 |
| --- | --- |
| 发布目录 | `/opt/creator-platform/releases/20261003T083742Z` |
| 当前版本链接 | `/opt/creator-platform/app`，指向本次发布目录 |
| Docker Compose 项目 / 容器 | `creator-platform` / `creator-platform-app-1` |
| 容器 ID | `6b866885cdc5339bf08d03b7d36e7d8a6825c82cf98b2ff402bb6c82a2eb3b6c` |
| 宿主机监听 | `127.0.0.1:4319`，转发至容器 `4318` |
| 持久化目录 | `/opt/creator-platform/data`，读写挂载至容器 `/data` |
| Nginx 子路径配置 | `/etc/nginx/snippets/creator-platform-location.conf` |
| 主站配置 | `/etc/nginx/sites-available/investcrew` |
| 本次发布回执 | 发布目录中的 `release.json` |
| 发布前 Nginx 备份 | 发布目录中的 `nginx-site.before` |

数据库 `creator.sqlite`、素材目录 `uploads`、凭据加密密钥 `vault.key` 和运行锁 `queue.lock` 位于持久化目录。服务以 `10001:10001` 运行；最终复核确认数据库与 `vault.key` 的所有者为 UID 10001、权限为 `0600`，部署环境文件与 Nginx 子路径配置也为 `0600`。这些数据与凭据未装入镜像。

启动入口使用 `flock --no-fork -n /data/queue.lock` 持有操作系统锁。同一数据目录只能运行一个发布进程；发布脚本在容器内尝试获取该锁，确认返回码为 1，证明正在运行的进程已持锁。

页面、API 和上传素材均通过 Nginx 的 BasicAuth 保护。远程模式要求 Nginx 注入独立代理令牌，并校验请求 Host 和 Origin。服务端口只绑定宿主机回环地址。容器根文件系统只读，`/tmp` 使用 64 MiB 临时内存盘，移除全部 Linux capabilities，启用 `no-new-privileges`，限制内存 512 MiB、CPU 1 核、进程数 128，日志按每份 10 MiB、最多 3 份轮转。

容器设置 `restart: unless-stopped`，退出后可重启；健康检查本身不会触发 Docker 自动重启。源码配置中的限制与封签产物一致，最终脚本另行复核了镜像、只读根文件系统、端口、文件权限及旧服务基线。

## 发布过程与既有站点

第一次发布尝试在执行变更前中止，原因是并发的 AIStock 更新使既有服务与预检基线不一致，保护断言返回 `Existing services changed; inspect before release.`。没有绕过该检查。

核对更新后的基线后再次发布，仅新增创作者工作台服务和子路径配置。发布前后均校验既有服务的镜像、启动时间和挂载。最终检查确认主站仍保留 `quantevo`、`market-radar` 和 `polymarket-lab` 的 Nginx include，同时新增 `creator-platform` include；既有站点仍可访问。Nginx 配置测试成功后才执行重载。

服务器构建使用固定 Node 基础镜像及锁定依赖，运行编译后的服务端 JavaScript。发布记录和部署产物留在本次发布目录，应用镜像保留在服务器，以便后续核对。

## 验收结果与范围

本地最终自动测试 **124/124 通过**，无失败、跳过或取消。TypeScript 类型检查、服务端编译和 Vite 生产构建均通过。

公网 HTTP 验收已通过以下检查：

- 页面、API 与上传素材入口均要求认证；远程模式健康检查和 Origin 保护符合预期。
- 不带末尾斜杠的 `/creator-platform` 入口以 HTTP 308 跳转至 `/creator-platform/`。
- 平台目录返回 102 个目标；这表示可选目标数量，不表示 102 个平台均已完成账号授权或真实发布。
- 公网加载的前端产物与已审核构建一致。
- 认证后的素材上传和读取成功。
- 保存验收原稿、生成 3 个平台版本、审核与导出流程成功。
- 单独重启创作者工作台容器后，稿件、媒体和 vault 持久化验证通过。
- 临时验收稿件已清理；最终服务器复核另确认临时验收媒体已清理。
- 既有站点可访问，服务器最终状态为健康。

这些是实际 HTTP/API 与服务器验收。Chrome 自动浏览器未通过 BasicAuth 进入线上工作台，**没有完成线上浏览器 UI 验收**，不应将此记录作为该项验收结果。本次也没有向任何社交平台真实发布，没有验证用户的第三方账号授权或 AI 服务凭据。

## 回滚与备份位置

本次发布包上传位置为 `/home/admin/creator-platform-20261003T083742Z/release.tar.gz`。服务器的发布目录保存 `release.json`、`build.json`、部署配置和 `nginx-site.before`；`/opt/creator-platform/app` 用于定位当前版本。上述位置是本次回滚与审计依据。

这是首次部署，没有更早的创作者工作台生产版本可切换。需要撤销本次上线时，应先核对当前主站及服务状态，只撤销创作者工作台新增的 include、配置和服务，保留 `/opt/creator-platform/data`。不能直接用旧 Nginx 备份覆盖期间其他产品的变更。重新启用或部署修订版本前，应通过 `nginx -t` 并再次核对既有服务。

后续版本回滚应保留当前持久化数据，并确认旧程序兼容数据库结构。备份必须同时保存数据库、`vault.key` 与素材；数据库和对应密钥应成套保留。运行中的 SQLite 应使用一致性备份方式，不能仅复制正在写入的数据库文件。本文记录回滚依据，没有执行回滚。

## 云端运行限制

账号连接和 AI 服务需要在新工作区重新配置。原生接口与服务端排期在服务器执行；连接地址中的 `127.0.0.1` 指向运行服务的服务器或容器，不指向用户电脑。Postiz、小红书 MCP 和 Wechatsync 等外部服务必须能从服务器访问，部署工作台不会自动部署或登录这些服务。

小红书视频接口仍要求与 MCP 服务同机可读的本地绝对 MP4 路径；不能把个人电脑路径当作云端服务可访问的素材。MultiPost 交接需要用户浏览器安装扩展、信任此站点并登录目标平台；浏览器关闭时不能靠服务器排期自动完成浏览器交接。

受 BasicAuth 保护的素材地址无法供第三方平台匿名抓取。需要远程抓取公网媒体 URL 的连接，应使用可访问的媒体服务或支持直接上传文件的接口，不能通过移除工作台访问保护解决。扩展或外部服务返回不确定结果时，应先核对平台实际状态，再明确决定重试；部署验收不代表这些连接已获授权或可以自动重试。

## 证据

本记录依据本次部署工作目录 `/Users/hyx/Documents/Codex/2026-10-03/new-chat/work/creator-deploy` 中的实际产物：

- `plan.json`：源码、发布目录、归档摘要和文件封签。
- `creator-runtime-prepare-output.txt`、`creator-build-output.txt`：Node/SQLite 运行检查、固定基础镜像与应用镜像构建回执。
- `creator-release-output.txt`、`creator-release-v2-output.txt`：首次基线检查中止与成功发布回执。
- `release-body.py` 及成功回执：实际镜像、运行用户、端口、挂载、持锁和既有服务保护断言。
- `creator-persistence-output.txt`：单服务重启与 vault 保留回执。
- `public-verification.json`：公网 HTTP 验收结果。
- `finalize-body.py`、`creator-final-verification-output.txt`：最终健康、权限、端口、只读运行、既有 include 与临时媒体清理检查。
- `tests-final.log`、`build-final.log`：124 项测试通过及最终构建结果。

这些证据不包含在本文中展开的访问口令或 API 密钥；本文整理时未读取凭据文件。
