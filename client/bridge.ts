import type { Media, Platform, Variant } from '../server/types.js';

/** MultiPost's public page-message API. A receipt is a browser handoff, not a post. */
type Envelope = {
  type: 'response';
  traceId: string;
  action: string;
  code: number;
  message: string;
  data: unknown;
};

class BridgeError extends Error {
  constructor(message: string, readonly code?: number, readonly uncertain = false) {
    super(message);
    this.name = 'BridgeError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function request(action: string, data: unknown, timeoutMs: number): Promise<unknown> {
  if (typeof window === 'undefined') return Promise.reject(new BridgeError('请在浏览器中使用 MultiPost 扩展。'));
  const browserWindow = window;
  const origin = browserWindow.location.origin;
  if (!/^https?:\/\//.test(origin)) return Promise.reject(new BridgeError('请通过 localhost 页面访问工作台，不能从本地文件直接连接扩展。'));
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 3_000;
  const traceId = globalThis.crypto.randomUUID();

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      browserWindow.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== browserWindow || event.origin !== origin || !record(event.data)) return;
      const response = event.data;
      if (response.type !== 'response' || response.traceId !== traceId || response.action !== action) return;
      if (!Number.isInteger(response.code) || typeof response.message !== 'string' || !('data' in response)) return;
      cleanup();
      const envelope = response as Envelope;
      if (envelope.code === 403) {
        reject(new BridgeError(`请在 MultiPost 扩展设置中将 ${browserWindow.location.hostname} 加入信任域名，然后重试。`, 403));
      } else if (envelope.code !== 0) {
        // A runtime failure can occur after the background worker received the content.
        reject(new BridgeError('MultiPost 没有确认交接结果，内容可能已被接收。请先核对扩展窗口和目标平台，不要重复交接。', envelope.code, true));
      } else if (record(envelope.data) && typeof envelope.data.error === 'string') {
        reject(new BridgeError('MultiPost 扩展返回错误，交接结果未知，内容可能已被接收。请先核对扩展窗口和目标平台，不要重复交接。', undefined, true));
      } else {
        resolve(envelope.data);
      }
    };
    browserWindow.addEventListener('message', onMessage);
    timer = setTimeout(() => {
      cleanup();
      reject(new BridgeError('未收到 MultiPost 扩展响应，交接结果未知，内容可能已被接收。请先核对扩展窗口和目标平台，不要重复交接。', undefined, true));
    }, timeout);
    try {
      browserWindow.postMessage({ type: 'request', traceId, action, data }, origin);
    } catch {
      cleanup();
      reject(new BridgeError('浏览器未能连接 MultiPost 扩展，请重新打开工作台后重试。'));
    }
  });
}

export async function detectMultiPost(timeoutMs = 1_200): Promise<{ installed: boolean; platforms: any[] }> {
  try {
    const status = await request('MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS', {}, timeoutMs);
    if (!record(status) || typeof status.extensionId !== 'string' || !status.extensionId) {
      return { installed: false, platforms: [] };
    }
    try {
      const result = await request('MULTIPOST_EXTENSION_PLATFORMS', {}, timeoutMs);
      return {
        installed: true,
        platforms: record(result) && Array.isArray(result.platforms)
          ? result.platforms.filter((item) => record(item) && typeof item.name === 'string')
          : [],
      };
    } catch {
      // Extension presence and per-platform/login readiness are separate facts.
      return { installed: true, platforms: [] };
    }
  } catch (error) {
    // A 403 is a positive extension response, but it grants no publishing readiness.
    return { installed: error instanceof BridgeError && error.code === 403, platforms: [] };
  }
}

function text(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function bodyHtml(body: string): string {
  // Variant HTML may originate from editable or model text. Never inject it as trusted HTML.
  return body.split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

function file(item: Media) {
  const url = new URL(item.url, window.location.origin);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BridgeError('素材需要可访问的 HTTP(S) 地址，请先上传素材到工作台。');
  }
  return { name: text(item.name), url: url.href, type: item.mime, size: item.size };
}

function payload(platform: Platform, variant: Variant, media: Media[]) {
  const key = platform.multipostId;
  if (!key) throw new BridgeError(`${platform.name} 尚无 MultiPost 适配，请使用其他连接或导出内容。`);
  if (!variant.approved || variant.issues.some((issue) => issue.severity === 'error')) {
    throw new BridgeError('请先修正内容校验问题并审核通过，再交给浏览器扩展。');
  }
  if (variant.platformId !== platform.id) throw new BridgeError('内容版本与目标渠道不匹配。');
  if (variant.thread.length > 1) {
    throw new BridgeError('MultiPost 当前桥接不支持连续发布整条串文。请使用支持串文的连接，或导出后逐条发布。');
  }
  const title = text(variant.title);
  const body = text(variant.body);
  const tags = variant.tags.map((tag) => text(tag).replace(/^#+/, '')).filter(Boolean);
  const images = media.filter((item) => item.mime.startsWith('image/')).map(file);
  const videos = media.filter((item) => item.mime.startsWith('video/')).map(file);
  if (platform.requiredMedia === 'image' && !images.length) throw new BridgeError(`${platform.name} 需要图片素材，请先上传。`);
  if (platform.requiredMedia === 'video' && !videos.length) throw new BridgeError(`${platform.name} 需要视频素材，请先上传。`);
  if (platform.requiredMedia === 'any' && !images.length && !videos.length) throw new BridgeError(`${platform.name} 需要图片或视频素材，请先上传。`);

  let data: Record<string, unknown>;
  if (key.startsWith('ARTICLE_')) {
    if (platform.id === 'wechat' && !images.length) throw new BridgeError('公众号文章需要封面图片，请先上传。');
    data = {
      title,
      digest: body.slice(0, 120),
      ...(images[0] ? { cover: images[0] } : {}),
      htmlContent: bodyHtml(body),
      markdownContent: body,
      images,
      tags,
    };
  } else if (key.startsWith('VIDEO_')) {
    if (!videos.length) throw new BridgeError(`${platform.name} 的视频适配需要视频文件，请先上传。`);
    if (videos.length > 1) throw new BridgeError('视频发布每次只能选择一个视频文件，请调整素材后重试。');
    data = { title, content: body, video: videos[0], ...(images[0] ? { cover: images[0] } : {}), tags };
  } else if (key.startsWith('DYNAMIC_')) {
    if (platform.id === 'xiaohongshu' && !images.length) throw new BridgeError('小红书浏览器桥仅支持图文，需要图片素材。视频请使用同机 MCP REST 的 video 连接，或在创作者后台上传。');
    data = { title, content: body, images, videos, tags };
  } else {
    throw new BridgeError('当前内容类型尚未接入 MultiPost 桥接，请使用导出功能。');
  }

  // Some article adapters consume origin rather than data. Both carry the reviewed version.
  return { platforms: [{ name: key }], isAutoPublish: false, data, origin: data };
}

export async function dispatchMultiPost(
  platform: Platform,
  variant: Variant,
  media: Media[],
  timeoutMs = 5_000,
): Promise<{ dispatched: boolean; outcome: 'dispatched' | 'failed' | 'unconfirmed'; message: string }> {
  let attempted = false;
  try {
    if (typeof window === 'undefined') throw new BridgeError('请在浏览器中使用 MultiPost 扩展。');
    const data = payload(platform, variant, media);
    attempted = true;
    const result = await request('MULTIPOST_EXTENSION_PUBLISH', data, timeoutMs);
    if (!record(result) || result.status !== 'received' || typeof result.extensionId !== 'string' || !result.extensionId) {
      return { dispatched: false, outcome: 'unconfirmed', message: '扩展未确认接收内容，请先核对扩展窗口和目标平台。当前尚未确认发布，请勿重复交接。' };
    }
    return {
      dispatched: true,
      outcome: 'dispatched',
      message: platform.id === 'wechat'
        ? '内容已交给 MultiPost 审阅窗口。公众号适配只同步草稿；请在公众号后台检查，并在队列中确认实际结果。'
        : '内容已交给 MultiPost 审阅窗口。请检查目标平台登录和内容后操作；此回执尚未确认发布，请在队列中记录实际结果。',
    };
  } catch (error) {
    const uncertain = error instanceof BridgeError ? error.uncertain : attempted;
    return { dispatched: false, outcome: uncertain ? 'unconfirmed' : 'failed', message: error instanceof BridgeError ? error.message : uncertain ? 'MultiPost 交接结果未知，请先核对扩展窗口和目标平台，不要重复交接。' : '内容尚未交给 MultiPost，请检查浏览器环境和内容配置。' };
  }
}
