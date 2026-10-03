import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMultiPost, dispatchMultiPost } from '../client/bridge.js';
import type { Media, Platform, Variant } from '../server/types.js';

type Request = { type: string; traceId: string; action: string; data: any };
class FakeWindow {
  location = { origin: 'http://localhost:4317', hostname: 'localhost' };
  listeners = new Set<(event: any) => void>();
  requests: Request[] = [];
  onPost?: (request: Request) => void;
  addEventListener(_type: string, listener: (event: any) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: any) => void) { this.listeners.delete(listener); }
  postMessage(request: Request, targetOrigin: string) {
    assert.equal(targetOrigin, this.location.origin);
    this.requests.push(request);
    this.onPost?.(request);
  }
  emit(request: Request, data: unknown, overrides: Record<string, unknown> = {}) {
    const event = {
      source: this,
      origin: this.location.origin,
      data: { type: 'response', traceId: request.traceId, action: request.action, code: 0, message: 'success', data },
      ...overrides,
    };
    for (const listener of [...this.listeners]) listener(event);
  }
}

async function inBrowser(run: (browser: FakeWindow) => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browser = new FakeWindow();
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  try { await run(browser); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    assert.equal(browser.listeners.size, 0, 'message listeners must be cleaned up');
  }
}

function platform(overrides: Partial<Platform> = {}): Platform {
  return {
    id: 'x', name: 'X', shortName: 'X', region: 'global', category: 'social', color: '#111',
    description: '', titleLimit: 280, bodyLimit: 280, formats: ['text'], recommendedTone: '', notes: [],
    multipostId: 'DYNAMIC_X', ...overrides,
  };
}
function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'v1', contentId: 'c1', platformId: 'x', title: '标题', body: '已审核正文', tags: ['主题'], thread: [],
    source: 'manual', issues: [], approved: true, updatedAt: '2026-10-03T00:00:00+08:00', ...overrides,
  };
}
const image: Media = { id: 'm1', name: 'cover.png', url: '/uploads/cover.png', mime: 'image/png', size: 128 };

test('detects extension and discovers valid registered platform metadata', async () => {
  await inBrowser(async (browser) => {
    browser.onPost = (request) => browser.emit(request, request.action.endsWith('CHECK_SERVICE_STATUS')
      ? { extensionId: 'extension', extensionVersion: '1.0' }
      : { platforms: [{ name: 'DYNAMIC_X' }, null, { invalid: true }] });
    assert.deepEqual(await detectMultiPost(30), { installed: true, platforms: [{ name: 'DYNAMIC_X' }] });
    assert.deepEqual(browser.requests.map((request) => request.action), ['MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS', 'MULTIPOST_EXTENSION_PLATFORMS']);
  });
});

test('filters foreign window, foreign origin, incorrect trace/action and malformed envelopes', async () => {
  await inBrowser(async (browser) => {
    browser.onPost = (request) => {
      const data = { extensionId: 'bad' };
      browser.emit(request, data, { source: {} });
      browser.emit(request, data, { origin: 'https://foreign.example' });
      browser.emit(request, data, { data: { type: 'response', traceId: 'wrong', action: request.action, code: 0, message: 'success', data } });
      browser.emit(request, data, { data: { type: 'response', traceId: request.traceId, action: 'WRONG', code: 0, message: 'success', data } });
      browser.emit(request, data, { data: { type: 'response', traceId: request.traceId, action: request.action, code: '0', message: 'success', data } });
    };
    assert.deepEqual(await detectMultiPost(8), { installed: false, platforms: [] });
  });
});

test('trust rejection detects presence but never claims publishing readiness', async () => {
  await inBrowser(async (browser) => {
    browser.onPost = (request) => browser.emit(request, null, { data: { type: 'response', traceId: request.traceId, action: request.action, code: 403, message: 'Untrusted origin', data: null } });
    assert.deepEqual(await detectMultiPost(20), { installed: true, platforms: [] });
    const result = await dispatchMultiPost(platform(), variant(), [], 20);
    assert.equal(result.dispatched, false);
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /localhost.*信任域名/);
    assert.equal(browser.requests.some((request) => request.action === 'MULTIPOST_EXTENSION_REQUEST_TRUST_DOMAIN'), false);
  });
});

test('dispatch uses the reviewed payload and receipt only means handoff', async () => {
  await inBrowser(async (browser) => {
    browser.onPost = (request) => browser.emit(request, { status: 'received', extensionId: 'extension' });
    const result = await dispatchMultiPost(platform(), variant(), [image], 20);
    assert.equal(result.dispatched, true);
    assert.equal(result.outcome, 'dispatched');
    assert.match(result.message, /尚未确认发布/);
    const request = browser.requests[0];
    assert.equal(request.action, 'MULTIPOST_EXTENSION_PUBLISH');
    assert.equal(request.data.isAutoPublish, false);
    assert.deepEqual(request.data.platforms, [{ name: 'DYNAMIC_X' }]);
    assert.equal(request.data.data.content, '已审核正文');
    assert.deepEqual(request.data.data.images[0], { name: 'cover.png', url: 'http://localhost:4317/uploads/cover.png', type: 'image/png', size: 128 });
    assert.deepEqual(request.data.origin, request.data.data);
  });
});

test('article payload escapes untrusted HTML and preserves text/cover; WeChat is draft only', async () => {
  await inBrowser(async (browser) => {
    browser.onPost = (request) => browser.emit(request, { status: 'received', extensionId: 'extension' });
    const result = await dispatchMultiPost(platform({ id: 'wechat', name: '微信公众号', multipostId: 'ARTICLE_WEIXIN' }),
      variant({ platformId: 'wechat', body: '<script>alert(1)</script>\n\n第二段 & 内容', html: '<img src=x onerror=alert(1)>' }), [image], 20);
    assert.equal(result.dispatched, true);
    assert.match(result.message, /只同步草稿/);
    const data = browser.requests[0].data.data;
    assert.equal(data.markdownContent, '<script>alert(1)</script>\n\n第二段 & 内容');
    assert.equal(data.htmlContent, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>第二段 &amp; 内容</p>');
    assert.equal(data.cover.url, 'http://localhost:4317/uploads/cover.png');
    assert.doesNotMatch(data.htmlContent, /onerror/);
  });
});

test('rejects unapproved, missing media, unsafe asset URLs and unsupported threads before handoff', async () => {
  await inBrowser(async (browser) => {
    const rejected = await dispatchMultiPost(platform(), variant({ approved: false }), [], 20);
    assert.equal(rejected.dispatched, false);
    assert.equal(rejected.outcome, 'failed');
    assert.match((await dispatchMultiPost(platform({ id: 'wechat', name: '公众号', multipostId: 'ARTICLE_WEIXIN' }), variant({ platformId: 'wechat' }), [], 20)).message, /封面图片/);
    assert.match((await dispatchMultiPost(platform(), variant(), [{ ...image, url: 'javascript:alert(1)' }], 20)).message, /HTTP/);
    assert.match((await dispatchMultiPost(platform(), variant({ thread: ['1', '2'] }), [], 20)).message, /串文/);
    assert.equal(browser.requests.length, 0);
  });
});

test('maps a single video and refuses multiple videos instead of silently dropping assets', async () => {
  await inBrowser(async (browser) => {
    browser.onPost = (request) => browser.emit(request, { status: 'received', extensionId: 'extension' });
    const video: Media = { id: 'm2', name: 'video.mp4', url: '/uploads/video.mp4', mime: 'video/mp4', size: 256 };
    const target = platform({ id: 'youtube', name: 'YouTube', multipostId: 'VIDEO_YOUTUBE', requiredMedia: 'video' });
    const content = variant({ platformId: 'youtube' });
    assert.equal((await dispatchMultiPost(target, content, [video, image], 20)).dispatched, true);
    assert.equal(browser.requests[0].data.data.video.url, 'http://localhost:4317/uploads/video.mp4');
    assert.match((await dispatchMultiPost(target, content, [video, { ...video, id: 'm3' }], 20)).message, /一个视频/);
    assert.equal(browser.requests.length, 1);
  });
});

test('timeouts and uncertain/malformed dispatch receipts never claim publication', async () => {
  await inBrowser(async (browser) => {
    const timeout = await dispatchMultiPost(platform(), variant(), [], 8);
    assert.equal(timeout.dispatched, false);
    assert.equal(timeout.outcome, 'unconfirmed');
    assert.match(timeout.message, /未收到.*扩展响应/);
    assert.match(timeout.message, /不要重复交接/);
    assert.equal(browser.requests.length, 1, 'Timeout never causes an automatic resend');
    browser.emit(browser.requests[0], { status: 'received', extensionId: 'late-response' });
    assert.equal(browser.listeners.size, 0, 'Late receipts cannot silently change a settled result');
    browser.onPost = (request) => browser.emit(request, { tabs: [{ id: 1 }] });
    const tabs = await dispatchMultiPost(platform(), variant(), [], 20);
    assert.equal(tabs.dispatched, false);
    assert.equal(tabs.outcome, 'unconfirmed');
    assert.match(tabs.message, /尚未确认发布/);
  });
});

test('runtime errors and unknown responses preserve uncertainty instead of claiming a safe failure', async () => {
  await inBrowser(async browser => {
    for (const code of [500, 400, 1]) {
      browser.onPost = request => browser.emit(request, null, { data: { type: 'response', traceId: request.traceId, action: request.action, code, message: 'secret upstream details', data: null } });
      const result = await dispatchMultiPost(platform(), variant(), [], 20);
      assert.equal(result.outcome, 'unconfirmed', String(code)); assert.equal(result.dispatched, false);
      assert.match(result.message, /不要重复交接/); assert.doesNotMatch(result.message, /secret upstream/);
    }
    for (const data of [{ error: 'private extension credentials' }, { status: 'received' }, null, { status: 'unknown', extensionId: 'extension' }]) {
      browser.onPost = request => browser.emit(request, data);
      const result = await dispatchMultiPost(platform(), variant(), [], 20);
      assert.equal(result.outcome, 'unconfirmed'); assert.equal(result.dispatched, false);
      assert.doesNotMatch(result.message, /private extension/);
    }
  });
});

test('a synchronous postMessage rejection is a definite failure before browser handoff', async () => {
  await inBrowser(async browser => {
    browser.postMessage = () => { throw new DOMException('Private clone error', 'DataCloneError'); };
    const result = await dispatchMultiPost(platform(), variant(), [], 20);
    assert.equal(result.outcome, 'failed'); assert.equal(result.dispatched, false);
    assert.equal(browser.requests.length, 0); assert.doesNotMatch(result.message, /Private clone/);
  });
});
