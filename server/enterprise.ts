import { createHmac } from 'node:crypto';
import type { ConnectionPrivate, ConnectorDefinition, Media, Platform, PublishContext, PublishResult, Variant } from './types.js';

/** Official sources checked on 2026-10-03. No credentials or live messages were used. */
export const ENTERPRISE_SOURCES = {
  feishu: ['https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot'],
  dingtalk: [
    'https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages',
    'https://open.dingtalk.com/document/orgapp/custom-bot-send-message-type',
    'https://open.dingtalk.com/document/orgapp/customize-robot-security-settings',
  ],
  wecom: ['https://developer.work.weixin.qq.com/document/path/91770'],
  teams: [
    'https://learn.microsoft.com/en-us/connectors/teams/#when-a-teams-webhook-request-is-received',
    'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
    'https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot',
    'https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/',
  ],
} as const;

type EnterpriseId = keyof typeof ENTERPRISE_SOURCES;
const ids = new Set<string>(Object.keys(ENTERPRISE_SOURCES));
export function isEnterprisePlatform(id: string): id is EnterpriseId { return ids.has(id); }

export class EnterpriseConnectorError extends Error {
  constructor(message: string, public readonly uncertain = false) {
    super(message);
    this.name = 'EnterpriseConnectorError';
  }
}

const webhookField = { key: 'webhookUrl', label: 'Webhook 地址', required: true, secret: true, help: '地址包含密钥；在平台内创建群机器人或 Teams Workflow 后复制完整 HTTPS 地址。' };
const signingField = { key: 'secret', label: '加签密钥（可选）', secret: true, help: '机器人启用签名验证时必须填写；留空适用于关键词或 IP 白名单等其他安全设置。' };
const formatField = { key: 'format', label: '消息格式', placeholder: 'text', help: 'text 或 markdown，默认 text。Markdown 只支持平台规定的语法子集；不会自动上传素材。' };
const definitions: ConnectorDefinition[] = [
  { id: 'native:feishu', name: '飞书群机器人', platformIds: ['feishu'], mode: 'publish', fields: [webhookField, signingField], description: '发送文本；完整 JSON 请求体最多 20 KB，支持可选签名。code=0 确认发送；不返回消息 ID。连接检查只验证格式，不验证密钥、不发送消息。' },
  { id: 'native:dingtalk', name: '钉钉群机器人', platformIds: ['dingtalk'], mode: 'publish', fields: [webhookField, signingField, formatField], description: '发送文本或 Markdown 子集，支持可选加签；本应用限制完整 JSON 请求体 20 KB（官方所查页面未明确文本硬上限）。errcode=0 确认发送；每个机器人官方限 20 条/分钟。连接检查仅验证格式。' },
  { id: 'native:wecom', name: '企业微信群机器人', platformIds: ['wecom'], mode: 'publish', fields: [webhookField, formatField], description: '发送文本（2048 UTF-8 字节）或 Markdown 子集（4096 UTF-8 字节）；errcode=0 确认发送。暂不上传文件或图片。连接检查仅验证格式，不验证密钥、不发送消息。' },
  { id: 'native:teams', name: 'Microsoft Teams Workflows', platformIds: ['teams'], mode: 'publish', fields: [{ ...webhookField, help: '使用 When a Teams webhook request is received 触发器，认证方式选 Anyone，并配置发送 Adaptive Card 到目标频道的动作；复制当前完整触发器 URL。旧 Office 365 Connector 已停用。' }], description: '发送包含正文的 Adaptive Card（本应用 JSON 上限 28 KB）；只支持 Anyone 触发器，不发送认证头。2xx 仅确认工作流受理，结果待人工确认。连接检查仅验证格式，不触发工作流。' },
];

export function getEnterpriseDefinitions(platforms: Platform[]): ConnectorDefinition[] {
  const available = new Set(platforms.map(p => p.id));
  return definitions.filter(d => d.platformIds.some(id => available.has(id)));
}

function validWebhook(id: EnterpriseId, raw: string, secret: string): string | undefined {
  let url: URL;
  try { url = new URL(raw); }
  catch { return 'Webhook 地址格式错误；请复制平台生成的完整 HTTPS 地址。'; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return 'Webhook 必须是平台的 HTTPS 地址，且不能含登录信息、片段或非标准端口。';
  const oneToken = (key: string) => url.searchParams.getAll(key).length === 1 && Boolean(url.searchParams.get(key)?.trim()) && !/\s/.test(url.searchParams.get(key) ?? '');
  if (id === 'feishu') {
    if (url.hostname !== 'open.feishu.cn' || !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search) return '请使用飞书自定义机器人生成的 open.feishu.cn/open-apis/bot/v2/hook/ 地址。';
  } else if (id === 'dingtalk') {
    if (url.hostname !== 'oapi.dingtalk.com' || url.pathname !== '/robot/send' || !oneToken('access_token')) return '请使用钉钉自定义机器人生成的 oapi.dingtalk.com/robot/send 地址，并保留唯一 access_token 参数。';
    if (!secret && (url.searchParams.has('timestamp') || url.searchParams.has('sign'))) return '不要使用已经加签的临时地址；请复制原始 Webhook 地址，并在加签密钥字段填写 secret。';
  } else if (id === 'wecom') {
    if (url.hostname !== 'qyapi.weixin.qq.com' || url.pathname !== '/cgi-bin/webhook/send' || !oneToken('key')) return '请使用企业微信生成的 qyapi.weixin.qq.com/cgi-bin/webhook/send 地址，并保留唯一 key 参数。';
  } else {
    if (url.hostname === 'outlook.office.com' || url.hostname.endsWith('.webhook.office.com') || url.hostname === 'webhook.office.com') return '旧 Teams Office 365 Connector 已停用；请创建 Teams Workflows 并复制当前触发器地址。';
    const newDomain = url.hostname.endsWith('.environment.api.powerplatform.com');
    const workflowDomain = url.hostname.endsWith('.logic.azure.com');
    const newPath = /^\/powerautomate\/automations\/direct\/(?:cu\/\d+\/)?workflows\/[A-Za-z0-9_-]+\/triggers\/[A-Za-z0-9_-]+\/paths\/invoke$/;
    const workflowPath = /^\/workflows\/[A-Za-z0-9_-]+\/triggers\/[A-Za-z0-9_-]+\/paths\/invoke$/;
    if (!(newDomain && newPath.test(url.pathname) || workflowDomain && workflowPath.test(url.pathname)) || !oneToken('sig')) return '请使用 Microsoft Teams Workflows 的完整 HTTPS 触发器地址（含 sig），认证方式设为 Anyone。';
  }
  return undefined;
}

export function validateEnterprise(connection: ConnectionPrivate, platform: Platform): string[] {
  if (!isEnterprisePlatform(platform.id)) return ['此目标没有企业消息发布接口。'];
  if (connection.platformId !== platform.id || connection.connector !== 'native') return ['连接与企业消息目标或连接器不匹配。'];
  const errors: string[] = [];
  const config = connection.config;
  const webhook = config.webhookUrl?.trim();
  if (!webhook) errors.push('请填写平台生成的 Webhook 地址。');
  else { const error = validWebhook(platform.id, webhook, config.secret?.trim() ?? ''); if (error) errors.push(error); }
  if ((platform.id === 'dingtalk' || platform.id === 'wecom') && config.format && !['text', 'markdown'].includes(config.format.trim())) errors.push('消息格式只能是 text 或 markdown。');
  // Anyone triggers reject Authorization headers. Do not silently ignore supplied tokens.
  if (platform.id === 'teams' && (config.accessToken || config.authToken)) errors.push('本连接器只支持 Anyone 触发器；请移除认证令牌，或为租户认证模式另建专门集成。');
  return errors;
}

export async function testEnterprise(connection: ConnectionPrivate, platform: Platform): Promise<{ ok: boolean; message: string }> {
  const errors = validateEnterprise(connection, platform);
  if (errors.length) return { ok: false, message: errors.join(' ') };
  return { ok: true, message: '仅通过本地配置格式检查；没有发送消息、没有触发工作流，也没有验证密钥、权限或平台可达性。请核对机器人安全设置和当前 Webhook 地址。' };
}

function byteLength(text: string): number { return Buffer.byteLength(text, 'utf8'); }
function checkSize(text: string, limit: number, label: string): void {
  if (byteLength(text) > limit) throw new EnterpriseConnectorError(`${label}超过 ${limit} 个 UTF-8 字节，请缩短后重新审核。`);
}
function unknown(platform: Platform): PublishResult {
  return { status: 'unconfirmed', message: `${platform.name}已返回请求回执，但没有可确认的消息发送结果。请到目标群或工作流运行记录核实后手动确认；不要直接重复发送。` };
}

async function send(url: URL, body: string, platform: Platform, signal?: AbortSignal): Promise<{ status: number; json: unknown }> {
  if (signal?.aborted) throw new EnterpriseConnectorError('请求在发送前已取消。');
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
    text = await response.text();
  } catch {
    // Never echo network error messages: they may contain webhook credentials.
    throw new EnterpriseConnectorError(`${platform.name}请求中断或超时，消息可能已经发送。请核实目标群或工作流记录后再处理。`, true);
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 || response.status === 408;
    throw new EnterpriseConnectorError(`${platform.name}接口返回 HTTP ${response.status}。${uncertain ? '发送结果无法确定，请先核实。' : '请求被拒绝，请检查密钥、权限、消息格式或限流情况。'}`, uncertain);
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, json };
}

export async function publishEnterprise(connection: ConnectionPrivate, platform: Platform, variant: Variant, media: Media[], context: PublishContext): Promise<PublishResult> {
  const errors = validateEnterprise(connection, platform);
  if (errors.length) throw new EnterpriseConnectorError(errors.join(' '));
  if (!connection.enabled) throw new EnterpriseConnectorError('此连接已停用。');
  if (variant.platformId !== platform.id) throw new EnterpriseConnectorError('内容版本与消息目标不匹配。');
  if (media.length) throw new EnterpriseConnectorError('此企业消息连接器暂不上传素材；请移除所附素材或使用其他支持素材的连接器。');
  if (variant.thread.length) throw new EnterpriseConnectorError('企业消息连接器不支持分段线程；请将审核后的内容合并到正文。');
  if (!variant.body.trim()) throw new EnterpriseConnectorError('消息正文不能为空。');
  const id = platform.id as EnterpriseId;
  const url = new URL(connection.config.webhookUrl.trim());
  const format = connection.config.format?.trim() || 'text';
  const secret = connection.config.secret?.trim();
  let payload: Record<string, unknown>;
  if (id === 'feishu') {
    payload = { msg_type: 'text', content: { text: variant.body } };
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      // Feishu signs an EMPTY message with timestamp + newline + secret as its key.
      payload.timestamp = timestamp;
      payload.sign = createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
    }
  } else if (id === 'dingtalk') {
    payload = format === 'markdown'
      ? { msgtype: 'markdown', markdown: { title: variant.title.trim() || '内容更新', text: variant.body }, at: { isAtAll: false } }
      : { msgtype: 'text', text: { content: variant.body }, at: { isAtAll: false } };
    if (secret) {
      const timestamp = String(Date.now());
      // DingTalk instead uses secret as key and timestamp + newline + secret as message.
      const sign = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
      url.searchParams.set('timestamp', timestamp);
      url.searchParams.set('sign', sign); // URLSearchParams handles exactly one URL encoding.
    }
  } else if (id === 'wecom') {
    checkSize(variant.body, format === 'markdown' ? 4096 : 2048, `企业微信 ${format} 正文`);
    payload = format === 'markdown'
      ? { msgtype: 'markdown', markdown: { content: variant.body } }
      : { msgtype: 'text', text: { content: variant.body } };
  } else {
    payload = { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.2', body: [{ type: 'TextBlock', text: variant.body, wrap: true }] } }] };
  }
  const body = JSON.stringify(payload);
  if (id === 'feishu' || id === 'dingtalk') checkSize(body, 20 * 1024, `${platform.name} JSON 请求体`);
  if (id === 'teams') checkSize(body, 28 * 1024, 'Teams JSON 请求体（本应用上限）');
  const result = await send(url, body, platform, context.signal);
  // A Workflow HTTP receipt has no documented channel-message completion proof.
  if (id === 'teams') return unknown(platform);
  const json = result.json;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return unknown(platform);
  const code = (json as Record<string, unknown>)[id === 'feishu' ? 'code' : 'errcode'];
  if (typeof code !== 'number' || !Number.isFinite(code)) return unknown(platform);
  if (code !== 0) throw new EnterpriseConnectorError(`${platform.name}拒绝发送消息（错误码 ${code}）。请检查机器人安全设置、密钥、权限或消息格式。`);
  if (result.status === 202) return unknown(platform);
  return { status: 'published', message: `${platform.name}官方接口确认消息发送成功；该群机器人接口不提供持久消息 ID 或可查询的发布链接。` };
}
