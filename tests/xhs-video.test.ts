import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { getConnectorDefinitions, publish, testConnection, validateConnection } from '../server/connectors.js';
import { EnterpriseConnectorError } from '../server/enterprise.js';
import { platformById, platforms } from '../server/catalog.js';
import { localMediaPath } from '../server/queue.js';
import { Store } from '../server/storage.js';
import type { ConnectionPrivate, Media, PublishContext, Variant } from '../server/types.js';

const video: Media = { id: 'video', name: 'clip.mp4', url: '/uploads/abc-123.mp4', mime: 'video/mp4', size: 16 };
const image: Media = { id: 'image', name: 'cover.png', url: '/uploads/abc-456.png', mime: 'image/png', size: 8 };
const context: PublishContext = { publicBaseUrl: 'http://127.0.0.1:4318', readMedia: async () => { throw new Error('Video REST publishing must use its absolute local path, not read/upload bytes'); } };
function variant(platformId: string): Variant { return { id: 'variant', contentId: 'content', platformId, title: '视频标题', body: '审核后的正文', tags: ['创作'], thread: [], source: 'manual', issues: [], approved: true, updatedAt: '2026-10-03T00:00:00Z' }; }
function connection(config: Record<string, string> = {}): ConnectionPrivate { return { id: 'connection', name: 'local XHS', platformId: 'xiaohongshu', connector: 'xiaohongshu', enabled: true, config: { baseUrl: 'http://127.0.0.1:18060', format: 'video', ...config } }; }
function feishu(): ConnectionPrivate { return { id: 'feishu', name: 'Feishu bot', platformId: 'feishu', connector: 'native', enabled: true, config: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook' } }; }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
type RequestStep = (url: string, init: RequestInit) => Response | Promise<Response>;
async function withFetch<T>(steps: RequestStep[], run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const step = steps[calls++];
    assert.ok(step, 'Unexpected fetch; real network and publishing are disabled in this test');
    return step(String(input), init);
  };
  try { const result = await run(); assert.equal(calls, steps.length, 'expected mocked request count'); return result; }
  finally { globalThis.fetch = original; }
}
function run(config: Record<string, string> = {}, media: Media[] = [video], ctx: PublishContext = context) { return publish(connection(config), platformById('xiaohongshu'), variant('xiaohongshu'), media, ctx); }

test('XHS video total publish route sends a single uploaded MP4 absolute path; receipt without ID remains unconfirmed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'creator-xhs-video-'));
  const store = new Store(dir);
  try {
    const absolute = localMediaPath(store, video);
    assert.equal(isAbsolute(absolute), true);
    assert.equal(absolute, join(store.uploadDir, 'abc-123.mp4'));
    const result = await withFetch([(url, init) => {
      assert.equal(url, 'http://127.0.0.1:18060/api/v1/publish_video');
      assert.equal(init.method, 'POST');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer mock-only-token');
      assert.deepEqual(JSON.parse(String(init.body)), { title: '视频标题', content: '审核后的正文', video: absolute, tags: ['创作'] });
      return json({ success: true, data: { status: '发布完成' } });
    }], () => run({ apiKey: 'mock-only-token' }, [video], { ...context, localMediaPath: media => localMediaPath(store, media) }));
    assert.equal(result.status, 'unconfirmed');
    assert.equal(result.remoteId, undefined); assert.equal(result.url, undefined);
    assert.doesNotMatch(result.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('localhost and IPv6 loopback video services remain supported without a remote path mapping', async () => {
  for (const baseUrl of ['http://localhost:18060', 'http://[::1]:18060']) {
    await withFetch([(url, init) => {
      assert.equal(url, `${baseUrl}/api/v1/publish_video`);
      assert.equal(JSON.parse(String(init.body)).video, '/local-test/uploads/abc-123.mp4');
      return json({ success: true });
    }], async () => { assert.equal((await run({ baseUrl }, [video], { ...context, localMediaPath: () => '/local-test/uploads/abc-123.mp4' })).status, 'unconfirmed'); });
  }
});

test('remote XHS video service rejects before fetch or local path resolution and does not leak a path', async () => {
  await withFetch([], async () => {
    for (const baseUrl of ['https://xhs-service.example', 'http://10.0.0.8:18060', 'http://127.0.0.1.attacker.example:18060']) {
      let reads = 0;
      await assert.rejects(() => run({ baseUrl }, [video], { ...context, localMediaPath: () => { reads++; return '/private/local-video-path.mp4'; } }), e => {
        assert.ok(e instanceof Error); assert.match(e.message, /同机回环服务/);
        assert.doesNotMatch(e.message, /private\/local-video-path|xhs-service\.example|attacker\.example/);
        return true;
      });
      assert.equal(reads, 0);
    }
  });
});

test('missing or relative localMediaPath rejects without exposing paths or requesting the service', async () => {
  await withFetch([], async () => {
    for (const ctx of [context, { ...context, localMediaPath: () => '' }, { ...context, localMediaPath: () => 'relative/private-video.mp4' }]) {
      await assert.rejects(() => run({}, [video], ctx), e => {
        assert.ok(e instanceof Error); assert.match(e.message, /本机路径/);
        assert.doesNotMatch(e.message, /relative\/private-video/);
        return true;
      });
    }
  });
});

test('XHS video rejects no media, multiple media, accompanying cover, and non-MP4 before fetch', async () => {
  await withFetch([], async () => {
    for (const media of [[], [video, { ...video, id: 'second' }], [video, image], [image], [{ ...video, mime: 'video/webm' }], [{ ...video, mime: 'application/octet-stream' }]]) {
      let paths = 0;
      await assert.rejects(() => run({}, media, { ...context, localMediaPath: () => { paths++; return '/local-test/clip.mp4'; } }), /单个已上传的 MP4/);
      assert.equal(paths, 0);
    }
  });
});

test('localMediaPath rejects URL traversal, encoded traversal, remote references and arbitrary filesystem paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'creator-xhs-path-'));
  const store = new Store(dir);
  try {
    assert.equal(localMediaPath(store, video), join(store.uploadDir, 'abc-123.mp4'));
    for (const url of [
      '/uploads/../vault.key', '/uploads/../../private.mp4', '/uploads/%2e%2e/private.mp4',
      '/uploads/abc/../private.mp4', '/uploads/abc%2fprivate.mp4', '/uploads/abc\\..\\private.mp4',
      '/private/clip.mp4', 'file:///private/clip.mp4', 'https://example.com/uploads/abc-123.mp4',
      '/uploads/abc-123.mp4?token=private', '/uploads/abc-123.mp4#fragment', '/uploads/not-a-hex-id.mp4',
    ]) {
      assert.throws(() => localMediaPath(store, { ...video, url }), e => { assert.ok(e instanceof Error); assert.match(e.message, /工作台上传/); assert.ok(!e.message.includes(url)); return true; });
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('enterprise definition, config checks and read-only test are registered at the total connector entry', async () => {
  assert.ok(getConnectorDefinitions(platforms).some(d => d.id === 'native:feishu'));
  assert.deepEqual(validateConnection(feishu(), platformById('feishu')), []);
  assert.ok(validateConnection({ ...feishu(), config: { webhookUrl: 'https://attacker.example/hook' } }, platformById('feishu')).length);
  await withFetch([], async () => { const result = await testConnection(feishu(), platformById('feishu')); assert.equal(result.ok, true); assert.match(result.message, /没有发送消息/); });
});

test('native Feishu total publish route delegates enterprise protocol; only documented numeric code 0 succeeds', async () => {
  const publishBot = () => publish(feishu(), platformById('feishu'), variant('feishu'), [], context);
  await withFetch([(url, init) => {
    assert.equal(url, feishu().config.webhookUrl);
    assert.deepEqual(JSON.parse(String(init.body)), { msg_type: 'text', content: { text: '审核后的正文' } });
    return json({ code: 0, data: {}, msg: 'success' });
  }], async () => { const result = await publishBot(); assert.equal(result.status, 'published'); assert.equal(result.remoteId, undefined); });
  for (const response of [json({ code: '0' }), json({ StatusCode: 0 }), json({ code: 0 }, 202)]) {
    await withFetch([() => response], async () => { assert.equal((await publishBot()).status, 'unconfirmed'); });
  }
  await withFetch([() => json({ code: 9499, msg: 'private webhook key' })], async () => {
    await assert.rejects(publishBot, e => { assert.ok(e instanceof EnterpriseConnectorError); assert.equal(e.uncertain, false); assert.match(e.message, /9499/); assert.doesNotMatch(e.message, /private webhook key/); return true; });
  });
});
