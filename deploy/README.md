# 服务器部署

部署入口为 `https://myaistock.top/creator-platform/`。本应用是单用户工作台；线上入口由 HTTPS 和 Nginx Basic Auth 保护，页面、接口、上传文件统一鉴权。站点沿用 QuantEvo 的登录账号。后端要求 Nginx 注入独立代理令牌；未经过认证代理的请求返回 403。

## 构建

```sh
npm ci
CREATOR_BASE_PATH=/creator-platform/ npm run build
docker build -f deploy/Dockerfile -t creator-platform:RELEASE .
```

`dist/server` 是编译后的后端，`client/dist` 是包含子路径的前端。镜像使用 Node 22，生产依赖通过 lockfile 安装；无需在生产运行 TypeScript 编译器。数据库、素材、凭据密钥和 `.env` 不进入镜像或 Git。

## 首次安装

仅用于新的独立 creator-platform 服务，不要执行 QuantEvo 的 Compose 更新命令。

1. 创建 `/opt/creator-platform/data`，赋予容器用户 `10001:10001` 所有权和目录权限 `700`。
2. 创建权限 `600` 的 `deploy/.env`，设置 `PUBLIC_BASE_URL=https://myaistock.top/creator-platform`、强随机 `CREATOR_PROXY_TOKEN` 和 `CREATOR_IMAGE=creator-platform:RELEASE`。不要把真实令牌写入示例或版本库。
3. 使用 `docker compose -p creator-platform -f deploy/compose.yaml up -d --no-build`。宿主机端口只绑定 `127.0.0.1:4319`。保持一个副本；`flock` 拒绝第二个使用相同数据目录的发布进程。
4. 将 `nginx-subpath.conf.example` 作为独立片段接入现有 HTTPS server，使用与 `.env` 相同的真实代理令牌。复用已有受保护站点的 htpasswd，不覆盖其他站点配置。先 `nginx -t`，再 reload。
5. 核验无账号请求页面、API、素材返回 401；合法登录可用；跨站 Origin 被拒绝；健康、102 个平台、素材上传和导出通过；已有站点继续运行。

`restart: unless-stopped` 保证进程退出后由 Docker 重启，healthcheck 只报告健康状态。持久目录包含 `creator.sqlite`、`vault.key`、上传文件和队列锁。备份必须保留数据库与 `vault.key` 的配对；在线备份使用 SQLite 一致备份，不能仅拷贝正在写入的数据库文件。

## 发布与回滚

每次发布归档、文件清单和 SHA256 放入独立 release 目录，先在不挂生产数据的临时容器核验。切换时只启动 creator-platform 项目，保留同一数据挂载与代理令牌。代码回滚使用上一镜像和上一配置，不能以旧数据库覆盖后来保存的内容、账号或任务。首次安装失败时撤销新增 Nginx include 并停止该独立服务，保留数据与失败回执。

连接和分片上传参考 QuantEvo 的 `docs/server-connection.md` 与当前本地运维信息。使用已验证的 Swas 命令助手读取现有 profile，串行传输、逐片和整体 SHA256 校验；未知调用结果先核对保存的 InvokeId 与持久化发布回执，不能盲目重复部署。

## 云端使用边界

原生发布、定时队列和 HTTP 连接器在服务器执行。连接表单中的 `127.0.0.1` 指的是服务器容器，不再是用户电脑；小红书 MCP、Wechatsync 和 Postiz 等依赖需有服务器可访问的服务地址。MultiPost 仍在用户当前浏览器中交接，需要扩展授权信任 `myaistock.top` 和浏览器登录目标平台；关闭浏览器后不能自动完成该交接。

上传文件保持鉴权，不能作为第三方平台无需登录就能下载的公共素材链接。使用直接文件上传的连接器，或另行配置可公开访问的素材服务；不要为了平台抓取而取消工作台素材鉴权。AI 和发布账号需在工作区设置中自行配置。部署验证不会向任何真实社交平台发帖。
