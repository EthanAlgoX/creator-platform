import { createHash, createHmac } from 'node:crypto';
import {isAbsolute} from 'node:path';
import {getEnterpriseDefinitions,isEnterprisePlatform,validateEnterprise,testEnterprise,publishEnterprise} from './enterprise.js';
import { countFor } from './domain.js';
import type { ConnectionPrivate, ConnectorDefinition, Media, Platform, PublishContext, PublishResult, Variant } from './types.js';

/** Publication ambiguity is deliberately different from a definite rejection. */
export class ConnectorError extends Error {
  readonly uncertain: boolean;
  readonly retryable: boolean;
  readonly terminalFailure: boolean;
  constructor(message: string, options: { uncertain?: boolean; retryable?: boolean; terminalFailure?: boolean } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.uncertain = options.uncertain ?? false;
    this.retryable = options.retryable ?? false;
    this.terminalFailure = options.terminalFailure ?? false;
  }
}

type Fields = ConnectorDefinition['fields'];
type JsonObject = Record<string, any>;
type ApiReply = { json: JsonObject | any[] | null; text: string; status: number };
const field = (key: string, label: string, extras: Omit<Fields[number], 'key' | 'label'> = {}): Fields[number] => ({ key, label, ...extras });
const secret = (key: string, label: string, help?: string): Fields[number] => field(key, label, { secret: true, required: true, help });
const urlField = (key: string, label: string, placeholder: string, required = true): Fields[number] => field(key, label, { required, placeholder });
const modeField = field('postType', '发布模式', { placeholder: 'draft', help: 'draft 保存草稿；publish 直接发布。默认 draft。' });
const nativePlatforms = ['x', 'reddit', 'mastodon', 'bluesky', 'telegram', 'discord', 'slack', 'devto', 'wordpress', 'ghost', 'hashnode', 'misskey', 'lemmy', 'blogger'];

export function getConnectorDefinitions(platforms: Platform[]): ConnectorDefinition[] {
  const definitions: ConnectorDefinition[] = [
    { id: 'postiz', name: 'Postiz API', mode: 'publish', platformIds: platforms.filter(p => p.postizId).map(p => p.id), description: '连接自部署或云端 Postiz。提交后的排队状态需远端核对，专属平台参数由 settingsJson 指定。', fields: [urlField('baseUrl', 'API 基址', 'https://api.postiz.com/public/v1'), secret('apiKey', 'Postiz API Key'), field('integrationId', 'Integration ID', { required: true, help: '账号 ID，可通过 Postiz 的 /integrations API 获取。' }), field('postType', '提交模式', { placeholder: 'now', help: 'now 提交远端发布任务；draft 只保存 Postiz 草稿。默认 now。' }), field('settingsJson', '平台设置 JSON', { placeholder: '{"who_can_reply_post":"everyone"}', help: '仅 JSON 对象。Reddit 示例：{"subreddit":[{"value":{"subreddit":"test","title":"文章标题","type":"self"}}]}。Instagram 需 post_type，Pinterest 需 board，YouTube 需 title/type。依据 Postiz 对应 provider 文档配置。' })] },
    { id: 'xiaohongshu', name: '小红书 MCP REST', mode: 'publish', platformIds: ['xiaohongshu'], description: '已登录 REST 服务发布图文或同机视频。视频服务须直接运行于工作台主机并能读取上传路径；无稳定帖子 ID 时仍需核对。', fields: [urlField('baseUrl', '服务地址', 'http://127.0.0.1:18060'), field('apiKey', '服务令牌（可选）', { secret: true, help: '对应服务 AUTH_TOKEN，使用 Bearer。' }), field('format','内容格式',{placeholder:'image',help:'image 图文（默认）或 video 视频。video 仅支持同机回环服务，使用已上传的单个 MP4；容器、远程服务和路径映射未接入。'})] },
    { id: 'wechatsync', name: 'Wechatsync HTTP 桥', mode: 'draft', platformIds: platforms.filter(p => p.wechatsyncId).map(p => p.id), description: '连接 Wechatsync MCP HTTP 桥与浏览器扩展。已支持的渠道保存平台草稿，不将扩展接收任务当成发布成功。', fields: [urlField('baseUrl', 'HTTP 桥地址', 'http://127.0.0.1:9528')] },
    { id: 'multipost', name: 'MultiPost 浏览器扩展', mode: 'bridge', platformIds: platforms.filter(p => p.multipostId).map(p => p.id), description: '任务交由前台浏览器扩展；用户在目标网站核对并完成发布。无需服务端凭据。', fields: [] },
    { id: 'webhook', name: '自定义发布 Webhook', mode: 'custom', platformIds: platforms.map(p => p.id), description: '向自建接收器发送内容和素材 URL。仅明确的 published/drafted 及远端凭据才计为完成。', fields: [field('url', 'Webhook URL', { required: true, secret: true, placeholder: 'https://your-service.example/publish' }), field('apiKey', 'Bearer 令牌（可选）', { secret: true }), urlField('healthUrl', '只读检查地址（可选）', 'https://your-service.example/health', false)] },
    { id: 'native:x', name: 'X 官方 API', mode: 'publish', platformIds: ['x'], description: 'OAuth 2 用户 access token；支持文字线程与最多 4 张图片。需 tweet.write；图片另需 media.write。', fields: [secret('accessToken', '用户 Access Token', '用户上下文 OAuth 2 令牌，不是应用只读 bearer。')] },
    { id: 'native:reddit', name: 'Reddit 官方 API', mode: 'publish', platformIds: ['reddit'], description: '用户 OAuth access token 发布 self 文字帖，遵守版块规则。该连接器暂不上传图片或视频。', fields: [secret('accessToken', '用户 Access Token'), field('subreddit', '目标 Subreddit', { required: true, placeholder: 'test' }), field('userAgent', 'User-Agent', { required: true, placeholder: 'web:creator-workspace:v0.1 (by /u/yourname)' }), field('flairId', 'Flair ID（可选）')] },
    { id: 'native:mastodon', name: 'Mastodon 官方 API', mode: 'publish', platformIds: ['mastodon'], description: '实例用户 access token；支持最多 4 张图片或 1 段视频。上传素材就绪后创建状态。', fields: [urlField('baseUrl', '实例地址', 'https://mastodon.social'), secret('accessToken', 'Access Token'), field('visibility', '可见性', { placeholder: 'public', help: 'public / unlisted / private / direct，默认 public。' })] },
    { id: 'native:bluesky', name: 'Bluesky AT Protocol', mode: 'publish', platformIds: ['bluesky'], description: '使用专用 App Password；支持 300 字符文字及最多 4 张、每张 2 MB 的图片。', fields: [field('baseUrl', 'PDS 服务地址', { placeholder: 'https://bsky.social', help: '默认 https://bsky.social。' }), field('identifier', '账号 Handle / DID', { required: true, placeholder: 'yourname.bsky.social' }), secret('appPassword', 'App Password', '使用账号生成的专用 app password。')] },
    { id: 'native:telegram', name: 'Telegram Bot API', mode: 'publish', platformIds: ['telegram'], description: '机器人须有目标聊天发言权限。支持文字、单图/视频、2–10 个图视频媒体组；媒体说明最多 1024 字符。', fields: [secret('botToken', 'Bot Token'), field('chatId', 'Chat ID / @频道名', { required: true, placeholder: '@yourchannel' })] },
    { id: 'native:discord', name: 'Discord Incoming Webhook', mode: 'publish', platformIds: ['discord'], description: 'wait=true 等待消息回执；支持文字和最多 10 个附件，禁止自动 @所有人。', fields: [secret('webhookUrl', 'Webhook URL'), field('guildId', '服务器 ID（可选）', { help: '用于生成消息链接；不填写时仍可按消息 ID 核对。' })] },
    { id: 'native:slack', name: 'Slack Incoming Webhook', mode: 'publish', platformIds: ['slack'], description: '向 Webhook 所属频道发文字。Slack 返回 ok 才记录完成；此 API 不提供消息 ID 和只读鉴权检查。暂不上传附件。', fields: [secret('webhookUrl', 'Webhook URL')] },
    { id: 'native:devto', name: 'DEV / Forem API', mode: 'draft', platformIds: ['devto'], description: 'API Key 保存文章草稿或发布。图片以公网 URL 嵌入，不上传到 Forem。', fields: [secret('apiKey', 'DEV API Key'), modeField] },
    { id: 'native:wordpress', name: 'WordPress REST API', mode: 'draft', platformIds: ['wordpress'], description: 'WordPress Application Password 鉴权；上传图片/视频并保存文章草稿或发布。', fields: [urlField('baseUrl', 'WordPress 网站地址', 'https://your-site.example'), field('username', '用户名', { required: true }), secret('applicationPassword', 'Application Password'), modeField] },
    { id: 'native:ghost', name: 'Ghost Admin API', mode: 'draft', platformIds: ['ghost'], description: 'Admin Integration Key 生成短时 JWT；上传图片并保存 HTML 文章草稿或发布。默认草稿，不发送 Newsletter。', fields: [urlField('baseUrl', 'Ghost Admin 所在地址', 'https://your-site.ghost.io'), secret('adminApiKey', 'Admin API Key', '在 Ghost 自定义 Integration 获取 id:secret，不是 Content API Key。'), modeField] },
    { id: 'native:hashnode', name: 'Hashnode GraphQL API', mode: 'draft', platformIds: ['hashnode'], description: 'Personal Access Token 写入指定 Publication；草稿或发布，支持官方 CDN 图片上传（每张最多 8 MB）。当前官方 API 要求 Publication 具备 Pro 计划及对应写入角色。', fields: [secret('accessToken', 'Personal Access Token'), field('publicationId', 'Publication ID', { required: true, placeholder: '24 位十六进制 ObjectId', help: '当前官方发布/草稿 API 需要 Pro Publication；账号需有对应写入权限，Contributor 不能直接发布。' }), modeField] },
    { id: 'native:misskey', name: 'Misskey HTTP API', mode: 'publish', platformIds: ['misskey'], description: '使用实例 Access Token；上传 Drive 附件并创建 Note，最多 16 个附件。没有草稿模式，文字和单文件大小以实例配置为准。', fields: [urlField('baseUrl', 'Misskey 实例地址', 'https://misskey.example'), secret('accessToken', 'Access Token', '只读检查需要 read:account；发布需要 write:notes，上传另需 write:drive。'), field('visibility', '可见性', { placeholder: 'public', help: 'public / home / followers，默认 public。' }), field('cw', '内容警告（可选）', { help: '最多 100 字符。' })] },
    { id: 'native:lemmy', name: 'Lemmy 官方 API', mode: 'publish', platformIds: ['lemmy'], description: '用户 JWT 在指定社区创建 Markdown 帖子；支持公网图片 URL 嵌入，不上传到 pictrs。v3/v4 需与实例匹配；联邦等待确认保留为结果未知。', fields: [urlField('baseUrl', 'Lemmy 实例地址', 'https://lemmy.world'), secret('accessToken', '用户 JWT'), field('communityId', 'Community ID', { required: true, help: '此实例上的正整数社区 ID，不是社区名称。' }), field('apiVersion', 'API 版本', { placeholder: 'v3', help: 'v3 对应 0.19 系列，v4 对应新版实例；默认 v3。不会失败后切换版本重发。' })] },
    { id: 'native:blogger', name: 'Blogger API v3', mode: 'draft', platformIds: ['blogger'], description: 'Google 用户 OAuth Access Token；HTML 文章草稿或发布。图片以公网 URL 嵌入，不上传 Google Photos；实际返回 LIVE/DRAFT 才确认状态。', fields: [secret('accessToken', 'Google OAuth Access Token', '需要 https://www.googleapis.com/auth/blogger 权限；不是 API Key。令牌过期需自行更新。'), field('blogId', 'Blog ID', { required: true, help: '目标 Blogger 博客的数字 ID。' }), modeField] },
  ];
  return [...definitions,...getEnterpriseDefinitions(platforms)].map(d => ({ ...d, platformIds: d.platformIds.filter(id => platforms.some(p => p.id === id)) })).filter(d => d.platformIds.length);
}

function definition(connection: ConnectionPrivate, platform: Platform): ConnectorDefinition | undefined {
  const id = connection.connector === 'native' ? `native:${platform.id}` : connection.connector;
  return getConnectorDefinitions([platform]).find(d => d.id === id);
}
function validUrl(value: string): boolean {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
function hookValid(value: string, provider: 'slack' | 'discord'): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (provider === 'slack'
      ? ['hooks.slack.com', 'hooks.slack-gov.com'].includes(u.hostname) && u.pathname.startsWith('/services/')
      : ['discord.com', 'discordapp.com'].includes(u.hostname) && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+/.test(u.pathname));
  } catch { return false; }
}
function settings(config: Record<string, string>): JsonObject {
  if (!config.settingsJson?.trim()) return {};
  const parsed: unknown = JSON.parse(config.settingsJson);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Expected object');
  return parsed as JsonObject;
}

export function validateConnection(connection: ConnectionPrivate, platform: Platform): string[] {
  if(connection.connector==='native'&&isEnterprisePlatform(platform.id))return validateEnterprise(connection,platform);
  const errors: string[] = [];
  if (connection.platformId !== platform.id) errors.push('连接与目标平台不匹配。');
  const def = definition(connection, platform);
  if (!def) return [...errors, '此连接器不支持目标平台。'];
  for (const f of def.fields) {
    if (f.required && !connection.config[f.key]?.trim()) errors.push(`请填写${f.label}。`);
  }
  for (const key of ['baseUrl', 'url', 'healthUrl']) {
    if (connection.config[key]?.trim() && !validUrl(connection.config[key])) errors.push(`${key} 必须是没有内嵌账号密码的 HTTP(S) 地址。`);
  }
  if (connection.connector === 'postiz') {
    if (connection.config.postType && !['now', 'draft'].includes(connection.config.postType)) errors.push('Postiz 提交模式必须为 now 或 draft。');
    try { settings(connection.config); } catch { errors.push('settingsJson 必须是有效 JSON 对象。'); }
  }
  if(connection.connector==='xiaohongshu'){
    if(connection.config.format&&!['image','video'].includes(connection.config.format))errors.push('小红书内容格式只能为 image 或 video。');
    if(connection.config.format==='video'&&connection.config.baseUrl){try{if(!['127.0.0.1','localhost','[::1]'].includes(new URL(connection.config.baseUrl).hostname))errors.push('小红书视频仅支持能读取工作台文件的同机回环服务。');}catch{/* URL validation above reports malformed addresses. */}}
  }
  if (connection.connector === 'native') {
    if (!nativePlatforms.includes(platform.id)) errors.push('此平台还没有原生连接器。');
    if (['devto', 'wordpress', 'ghost', 'hashnode', 'blogger'].includes(platform.id) && connection.config.postType && !['draft', 'publish'].includes(connection.config.postType)) errors.push('发布模式必须为 draft 或 publish。');
    if (['slack', 'discord'].includes(platform.id) && connection.config.webhookUrl && !hookValid(connection.config.webhookUrl, platform.id as 'slack' | 'discord')) errors.push('请填写对应平台的官方 HTTPS Incoming Webhook 地址。');
    if (platform.id === 'mastodon' && connection.config.visibility && !['public', 'unlisted', 'private', 'direct'].includes(connection.config.visibility)) errors.push('Mastodon 可见性设置无效。');
    if (platform.id === 'telegram' && connection.config.botToken && !/^\d+:[A-Za-z0-9_-]+$/.test(connection.config.botToken)) errors.push('Bot Token 格式无效。');
    if (platform.id === 'reddit' && connection.config.subreddit && !/^(?:r\/)?[A-Za-z0-9_]+$/.test(connection.config.subreddit)) errors.push('Subreddit 名称格式无效。');
    if (platform.id === 'ghost' && connection.config.adminApiKey && !/^[a-f\d]{24}:[a-f\d]{64}$/i.test(connection.config.adminApiKey)) errors.push('Ghost Admin API Key 必须是 24 位 ID:64 位十六进制密钥。');
    if (platform.id === 'hashnode' && connection.config.publicationId && !/^[a-f\d]{24}$/i.test(connection.config.publicationId)) errors.push('Hashnode Publication ID 必须是 24 位十六进制 ObjectId。');
    if (platform.id === 'misskey' && connection.config.visibility && !['public', 'home', 'followers'].includes(connection.config.visibility)) errors.push('Misskey 可见性必须为 public、home 或 followers。');
    if (platform.id === 'misskey' && (connection.config.cw?.length ?? 0) > 100) errors.push('Misskey 内容警告最多 100 字符。');
    if (platform.id === 'lemmy' && connection.config.communityId && (!/^\d+$/.test(connection.config.communityId) || !Number.isSafeInteger(Number(connection.config.communityId)) || Number(connection.config.communityId) <= 0)) errors.push('Lemmy Community ID 必须是正整数。');
    if (platform.id === 'lemmy' && connection.config.apiVersion && !['v3', 'v4'].includes(connection.config.apiVersion)) errors.push('Lemmy API 版本必须为 v3 或 v4。');
    if (platform.id === 'blogger' && connection.config.blogId && !/^\d+$/.test(connection.config.blogId)) errors.push('Blogger Blog ID 必须是数字 ID。');
  }
  return errors;
}

function requireConnection(connection: ConnectionPrivate, platform: Platform): void {
  const errors = validateConnection(connection, platform);
  if (errors.length) throw new ConnectorError(errors.join(' '));
}
function base(config: Record<string, string>, fallback?: string): string {
  return (config.baseUrl || fallback || '').replace(/\/+$/, '');
}
function bearer(token?: string): Record<string, string> { return token ? { Authorization: `Bearer ${token}` } : {}; }
function wpBase(config: Record<string, string>): string {
  const b = base(config); return b.endsWith('/wp-json/wp/v2') ? b : `${b}/wp-json/wp/v2`;
}
function wpAuth(config: Record<string, string>): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64')}` };
}
function ghostBase(config: Record<string, string>): string {
  const b = base(config); return b.endsWith('/ghost/api/admin') ? b : `${b}/ghost/api/admin`;
}
function ghostAuth(config: Record<string, string>): Record<string, string> {
  const [id, key] = config.adminApiKey.split(':');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const signature = createHmac('sha256', Buffer.from(key, 'hex')).update(`${header}.${body}`).digest('base64url');
  return { Authorization: `Ghost ${header}.${body}.${signature}`, 'Accept-Version': 'v5.0' };
}
function lemmyBase(config: Record<string, string>): string {
  return `${base(config).replace(/\/api\/v[34]$/, '')}/api/${config.apiVersion || 'v3'}`;
}
function stringId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}
function safeLink(value: unknown): string | undefined { return typeof value === 'string' && validUrl(value) ? value : undefined; }
function safePublicationLink(value: unknown): string | undefined {
  const link = safeLink(value); if (!link) return undefined;
  // Receipt URLs are persisted in ordinary job records: never retain session credentials.
  for (const key of new URL(link).searchParams.keys()) {
    if (/(?:token|secret|password|authorization|api[_-]?key|(?:^|[_-])(?:auth|key|sig|signature|nonce)(?:$|[_-]))/i.test(key)) return undefined;
  }
  return link;
}
function pending(message = '远端已接收请求，但没有确认完成；请核对后确认结果。', remoteId?: string): PublishResult { return { status: 'unconfirmed', message, ...(remoteId ? { remoteId } : {}) }; }
function exactProof(status: 'published' | 'drafted', message: string, id: unknown, url?: unknown): PublishResult {
  const remoteId = stringId(id); const link = safePublicationLink(url);
  return remoteId || link ? { status, message, remoteId, url: link } : pending();
}

/** Never echo an upstream response or URL: either can contain a credential. */
async function request(url: string, init: RequestInit = {}, options: { publishes?: boolean; signal?: AbortSignal; timeout?: number } = {}): Promise<ApiReply> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? 45_000)]) : AbortSignal.timeout(options.timeout ?? 45_000);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal });
    text = await response.text();
  } catch {
    throw new ConnectorError(options.publishes ? '发布请求没有取得完整回执，结果未知，请先核对远端，避免重复发布。' : '无法连接或取得服务回执，请检查地址、服务和网络。', { uncertain: options.publishes, retryable: !options.publishes });
  }
  if (!response.ok) {
    throw new ConnectorError(`远端服务返回 HTTP ${response.status}。${response.status === 401 || response.status === 403 ? '请检查账号权限和凭据。' : ''}`, { uncertain: !!options.publishes && (response.status >= 500 || response.status === 408), retryable: !options.publishes && (response.status >= 500 || response.status === 429) });
  }
  let json: ApiReply['json'] = null;
  try { json = JSON.parse(text); } catch { /* Slack is deliberately plain text; unknown success bodies remain unconfirmed. */ }
  return { json, text, status: response.status };
}
function jsonRequest(payload: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) };
}
function object(reply: ApiReply): JsonObject { return reply.json && !Array.isArray(reply.json) ? reply.json : {}; }
function outcomeObject(reply: ApiReply): JsonObject { return reply.status === 202 ? {} : object(reply); }
function noMedia(media: Media[], name: string): void { if (media.length) throw new ConnectorError(`${name} 原生连接器暂不上传素材；请选择支持素材的连接方式或移除素材。`); }
function imageOnly(media: Media[], max: number, name: string): void {
  if (media.length > max || media.some(m => !m.mime.startsWith('image/'))) throw new ConnectorError(`${name} 此连接器最多支持 ${max} 张图片，暂不支持其他附件。`);
}
function textLimit(text: string, limit: number, name: string, graphemes = false): void {
  const length = graphemes ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length : Array.from(text).length;
  if (length > limit) throw new ConnectorError(`${name} 当前内容超过 ${limit} 字符，需先编辑。`);
}
function publicUrl(media: Media, context: PublishContext, publicRequired = false): string {
  let u: URL;
  try { u = new URL(media.url, context.publicBaseUrl); } catch { throw new ConnectorError('素材地址无效。'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new ConnectorError('素材需要可访问的 HTTP(S) 地址。');
  if (publicRequired && (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))) throw new ConnectorError('该平台需要公网素材 URL，本机或局域网上传地址不可用。请配置公网地址或使用支持文件上传的连接器。');
  return u.toString();
}
async function mediaBlob(media: Media, context: PublishContext): Promise<Blob> {
  const bytes = await context.readMedia(media);
  return new Blob([new Uint8Array(bytes)], { type: media.mime });
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
function bodyHtml(variant: Variant): string { return variant.html || variant.body.split(/\n\n+/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n'); }
function threadTexts(variant: Variant): string[] { return variant.thread.length ? variant.thread : [variant.body]; }

async function bskySession(config: Record<string, string>): Promise<JsonObject> {
  const reply = object(await request(`${base(config, 'https://bsky.social')}/xrpc/com.atproto.server.createSession`, jsonRequest({ identifier: config.identifier, password: config.appPassword })));
  if (!reply.accessJwt || !reply.did) throw new ConnectorError('Bluesky 没有返回有效账号会话。');
  return reply;
}

async function hashnodeRequest(config: Record<string, string>, query: string, variables: JsonObject = {}, options: { publishes?: boolean; signal?: AbortSignal } = {}): Promise<JsonObject> {
  const reply = await request('https://gql.hashnode.com', jsonRequest({ query, variables }, { ...bearer(config.accessToken), 'x-hashnode-client': 'creator-platform' }), options);
  const data = options.publishes ? outcomeObject(reply) : object(reply);
  if (Array.isArray(data.errors) && data.errors.length) {
    // Unknown execution errors can occur after the mutation committed. Do not resubmit.
    const beforeExecution = ['GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'BAD_USER_INPUT', 'BAD_REQUEST'];
    const definite = !data.data || Object.values(data.data).every(value => value == null);
    const known = data.errors.every((error: JsonObject) => beforeExecution.includes(error.extensions?.code));
    const permission = data.errors.some((error: JsonObject) => ['FORBIDDEN', 'UNAUTHENTICATED'].includes(error.extensions?.code));
    throw new ConnectorError(permission ? 'Hashnode 拒绝访问，请检查 PAT、写入角色和 Publication 的 Pro 计划。' : 'Hashnode GraphQL 请求返回错误，请核对远端后检查参数和权限。', { uncertain: !!options.publishes && !(definite && known) });
  }
  return data.data && typeof data.data === 'object' ? data.data : {};
}

/** Credential checks never create a post, message, draft, or upload. */
export async function testConnection(connection: ConnectionPrivate, platform: Platform): Promise<{ ok: boolean; message: string }> {
  try {
    requireConnection(connection, platform);
    if(connection.connector==='native'&&isEnterprisePlatform(platform.id))return testEnterprise(connection,platform);
    const c = connection.config;
    if (connection.connector === 'multipost') return { ok: true, message: '连接配置有效；请在前台发布队列检查 MultiPost 扩展是否安装。' };
    if (connection.connector === 'webhook' && !c.healthUrl) return { ok: true, message: '配置格式有效；未配置只读检查地址，没有发送发布请求。' };
    if (connection.connector === 'postiz') {
      const reply = await request(`${base(c)}/integrations`, { headers: { Authorization: c.apiKey } });
      const integrations = Array.isArray(reply.json) ? reply.json : object(reply).integrations;
      if (!Array.isArray(integrations)) throw new ConnectorError('Postiz 没有返回账号列表。');
      const account = integrations.find(a => a.id === c.integrationId);
      if (!account) throw new ConnectorError('Postiz 没有找到该 Integration ID。');
      if (account.providerIdentifier && account.providerIdentifier !== platform.postizId) throw new ConnectorError('Postiz 账号所属平台与此连接不匹配。');
      return { ok: true, message: 'Postiz 凭据有效，已找到对应平台账号。' };
    }
    if (connection.connector === 'xiaohongshu') {
      const data = object(await request(`${base(c)}/api/v1/login/status`, { headers: bearer(c.apiKey) }));
      return { ok: data.success === true && data.data?.is_logged_in === true, message: data.data?.is_logged_in ? '小红书服务已登录。' : '小红书浏览器服务尚未登录。' };
    }
    if (connection.connector === 'wechatsync') {
      const status = object(await request(`${base(c)}/status`));
      if (status.connected !== true) return { ok: false, message: 'Wechatsync 扩展尚未连接 HTTP 桥。' };
      const data = object(await request(`${base(c)}/request`, jsonRequest({ method: 'checkAuth', params: { platform: platform.wechatsyncId } })));
      return { ok: data.result?.isAuthenticated === true, message: data.result?.isAuthenticated ? 'Wechatsync 目标平台已登录。' : 'Wechatsync 目标平台尚未登录。' };
    }
    if (connection.connector === 'webhook') { await request(c.healthUrl, { headers: bearer(c.apiKey) }); return { ok: true, message: '只读检查地址返回成功；没有发送内容。' }; }
    if (platform.id === 'slack') return { ok: true, message: 'Slack Webhook 格式有效；Incoming Webhook 没有只读鉴权接口，没有发送测试消息。' };
    if (platform.id === 'bluesky') { await bskySession(c); return { ok: true, message: 'Bluesky 账号会话有效，没有创建内容。' }; }
    if (platform.id === 'ghost') {
      // /site is public and cannot validate an Admin Integration Key.
      const data = object(await request(`${ghostBase(c)}/posts/?limit=1&fields=id`, { headers: ghostAuth(c) }));
      if (!Array.isArray(data.posts)) throw new ConnectorError('Ghost 没有返回经过鉴权的文章列表。');
      return { ok: true, message: 'Ghost Admin 凭据通过只读文章列表检查，没有创建草稿或上传图片。' };
    }
    if (platform.id === 'hashnode') {
      const data = await hashnodeRequest(c, 'query CreatorConnection($id: ObjectId!) { me { id } publication(id: $id) { id } }', { id: c.publicationId });
      if (!stringId(data.me?.id) || data.publication?.id !== c.publicationId) throw new ConnectorError('Hashnode 没有确认当前账号及指定 Publication。');
      return { ok: true, message: 'Hashnode PAT 与目标 Publication 通过只读查询；实际写入仍需对应角色和 Pro 计划，没有执行 mutation。' };
    }
    if (platform.id === 'misskey') {
      const data = object(await request(`${base(c)}/api/i`, jsonRequest({ i: c.accessToken })));
      if (data.error || !stringId(data.id)) throw new ConnectorError('Misskey 没有确认当前用户；令牌需要 read:account 权限。');
      return { ok: true, message: 'Misskey 当前账号通过只读检查，没有创建 Note 或 Drive 文件。' };
    }
    if (platform.id === 'lemmy') {
      const v4 = c.apiVersion === 'v4';
      const data = object(await request(`${lemmyBase(c)}/${v4 ? 'account' : 'site'}`, { headers: bearer(c.accessToken) }));
      const user = v4 ? data.local_user_view : data.my_user?.local_user_view;
      if (!stringId(user?.person?.id)) throw new ConnectorError('Lemmy 没有确认当前用户，请检查 JWT 和 API 版本。');
      const target = object(await request(`${lemmyBase(c)}/community?id=${encodeURIComponent(c.communityId)}`, { headers: bearer(c.accessToken) }));
      if (Number(target.community_view?.community?.id) !== Number(c.communityId)) throw new ConnectorError('Lemmy 没有找到指定社区。');
      return { ok: true, message: 'Lemmy 用户与社区通过只读检查，没有创建帖子；发布仍受社区规则和账号权限限制。' };
    }
    if (platform.id === 'blogger') {
      const user = object(await request('https://www.googleapis.com/blogger/v3/users/self', { headers: bearer(c.accessToken) }));
      if (!stringId(user.id)) throw new ConnectorError('Blogger 没有确认当前 Google 用户。');
      const data = object(await request('https://www.googleapis.com/blogger/v3/users/self/blogs', { headers: bearer(c.accessToken) }));
      if (!Array.isArray(data.items) || !data.items.some((blog: JsonObject) => String(blog.id) === c.blogId)) throw new ConnectorError('Blogger 没有找到该用户可访问的目标 Blog ID。');
      return { ok: true, message: 'Blogger 用户及目标博客通过只读检查，没有创建文章；写入需要 blogger OAuth 权限。' };
    }
    const endpoints: Record<string, { url: string; headers?: Record<string, string> }> = {
      x: { url: 'https://api.x.com/2/users/me', headers: bearer(c.accessToken) },
      reddit: { url: 'https://oauth.reddit.com/api/v1/me', headers: { ...bearer(c.accessToken), 'User-Agent': c.userAgent } },
      mastodon: { url: `${base(c)}/api/v1/accounts/verify_credentials`, headers: bearer(c.accessToken) },
      telegram: { url: `https://api.telegram.org/bot${c.botToken}/getMe` },
      discord: { url: c.webhookUrl },
      devto: { url: 'https://dev.to/api/users/me', headers: { 'api-key': c.apiKey } },
      wordpress: { url: `${wpBase(c)}/users/me?context=edit`, headers: wpAuth(c) },
    };
    const endpoint = endpoints[platform.id];
    if (!endpoint) throw new ConnectorError('没有该连接器的只读测试。');
    const data = object(await request(endpoint.url, { headers: endpoint.headers }));
    if (platform.id === 'telegram' ? data.ok !== true || !data.result?.id : platform.id === 'x' ? !data.data?.id : !data.id) throw new ConnectorError('服务没有确认有效账号或 Webhook。');
    return { ok: true, message: '凭据及只读账号检查成功，没有发送内容。' };
  } catch (error) { return { ok: false, message: error instanceof ConnectorError ? error.message : '连接检查失败。' }; }
}

async function publishPostiz(connection: ConnectionPrivate, platform: Platform, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  const c = connection.config;
  const headers = { Authorization: c.apiKey };
  const image: { id: string; path: string }[] = [];
  for (const item of media) {
    const form = new FormData(); form.append('file', await mediaBlob(item, context), item.name);
    const uploaded = object(await request(`${base(c)}/upload`, { method: 'POST', headers, body: form }, { signal: context.signal }));
    if (!stringId(uploaded.id) || !safeLink(uploaded.path)) throw new ConnectorError('Postiz 没有确认素材上传。');
    image.push({ id: String(uploaded.id), path: uploaded.path });
  }
  const values = threadTexts(variant).map((text, index) => ({ content: text, image: index === 0 ? image : [] }));
  const defaults = platform.id === 'x' ? { who_can_reply_post: 'everyone' } : platform.category === 'article' || platform.id === 'youtube' ? { title: variant.title } : {};
  const payload = { type: c.postType || 'now', date: new Date().toISOString(), shortLink: false, tags: [], posts: [{ integration: { id: c.integrationId }, value: values, settings: { ...defaults, ...settings(c), __type: platform.postizId } }] };
  const reply = await request(`${base(c)}/posts`, jsonRequest(payload, headers), { publishes: true, signal: context.signal });
  const rows = Array.isArray(reply.json) ? reply.json : [];
  const id = stringId(rows.find(r => r.integration === c.integrationId)?.postId ?? rows[0]?.postId);
  if (c.postType === 'draft' && id && reply.status !== 202) return { status: 'drafted', remoteId: id, message: '已保存 Postiz 草稿；尚未在目标网站发布。' };
  return pending('Postiz 已接收发布任务，等待远端 PUBLISHED 状态及发布凭据确认。', id);
}

/** Postiz's public API lists posts rather than exposing a documented GET /posts/:id. */
export async function checkPublication(connection: ConnectionPrivate, platform: Platform, remoteId: string): Promise<PublishResult | null> {
  if (connection.connector !== 'postiz' || !remoteId) return null;
  requireConnection(connection, platform);
  const query = new URLSearchParams({ startDate: new Date(Date.now() - 31 * 86_400_000).toISOString(), endDate: new Date(Date.now() + 86_400_000).toISOString() });
  const c = connection.config;
  const data = object(await request(`${base(c)}/posts?${query}`, { headers: { Authorization: c.apiKey } }));
  if (!Array.isArray(data.posts)) return null;
  const post = data.posts.find((p: JsonObject) => p.id === remoteId && p.integration?.id === c.integrationId);
  if (!post) return null;
  if (post.state === 'ERROR') throw new ConnectorError('Postiz 远端任务已明确失败，请检查 Postiz 的失败详情。', { terminalFailure: true });
  if (post.state === 'DRAFT') return { status: 'drafted', remoteId, message: '已核对 Postiz 草稿状态，尚未发布。' };
  if (post.state !== 'PUBLISHED') return null;
  const result = exactProof('published', 'Postiz 已确认目标平台发布完成。', post.releaseId, post.releaseURL);
  return result.status === 'published' ? { ...result, remoteId } : null;
}

async function publishX(c: Record<string, string>, platform: Platform, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 4, 'X');
  const texts = threadTexts(variant);
  for (const text of texts) if (countFor(platform, text) > 280) throw new ConnectorError('X 当前内容超过 280 加权字符，需先编辑。');
  const mediaIds: string[] = [];
  for (const item of media) {
    const form = new FormData(); form.append('media', await mediaBlob(item, context), item.name); form.append('media_category', 'tweet_image');
    const data = object(await request('https://api.x.com/2/media/upload', { method: 'POST', headers: bearer(c.accessToken), body: form }, { signal: context.signal }));
    const id = stringId(data.data?.id); if (!id) throw new ConnectorError('X 没有确认图片上传。'); mediaIds.push(id);
  }
  let parent: string | undefined; let first: string | undefined;
  for (const [index, text] of texts.entries()) {
    try {
      const data = outcomeObject(await request('https://api.x.com/2/tweets', jsonRequest({ text, ...(index === 0 && mediaIds.length ? { media: { media_ids: mediaIds } } : {}), ...(parent ? { reply: { in_reply_to_tweet_id: parent } } : {}) }, bearer(c.accessToken)), { publishes: true, signal: context.signal }));
      const id = stringId(data.data?.id);
      if (!id) return pending(first ? 'X 线程已部分发布，但后续消息回执不完整，请核对完整线程。' : undefined, first);
      parent = id; first ??= id;
    } catch (error) {
      if (first) throw new ConnectorError('X 线程已部分发布，后续请求失败；请先核对，不能自动重发完整线程。', { uncertain: true });
      throw error;
    }
  }
  return exactProof('published', 'X 已返回完整线程的帖子 ID。', first, first ? `https://x.com/i/web/status/${first}` : undefined);
}

async function publishReddit(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  noMedia(media, 'Reddit');
  if (!variant.title.trim()) throw new ConnectorError('Reddit 帖子需要标题。');
  textLimit(variant.title, 300, 'Reddit 标题');
  const form = new URLSearchParams({ api_type: 'json', kind: 'self', sr: c.subreddit.replace(/^r\//, ''), title: variant.title, text: variant.body, sendreplies: 'true', ...(c.flairId ? { flair_id: c.flairId } : {}) });
  const data = outcomeObject(await request('https://oauth.reddit.com/api/submit', { method: 'POST', headers: { ...bearer(c.accessToken), 'User-Agent': c.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }, { publishes: true, signal: context.signal }));
  if (Array.isArray(data.json?.errors) && data.json.errors.length) throw new ConnectorError('Reddit 拒绝提交，请检查标题、权限、版块规则或 Flair 设置。');
  return exactProof('published', 'Reddit 已返回帖子回执。', data.json?.data?.name ?? data.json?.data?.id, data.json?.data?.url);
}

async function publishMastodon(connection: ConnectionPrivate, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  const c = connection.config;
  const videos = media.filter(m => m.mime.startsWith('video/'));
  if (media.some(m => !m.mime.startsWith('image/') && !m.mime.startsWith('video/')) || videos.length && media.length !== 1 || media.length > 4) throw new ConnectorError('Mastodon 支持最多 4 张图片或单个视频，请调整素材。');
  const mediaIds: string[] = [];
  for (const item of media) {
    const form = new FormData(); form.append('file', await mediaBlob(item, context), item.name); form.append('description', item.name);
    let data = object(await request(`${base(c)}/api/v2/media`, { method: 'POST', headers: bearer(c.accessToken), body: form }, { signal: context.signal }));
    const id = stringId(data.id); if (!id) throw new ConnectorError('Mastodon 没有确认素材上传。');
    // A 202 upload can have a null URL; never attach a processing media item.
    for (let attempt = 0; !data.url && attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 750));
      data = object(await request(`${base(c)}/api/v1/media/${encodeURIComponent(id)}`, { headers: bearer(c.accessToken) }, { signal: context.signal }));
    }
    if (!data.url) throw new ConnectorError('Mastodon 素材仍在处理中，未创建帖子；稍后再提交。', { retryable: true });
    mediaIds.push(id);
  }
  const key = createHash('sha256').update(`${connection.id}:${variant.id}:${variant.updatedAt}`).digest('hex');
  const data = outcomeObject(await request(`${base(c)}/api/v1/statuses`, jsonRequest({ status: variant.body, media_ids: mediaIds, visibility: c.visibility || 'public' }, { ...bearer(c.accessToken), 'Idempotency-Key': key }), { publishes: true, signal: context.signal }));
  if ('scheduled_at' in data) return pending('Mastodon 返回预约对象，尚未确认帖子发布。', stringId(data.id));
  return exactProof('published', 'Mastodon 已返回状态回执。', data.id, data.url);
}

async function publishBluesky(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 4, 'Bluesky'); textLimit(variant.body, 300, 'Bluesky', true);
  if (media.some(m => m.size > 2_000_000)) throw new ConnectorError('Bluesky 图片每张不能超过 2 MB。');
  const session = await bskySession(c); const headers = bearer(session.accessJwt); const images: JsonObject[] = [];
  for (const item of media) {
    const blob = await mediaBlob(item, context); if (blob.size > 2_000_000) throw new ConnectorError('Bluesky 图片每张不能超过 2 MB。');
    const data = object(await request(`${base(c, 'https://bsky.social')}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...headers, 'Content-Type': item.mime }, body: blob }, { signal: context.signal }));
    if (!data.blob?.ref || !data.blob?.mimeType) throw new ConnectorError('Bluesky 没有确认图片 blob。');
    images.push({ alt: item.name, image: data.blob });
  }
  const record = { $type: 'app.bsky.feed.post', text: variant.body, createdAt: new Date().toISOString(), ...(images.length ? { embed: { $type: 'app.bsky.embed.images', images } } : {}) };
  const data = outcomeObject(await request(`${base(c, 'https://bsky.social')}/xrpc/com.atproto.repo.createRecord`, jsonRequest({ repo: session.did, collection: 'app.bsky.feed.post', record }, headers), { publishes: true, signal: context.signal }));
  if (!data.cid || typeof data.uri !== 'string' || !/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/.test(data.uri)) return pending();
  const parts = data.uri.slice(5).split('/');
  return { status: 'published', message: 'Bluesky 已返回帖子的 URI 与 CID。', remoteId: data.uri, url: `https://bsky.app/profile/${encodeURIComponent(parts[0])}/post/${encodeURIComponent(parts[2])}` };
}

async function publishTelegram(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  if (media.length > 10 || media.some(m => !m.mime.startsWith('image/') && !m.mime.startsWith('video/'))) throw new ConnectorError('Telegram 支持最多 10 个图片/视频素材。');
  textLimit(variant.body, media.length ? 1024 : 4096, 'Telegram');
  const endpoint = `https://api.telegram.org/bot${c.botToken}`;
  let init: RequestInit; let method: string;
  if (!media.length) { method = 'sendMessage'; init = jsonRequest({ chat_id: c.chatId, text: variant.body }); }
  else {
    const form = new FormData(); form.append('chat_id', c.chatId);
    if (media.length === 1) {
      const item = media[0]; const kind = item.mime.startsWith('video/') ? 'video' : 'photo'; method = kind === 'video' ? 'sendVideo' : 'sendPhoto';
      form.append(kind, await mediaBlob(item, context), item.name); form.append('caption', variant.body);
    } else {
      method = 'sendMediaGroup'; const items: JsonObject[] = [];
      for (const [i, item] of media.entries()) {
        form.append(`media${i}`, await mediaBlob(item, context), item.name);
        items.push({ type: item.mime.startsWith('video/') ? 'video' : 'photo', media: `attach://media${i}`, ...(i === 0 ? { caption: variant.body } : {}) });
      }
      form.append('media', JSON.stringify(items));
    }
    init = { method: 'POST', body: form };
  }
  const data = outcomeObject(await request(`${endpoint}/${method}`, init, { publishes: true, signal: context.signal }));
  if (data.ok === false) throw new ConnectorError('Telegram 拒绝发送，请检查机器人权限、Chat ID 和内容限制。');
  const messages = Array.isArray(data.result) ? data.result : [data.result];
  if (data.ok !== true || messages.length !== Math.max(1, media.length) && media.length > 1 || messages.some(m => !stringId(m?.message_id) || !stringId(m?.chat?.id))) return pending();
  const message = messages[0];
  return { status: 'published', message: 'Telegram 已返回消息回执。', remoteId: `${message.chat.id}:${message.message_id}`, ...(message.chat.username ? { url: `https://t.me/${message.chat.username}/${message.message_id}` } : {}) };
}

async function publishDiscord(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  textLimit(variant.body, 2000, 'Discord'); if (media.length > 10) throw new ConnectorError('Discord 每条消息最多 10 个附件。');
  const url = new URL(c.webhookUrl); url.searchParams.set('wait', 'true');
  const payload: JsonObject = { content: variant.body, allowed_mentions: { parse: [] } };
  let init: RequestInit;
  if (media.length) {
    const form = new FormData(); payload.attachments = media.map((m, index) => ({ id: index, filename: m.name })); form.append('payload_json', JSON.stringify(payload));
    for (const [i, item] of media.entries()) form.append(`files[${i}]`, await mediaBlob(item, context), item.name);
    init = { method: 'POST', body: form };
  } else init = jsonRequest(payload);
  const data = outcomeObject(await request(url.toString(), init, { publishes: true, signal: context.signal }));
  const guild = stringId(data.guild_id) ?? stringId(c.guildId);
  return exactProof('published', 'Discord 已返回消息 ID。', data.id, guild && data.channel_id && data.id ? `https://discord.com/channels/${guild}/${data.channel_id}/${data.id}` : undefined);
}

async function publishSlack(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  noMedia(media, 'Slack');
  const reply = await request(c.webhookUrl, jsonRequest({ text: variant.body }), { publishes: true, signal: context.signal });
  return reply.text.trim() === 'ok' && reply.status === 200 ? { status: 'published', message: 'Slack Incoming Webhook 已明确返回 ok；此 API 不返回消息 ID。' } : pending('Slack 没有返回明确的 ok，需在频道核对。');
}

async function publishDevto(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 20, 'DEV');
  if (!variant.title.trim()) throw new ConnectorError('DEV 文章需要标题。');
  const urls = media.map(m => publicUrl(m, context, true));
  const shouldPublish = c.postType === 'publish';
  const body = variant.body + urls.map((url, index) => `\n\n![${media[index].name.replace(/[\[\]\\]/g, '')}](${url})`).join('');
  const data = outcomeObject(await request('https://dev.to/api/articles', jsonRequest({ article: { title: variant.title, body_markdown: body, published: shouldPublish, tags: variant.tags.slice(0, 4).map(t => t.replace(/^#/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()).filter(Boolean), ...(urls[0] ? { main_image: urls[0] } : {}) } }, { 'api-key': c.apiKey }), { publishes: true, signal: context.signal }));
  if (!stringId(data.id)) return pending();
  if (!shouldPublish && !data.published_at && data.published !== true) return exactProof('drafted', 'DEV 已保存文章草稿。', data.id, data.url);
  return data.published_at || data.published === true ? exactProof('published', 'DEV 已返回公开文章回执。', data.id, data.url) : pending('DEV 已返回文章 ID，但未确认公开发布。', stringId(data.id));
}

async function publishWordpress(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  if (media.some(m => !m.mime.startsWith('image/') && !m.mime.startsWith('video/'))) throw new ConnectorError('WordPress 此连接器只处理图片和视频素材。');
  if (!variant.title.trim()) throw new ConnectorError('WordPress 文章需要标题。');
  let html = bodyHtml(variant); let featured: string | undefined;
  for (const item of media) {
    const blob = await mediaBlob(item, context); const filename = item.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'media';
    const data = object(await request(`${wpBase(c)}/media`, { method: 'POST', headers: { ...wpAuth(c), 'Content-Type': item.mime, 'Content-Disposition': `attachment; filename="${filename}"` }, body: blob }, { signal: context.signal }));
    const id = stringId(data.id); const url = safeLink(data.source_url); if (!id || !url) throw new ConnectorError('WordPress 没有确认素材上传。');
    if (item.mime.startsWith('image/')) { featured ??= id; html += `\n<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(item.name)}"></figure>`; }
    else html += `\n<video controls src="${escapeHtml(url)}"></video>`;
  }
  const data = outcomeObject(await request(`${wpBase(c)}/posts`, jsonRequest({ title: variant.title, content: html, status: c.postType === 'publish' ? 'publish' : 'draft', ...(featured ? { featured_media: Number(featured) } : {}) }, wpAuth(c)), { publishes: true, signal: context.signal }));
  if (data.status === 'publish') return exactProof('published', 'WordPress 已确认文章发布。', data.id, data.link);
  if (data.status === 'draft') return exactProof('drafted', 'WordPress 已保存文章草稿。', data.id, data.link);
  return pending('WordPress 已接收文章，但尚未确认发布或草稿状态。', stringId(data.id));
}

async function publishGhost(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 20, 'Ghost');
  if (!variant.title.trim()) throw new ConnectorError('Ghost 文章需要标题。');
  let html = bodyHtml(variant); let featured: string | undefined;
  for (const item of media) {
    const form = new FormData(); form.append('file', await mediaBlob(item, context), item.name); form.append('purpose', 'image');
    const data = outcomeObject(await request(`${ghostBase(c)}/images/upload/`, { method: 'POST', headers: ghostAuth(c), body: form }, { signal: context.signal }));
    const url = safeLink(data.images?.[0]?.url); if (!url) throw new ConnectorError('Ghost 没有确认图片上传，尚未创建文章。');
    featured ??= url; html += `\n<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(item.name)}"></figure>`;
  }
  const post = { title: variant.title, html, status: c.postType === 'publish' ? 'published' : 'draft', tags: variant.tags.map(name => ({ name })), ...(featured ? { feature_image: featured } : {}) };
  const data = outcomeObject(await request(`${ghostBase(c)}/posts/?source=html`, jsonRequest({ posts: [post] }, ghostAuth(c)), { publishes: true, signal: context.signal }));
  const result = data.posts?.[0];
  if (result?.status === 'published') return exactProof('published', 'Ghost 已确认文章发布，没有发送 Newsletter。', result.id, result.url);
  if (result?.status === 'draft') return exactProof('drafted', 'Ghost 已保存文章草稿。', result.id, result.url);
  return pending('Ghost 未返回明确的文章发布/草稿状态，请在后台核对。', stringId(result?.id));
}

async function publishHashnode(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 20, 'Hashnode');
  if (!variant.title.trim()) throw new ConnectorError('Hashnode 文章需要标题。');
  if (media.some(m => m.size > 8 * 1024 * 1024 || m.mime === 'image/svg+xml')) throw new ConnectorError('Hashnode 图片最多 8 MB，不能使用 SVG。');
  const urls: string[] = [];
  for (const item of media) {
    const blob = await mediaBlob(item, context); if (blob.size > 8 * 1024 * 1024) throw new ConnectorError('Hashnode 图片最多 8 MB。');
    const signed = await hashnodeRequest(c, 'mutation CreatorImageUpload($input: CreateImageUploadInput!) { createImageUploadURL(input: $input) { presignedPut { url cdnUrl key } } }', { input: { contentType: item.mime } }, { signal: context.signal });
    const put = signed.createImageUploadURL?.presignedPut;
    const uploadUrl = safeLink(put?.url); if (!uploadUrl || !uploadUrl.startsWith('https://') || !stringId(put?.key)) throw new ConnectorError('Hashnode 没有返回有效 HTTPS 图片上传地址。');
    // Presigned storage receives image bytes only, never the Hashnode PAT.
    await request(uploadUrl, { method: 'PUT', headers: { 'Content-Type': item.mime }, body: blob }, { signal: context.signal });
    const confirmed = await hashnodeRequest(c, 'mutation CreatorConfirmImage($input: ConfirmImageUploadInput!) { confirmImageUpload(input: $input) { ok cdnUrl } }', { input: { key: put.key } }, { signal: context.signal });
    const url = safeLink(confirmed.confirmImageUpload?.cdnUrl ?? put.cdnUrl);
    if (confirmed.confirmImageUpload?.ok !== true || !url) throw new ConnectorError('Hashnode 没有确认图片上传，尚未创建文章。');
    urls.push(url);
  }
  const publishNow = c.postType === 'publish';
  const markdown = variant.body + urls.map((url, i) => `\n\n![${media[i].name.replace(/[\[\]\\]/g, '')}](${url})`).join('');
  const tags = variant.tags.map(tag => tag.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')).filter(Boolean).slice(0, 15).map(slug => ({ slug }));
  const input = { publicationId: c.publicationId, title: variant.title, contentMarkdown: markdown, ...(tags.length ? { tags } : {}), ...(urls[0] ? publishNow ? { coverImage: urls[0] } : { coverImageOptions: { coverImageURL: urls[0] } } : {}) };
  const query = publishNow
    ? 'mutation CreatorPublish($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }'
    : 'mutation CreatorDraft($input: CreateDraftInput!) { createDraft(input: $input) { draft { id } } }';
  const data = await hashnodeRequest(c, query, { input }, { publishes: true, signal: context.signal });
  const item = publishNow ? data.publishPost?.post : data.createDraft?.draft;
  return exactProof(publishNow ? 'published' : 'drafted', publishNow ? 'Hashnode publishPost 已返回文章回执。' : 'Hashnode createDraft 已返回草稿 ID，尚未发布。', item?.id, item?.url);
}

async function publishMisskey(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  if (media.length > 16) throw new ConnectorError('Misskey 每条 Note 最多 16 个附件。');
  if (!variant.body.trim() && !media.length) throw new ConnectorError('Misskey Note 需要正文或附件。');
  const files: string[] = [];
  for (const item of media) {
    const form = new FormData(); form.append('i', c.accessToken); form.append('file', await mediaBlob(item, context), item.name); form.append('name', item.name);
    const data = outcomeObject(await request(`${base(c)}/api/drive/files/create`, { method: 'POST', body: form }, { signal: context.signal }));
    if (data.error || !stringId(data.id)) throw new ConnectorError('Misskey 没有确认 Drive 附件上传，尚未创建 Note。');
    files.push(String(data.id));
  }
  const data = outcomeObject(await request(`${base(c)}/api/notes/create`, jsonRequest({ i: c.accessToken, text: variant.body || null, visibility: c.visibility || 'public', ...(c.cw ? { cw: c.cw } : {}), ...(files.length ? { fileIds: files } : {}) }), { publishes: true, signal: context.signal }));
  if (data.error) throw new ConnectorError('Misskey 明确拒绝创建 Note，请检查权限、文字/附件限制和实例规则。');
  return exactProof('published', 'Misskey 已返回创建的 Note ID。', data.createdNote?.id, data.createdNote?.uri);
}

async function publishLemmy(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 20, 'Lemmy');
  if (!variant.title.trim()) throw new ConnectorError('Lemmy 帖子需要标题。');
  const urls = media.map(m => publicUrl(m, context, true));
  const body = variant.body + urls.map((url, i) => `\n\n![${media[i].name.replace(/[\[\]\\]/g, '')}](${url})`).join('');
  const data = outcomeObject(await request(`${lemmyBase(c)}/post`, jsonRequest({ name: variant.title, body, community_id: Number(c.communityId) }, bearer(c.accessToken)), { publishes: true, signal: context.signal }));
  if (data.error) throw new ConnectorError('Lemmy 明确拒绝创建帖子，请检查社区 ID、JWT 和社区规则。');
  const post = data.post_view?.post;
  if (post?.federation_pending === true || post?.scheduled_publish_time != null || post?.scheduled_publish_time_at != null || post?.removed === true || post?.deleted === true) return pending('Lemmy 帖子尚未确认可见，可能等待联邦或排期，需在实例中核对。', stringId(post?.id));
  // post.url points to the linked article; only ap_id is a post permalink.
  return exactProof('published', 'Lemmy 已返回创建的帖子回执。', post?.id, post?.ap_id);
}

async function publishBlogger(c: Record<string, string>, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  imageOnly(media, 20, 'Blogger');
  if (!variant.title.trim()) throw new ConnectorError('Blogger 文章需要标题。');
  const urls = media.map(m => publicUrl(m, context, true));
  const html = bodyHtml(variant) + urls.map((url, i) => `\n<p><img src="${escapeHtml(url)}" alt="${escapeHtml(media[i].name)}"></p>`).join('');
  const draft = c.postType !== 'publish';
  const url = `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(c.blogId)}/posts?isDraft=${draft}&fields=id,status,url,blog(id)`;
  const data = outcomeObject(await request(url, jsonRequest({ kind: 'blogger#post', title: variant.title, content: html, labels: variant.tags }, bearer(c.accessToken)), { publishes: true, signal: context.signal }));
  if (data.blog?.id && String(data.blog.id) !== c.blogId) return pending('Blogger 回执的 Blog ID 与目标不一致，请核对远端。', stringId(data.id));
  if (data.status === 'LIVE') return exactProof('published', 'Blogger 已确认文章为 LIVE。', data.id, data.url);
  if (data.status === 'DRAFT') return exactProof('drafted', 'Blogger 已确认文章为 DRAFT。', data.id, data.url);
  return { ...pending('Blogger 未返回明确 LIVE/DRAFT 状态，请在后台核对。', stringId(data.id)), url: safePublicationLink(data.url) };
}

export async function publish(connection: ConnectionPrivate, platform: Platform, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  requireConnection(connection, platform);
  if (!connection.enabled) throw new ConnectorError('连接已停用。');
  if (variant.platformId !== platform.id) throw new ConnectorError('内容版本与平台不匹配。');
  const c = connection.config;
  if (connection.connector === 'native' && isEnterprisePlatform(platform.id)) return publishEnterprise(connection, platform, variant, media, context);
  if (connection.connector === 'multipost') return { status: 'needs_action', message: '请在前台发布队列发送到 MultiPost 扩展，并在目标网站完成核对。' };
  if (connection.connector === 'postiz') return publishPostiz(connection, platform, variant, media, context);
  if (connection.connector === 'xiaohongshu') {
    let endpoint='publish';let payload:JsonObject;
    if(c.format==='video'){
      if(media.length!==1||media[0].mime!=='video/mp4')throw new ConnectorError('小红书视频需单个已上传的 MP4，不支持同时附带图片或其他素材。');
      const path=context.localMediaPath?.(media[0]);if(!path||!isAbsolute(path))throw new ConnectorError('无法取得视频的本机路径，请通过工作台上传素材并使用同机服务。');
      endpoint='publish_video';payload={title:variant.title,content:variant.body,video:path,tags:variant.tags};
    }else{
      imageOnly(media,18,'小红书');if(!media.length)throw new ConnectorError('小红书图文至少需要一张图片；视频请在连接中选择 video 并上传单个 MP4。');
      payload={title:variant.title,content:variant.body,images:media.map(m=>publicUrl(m,context)),tags:variant.tags};
    }
    const data = object(await request(`${base(c)}/api/v1/${endpoint}`, jsonRequest(payload,bearer(c.apiKey)), { publishes: true, signal: context.signal, timeout: c.format==='video'?300_000:120_000 }));
    if (data.success === false) throw new ConnectorError('小红书服务拒绝发布，请检查登录状态、素材和服务日志。');
    return pending(data.success === true ? `小红书服务回报“${data.data?.status === '发布完成' ? '发布完成' : '请求成功'}”，但没有可核对的帖子 ID 或链接，请在小红书确认结果。` : undefined);
  }
  if (connection.connector === 'wechatsync') {
    imageOnly(media, 20, 'Wechatsync');
    const urls = media.map(m => publicUrl(m, context));
    const html = bodyHtml(variant) + urls.map((url, i) => `\n<p><img src="${escapeHtml(url)}" alt="${escapeHtml(media[i].name)}"></p>`).join('');
    const markdown = variant.body + urls.map((url, i) => `\n\n![${media[i].name.replace(/[\[\]\\]/g, '')}](${url})`).join('');
    const data = outcomeObject(await request(`${base(c)}/request`, jsonRequest({ method: 'syncArticle', params: { platforms: [platform.wechatsyncId], article: { title: variant.title, content: html, markdown, ...(urls[0] ? { cover: urls[0] } : {}) } } }), { publishes: true, signal: context.signal, timeout: 120_000 }));
    const result = Array.isArray(data.result?.results) ? data.result.results.find((r: JsonObject) => r.platform === platform.wechatsyncId) : undefined;
    if (result?.success === false) throw new ConnectorError('Wechatsync 明确回报目标平台同步失败，请检查登录状态和扩展。');
    if (result?.success === true && result.draftOnly === true) return exactProof('drafted', 'Wechatsync 回报草稿已保存，尚未公开发布；含会话凭据的链接不会保存，请到目标后台核对。', result.postId, result.postUrl);
    return pending('Wechatsync 已接收内容，但没有明确可核对的草稿结果；请在目标平台确认。', stringId(result?.postId));
  }
  if (connection.connector === 'webhook') {
    const data = await request(c.url, jsonRequest({ platformId: platform.id, variant: { title: variant.title, body: variant.body, tags: variant.tags, thread: variant.thread, html: variant.html }, media: media.map(m => ({ name: m.name, mime: m.mime, url: publicUrl(m, context) })) }, bearer(c.apiKey)), { publishes: true, signal: context.signal });
    const result = object(data);
    if (result.status === 'failed') throw new ConnectorError('Webhook 接收器明确回报发布失败。');
    if (data.status !== 202 && ['published', 'drafted'].includes(result.status)) return exactProof(result.status, result.status === 'published' ? 'Webhook 已明确确认发布结果。' : 'Webhook 已明确确认草稿结果。', result.remoteId, result.url);
    return pending('Webhook 已接收请求，但未返回明确状态和远端发布凭据。', stringId(result.remoteId));
  }
  switch (platform.id) {
    case 'x': return publishX(c, platform, variant, media, context);
    case 'reddit': return publishReddit(c, variant, media, context);
    case 'mastodon': return publishMastodon(connection, variant, media, context);
    case 'bluesky': return publishBluesky(c, variant, media, context);
    case 'telegram': return publishTelegram(c, variant, media, context);
    case 'discord': return publishDiscord(c, variant, media, context);
    case 'slack': return publishSlack(c, variant, media, context);
    case 'devto': return publishDevto(c, variant, media, context);
    case 'wordpress': return publishWordpress(c, variant, media, context);
    case 'ghost': return publishGhost(c, variant, media, context);
    case 'hashnode': return publishHashnode(c, variant, media, context);
    case 'misskey': return publishMisskey(c, variant, media, context);
    case 'lemmy': return publishLemmy(c, variant, media, context);
    case 'blogger': return publishBlogger(c, variant, media, context);
    default: throw new ConnectorError('尚未实现该平台的原生发布，请配置桥接服务。');
  }
}
