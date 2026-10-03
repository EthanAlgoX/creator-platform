import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPublication, ConnectorError, getConnectorDefinitions, publish, testConnection, validateConnection } from '../server/connectors.js';
import { platforms, platformById } from '../server/catalog.js';
import type { ConnectionPrivate, Media, PublishContext, Variant } from '../server/types.js';

const context: PublishContext = { publicBaseUrl: 'http://127.0.0.1:4318', readMedia: async () => new Uint8Array([1, 2, 3]) };
const image: Media = { id: 'm', name: 'cover.png', url: '/uploads/cover.png', mime: 'image/png', size: 3 };
const video: Media = { ...image, id: 'v', name: 'clip.mp4', url: '/uploads/clip.mp4', mime: 'video/mp4' };
function variant(platformId: string, changes: Partial<Variant> = {}): Variant {
  return { id: 'variant', contentId: 'content', platformId, title: 'Title', body: 'Text', tags: ['test'], thread: [], source: 'manual', approved: true, issues: [], updatedAt: '2026-10-03T00:00:00Z', ...changes };
}
function connection(platformId: string, config: Record<string, string>, connector = 'native'): ConnectionPrivate {
  return { id: 'connection', name: 'Account', enabled: true, platformId, connector, config };
}
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function payload(init: RequestInit): any { return JSON.parse(String(init.body)); }
function headers(init: RequestInit): Headers { return new Headers(init.headers); }
type Expectation = (url: string, init: RequestInit) => Response | Promise<Response>;
async function withFetch<T>(expectations: Expectation[], callback: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (input, init = {}) => {
    const step = expectations[call++];
    assert.ok(step, `Unexpected network request ${String(input)} (real network disabled)`);
    return step(String(input), init);
  };
  try { const result = await callback(); assert.equal(call, expectations.length, 'all mocked requests consumed'); return result; }
  finally { globalThis.fetch = original; }
}
async function run(platformId: string, config: Record<string, string>, media: Media[] = [], changes: Partial<Variant> = {}, connector = 'native') {
  return publish(connection(platformId, config, connector), platformById(platformId), variant(platformId, changes), media, context);
}

test('native registry is specific; webhook secrets, required fields and URL formats are validated', () => {
  const defs = getConnectorDefinitions(platforms);
  const nativeIds = defs.filter(d => d.id.startsWith('native:')).map(d => d.id);
  assert.equal(new Set(nativeIds).size, nativeIds.length);
  for (const id of ['x', 'reddit', 'mastodon', 'bluesky', 'telegram', 'discord', 'slack', 'devto', 'wordpress', 'ghost', 'hashnode', 'misskey', 'lemmy', 'blogger']) assert.ok(nativeIds.includes(`native:${id}`));
  assert.equal(defs.find(d => d.id === 'native:discord')?.fields.find(f => f.key === 'webhookUrl')?.secret, true);
  assert.ok(validateConnection(connection('x', {}), platformById('x')).length);
  assert.ok(validateConnection(connection('slack', { webhookUrl: 'https://evil.example/services/token' }), platformById('slack')).length);
  assert.ok(validateConnection(connection('mastodon', { baseUrl: 'https://user:pass@example.com', accessToken: 'secret' }), platformById('mastodon')).length);
  assert.ok(validateConnection(connection('x', { baseUrl: 'https://postiz.example/public/v1', apiKey: 'secret', integrationId: 'a', settingsJson: '[]' }, 'postiz'), platformById('x')).length);
  assert.ok(!validateConnection(connection('x', { accessToken: 'secret' }), platformById('x')).length);
  assert.ok(validateConnection(connection('linkedin', {}, 'native'), platformById('linkedin')).length);
});

test('all native credential tests use read-only endpoints or authentication only', async () => {
  const cases: [string, Record<string, string>, string, unknown][] = [
    ['x', { accessToken: 'x-secret' }, 'https://api.x.com/2/users/me', { data: { id: 'u' } }],
    ['reddit', { accessToken: 'reddit-secret', subreddit: 'test', userAgent: 'creator-test' }, 'https://oauth.reddit.com/api/v1/me', { id: 'u' }],
    ['mastodon', { baseUrl: 'https://mastodon.example', accessToken: 'm-secret' }, 'https://mastodon.example/api/v1/accounts/verify_credentials', { id: 'u' }],
    ['telegram', { botToken: '123:test_token', chatId: '-123' }, 'https://api.telegram.org/bot123:test_token/getMe', { ok: true, result: { id: 123 } }],
    ['discord', { webhookUrl: 'https://discord.com/api/webhooks/123/secret' }, 'https://discord.com/api/webhooks/123/secret', { id: '123' }],
    ['devto', { apiKey: 'dev-secret' }, 'https://dev.to/api/users/me', { id: 1 }],
    ['wordpress', { baseUrl: 'https://wp.example', username: 'user', applicationPassword: 'wp-secret' }, 'https://wp.example/wp-json/wp/v2/users/me?context=edit', { id: 1 }],
  ];
  for (const [id, config, endpoint, reply] of cases) {
    await withFetch([(url, init) => { assert.equal(url, endpoint); assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined); return json(reply); }], async () => {
      assert.equal((await testConnection(connection(id, config), platformById(id))).ok, true);
    });
  }
  await withFetch([(url, init) => { assert.ok(url.endsWith('/com.atproto.server.createSession')); assert.deepEqual(payload(init), { identifier: 'user.bsky.social', password: 'secret' }); return json({ did: 'did:plc:u', accessJwt: 'jwt' }); }], async () => {
    assert.equal((await testConnection(connection('bluesky', { identifier: 'user.bsky.social', appPassword: 'secret' }), platformById('bluesky'))).ok, true);
  });
  await withFetch([], async () => {
    const result = await testConnection(connection('slack', { webhookUrl: 'https://hooks.slack.com/services/T/B/token' }), platformById('slack'));
    assert.equal(result.ok, true); assert.match(result.message, /没有发送/);
  });
});

test('X uploads multipart images and publishes a linked thread, using user authorization', async () => {
  const result = await withFetch([
    (url, init) => { assert.equal(url, 'https://api.x.com/2/media/upload'); assert.equal(headers(init).get('Authorization'), 'Bearer secret'); const form = init.body as FormData; assert.ok(form.get('media') instanceof Blob); assert.equal(form.get('media_category'), 'tweet_image'); return json({ data: { id: 'media1' } }); },
    (url, init) => { assert.equal(url, 'https://api.x.com/2/tweets'); assert.deepEqual(payload(init), { text: 'First', media: { media_ids: ['media1'] } }); return json({ data: { id: 'post1' } }, 201); },
    (_url, init) => { assert.deepEqual(payload(init), { text: 'Second', reply: { in_reply_to_tweet_id: 'post1' } }); return json({ data: { id: 'post2' } }, 201); },
  ], () => run('x', { accessToken: 'secret' }, [image], { thread: ['First', 'Second'] }));
  assert.equal(result.status, 'published'); assert.equal(result.remoteId, 'post1'); assert.equal(result.url, 'https://x.com/i/web/status/post1');
});

test('X partial thread failures are ambiguous and CJK weighted length is checked before network', async () => {
  await withFetch([() => json({ data: { id: 'first' } }, 201), () => json({ error: 'definite rejection' }, 400)], async () => {
    await assert.rejects(() => run('x', { accessToken: 'secret' }, [], { thread: ['First', 'Second'] }), (e: any) => e instanceof ConnectorError && e.uncertain);
  });
  await withFetch([], async () => {
    await assert.rejects(() => run('x', { accessToken: 'secret' }, [], { body: '字'.repeat(141) }), /280/);
    await assert.rejects(() => run('x', { accessToken: 'secret' }, [video]), /图片/);
  });
});

test('Reddit sends a self post and treats HTTP 200 embedded errors as failures', async () => {
  const config = { accessToken: 'secret', subreddit: 'r/test', userAgent: 'creator-test', flairId: 'f' };
  const result = await withFetch([(url, init) => {
    assert.equal(url, 'https://oauth.reddit.com/api/submit'); assert.equal(headers(init).get('User-Agent'), 'creator-test');
    const p = init.body as URLSearchParams; assert.equal(p.get('kind'), 'self'); assert.equal(p.get('sr'), 'test'); assert.equal(p.get('title'), 'Title'); assert.equal(p.get('text'), 'Text'); assert.equal(p.get('flair_id'), 'f');
    return json({ json: { errors: [], data: { name: 't3_123', url: 'https://www.reddit.com/r/test/comments/123' } } });
  }], () => run('reddit', config));
  assert.equal(result.status, 'published'); assert.equal(result.remoteId, 't3_123');
  await withFetch([() => json({ json: { errors: [['RATELIMIT', 'secret upstream text', '']] } })], async () => {
    await assert.rejects(() => run('reddit', config), (e: any) => !e.uncertain && !e.message.includes('secret upstream text'));
  });
});

test('Mastodon waits for media readiness and sends an idempotent status', async () => {
  const result = await withFetch([
    (url, init) => { assert.equal(url, 'https://mastodon.example/api/v2/media'); assert.ok((init.body as FormData).get('file') instanceof Blob); return json({ id: 'media', url: null }, 202); },
    (url, init) => { assert.equal(url, 'https://mastodon.example/api/v1/media/media'); assert.equal(init.method ?? 'GET', 'GET'); return json({ id: 'media', url: 'https://mastodon.example/media.png' }); },
    (url, init) => { assert.equal(url, 'https://mastodon.example/api/v1/statuses'); assert.equal(headers(init).get('Idempotency-Key')?.length, 64); assert.deepEqual(payload(init), { status: 'Text', media_ids: ['media'], visibility: 'unlisted' }); return json({ id: 'p', url: 'https://mastodon.example/@u/p' }); },
  ], () => run('mastodon', { baseUrl: 'https://mastodon.example', accessToken: 'secret', visibility: 'unlisted' }, [image]));
  assert.equal(result.status, 'published');
});

test('Bluesky authenticates, uploads a blob and creates a record with an embed', async () => {
  const blob = { $type: 'blob', ref: { $link: 'cid1' }, mimeType: 'image/png', size: 3 };
  const result = await withFetch([
    (url, init) => { assert.equal(url, 'https://bsky.social/xrpc/com.atproto.server.createSession'); assert.deepEqual(payload(init), { identifier: 'u.bsky.social', password: 'secret' }); return json({ accessJwt: 'jwt', did: 'did:plc:u' }); },
    (url, init) => { assert.ok(url.endsWith('/com.atproto.repo.uploadBlob')); assert.equal(headers(init).get('Authorization'), 'Bearer jwt'); assert.equal(headers(init).get('Content-Type'), 'image/png'); assert.ok(init.body instanceof Blob); return json({ blob }); },
    (url, init) => { assert.ok(url.endsWith('/com.atproto.repo.createRecord')); const p = payload(init); assert.equal(p.repo, 'did:plc:u'); assert.equal(p.collection, 'app.bsky.feed.post'); assert.equal(p.record.$type, 'app.bsky.feed.post'); assert.equal(p.record.text, 'Text'); assert.deepEqual(p.record.embed.images, [{ alt: 'cover.png', image: blob }]); return json({ uri: 'at://did:plc:u/app.bsky.feed.post/record1', cid: 'postcid' }); },
  ], () => run('bluesky', { identifier: 'u.bsky.social', appPassword: 'secret' }, [image]));
  assert.equal(result.status, 'published'); assert.equal(result.url, 'https://bsky.app/profile/did%3Aplc%3Au/post/record1');
  await withFetch([], async () => { await assert.rejects(() => run('bluesky', { identifier: 'u', appPassword: 'secret' }, [{ ...image, size: 2_000_001 }]), /2 MB/); });
});

test('Telegram supports text and multipart media groups without inventing private links', async () => {
  const config = { botToken: '123:test_token', chatId: '-456' };
  const textResult = await withFetch([(url, init) => { assert.ok(url.endsWith('/sendMessage')); assert.deepEqual(payload(init), { chat_id: '-456', text: 'Text' }); return json({ ok: true, result: { message_id: 1, chat: { id: -456 } } }); }], () => run('telegram', config));
  assert.equal(textResult.status, 'published'); assert.equal(textResult.remoteId, '-456:1'); assert.equal(textResult.url, undefined);
  const groupResult = await withFetch([(url, init) => {
    assert.ok(url.endsWith('/sendMediaGroup')); const form = init.body as FormData; assert.equal(form.get('chat_id'), '-456'); assert.ok(form.get('media0') instanceof Blob); assert.ok(form.get('media1') instanceof Blob);
    assert.deepEqual(JSON.parse(String(form.get('media'))), [{ type: 'photo', media: 'attach://media0', caption: 'Text' }, { type: 'video', media: 'attach://media1' }]);
    return json({ ok: true, result: [{ message_id: 2, chat: { id: -456, username: 'publicchannel' } }, { message_id: 3, chat: { id: -456, username: 'publicchannel' } }] });
  }], () => run('telegram', config, [image, video]));
  assert.equal(groupResult.status, 'published'); assert.equal(groupResult.url, 'https://t.me/publicchannel/2');
  await withFetch([() => json({ ok: false, error_code: 400 })], async () => { await assert.rejects(() => run('telegram', config), /拒绝发送/); });
});

test('Discord requests a synchronous reply and suppresses mentions in multipart payload', async () => {
  const result = await withFetch([(url, init) => {
    assert.equal(new URL(url).searchParams.get('wait'), 'true'); const form = init.body as FormData; const p = JSON.parse(String(form.get('payload_json')));
    assert.deepEqual(p.allowed_mentions, { parse: [] }); assert.deepEqual(p.attachments, [{ id: 0, filename: 'cover.png' }]); assert.ok(form.get('files[0]') instanceof Blob);
    return json({ id: 'message', channel_id: 'channel' });
  }], () => run('discord', { webhookUrl: 'https://discord.com/api/webhooks/123/secret', guildId: 'guild' }, [image]));
  assert.equal(result.status, 'published'); assert.equal(result.url, 'https://discord.com/channels/guild/channel/message');
  await withFetch([() => new Response(null, { status: 204 })], async () => { assert.equal((await run('discord', { webhookUrl: 'https://discord.com/api/webhooks/123/secret' })).status, 'unconfirmed'); });
});

test('Slack only its documented literal ok counts as success; attachments rejected', async () => {
  const config = { webhookUrl: 'https://hooks.slack.com/services/T/B/token' };
  const result = await withFetch([(_url, init) => { assert.deepEqual(payload(init), { text: 'Text' }); return new Response('ok', { status: 200 }); }], () => run('slack', config));
  assert.equal(result.status, 'published'); assert.equal(result.remoteId, undefined);
  await withFetch([() => json({ ok: true })], async () => { assert.equal((await run('slack', config)).status, 'unconfirmed'); });
  await withFetch([], async () => { await assert.rejects(() => run('slack', config, [image]), /暂不上传/); });
});

test('DEV saves draft by default and rejects inaccessible local images before posting', async () => {
  const result = await withFetch([(url, init) => { assert.equal(url, 'https://dev.to/api/articles'); assert.equal(headers(init).get('api-key'), 'secret'); assert.equal(payload(init).article.published, false); assert.equal(payload(init).article.body_markdown, 'Text'); return json({ id: 12, published_at: null, url: 'https://dev.to/u/draft' }, 201); }], () => run('devto', { apiKey: 'secret' }));
  assert.equal(result.status, 'drafted');
  await withFetch([], async () => { await assert.rejects(() => run('devto', { apiKey: 'secret' }, [image]), /公网/); });
  const publicImage = { ...image, url: 'https://images.example/cover.png' };
  await withFetch([(_url, init) => { const p = payload(init).article; assert.equal(p.published, true); assert.equal(p.main_image, publicImage.url); assert.match(p.body_markdown, /images\.example/); return json({ id: 13, published_at: '2026-10-03T00:00:00Z', url: 'https://dev.to/u/public' }, 201); }], async () => { assert.equal((await run('devto', { apiKey: 'secret', postType: 'publish' }, [publicImage])).status, 'published'); });
});

test('WordPress uploads media then creates a draft with actual REST statuses', async () => {
  const result = await withFetch([
    (url, init) => { assert.equal(url, 'https://wp.example/wp-json/wp/v2/media'); assert.equal(headers(init).get('Authorization'), `Basic ${Buffer.from('u:secret').toString('base64')}`); assert.match(headers(init).get('Content-Disposition')!, /cover\.png/); assert.ok(init.body instanceof Blob); return json({ id: 9, source_url: 'https://wp.example/uploads/image.png' }, 201); },
    (url, init) => { assert.equal(url, 'https://wp.example/wp-json/wp/v2/posts'); const p = payload(init); assert.equal(p.status, 'draft'); assert.equal(p.featured_media, 9); assert.match(p.content, /<p>Text<\/p>/); assert.match(p.content, /wp\.example\/uploads/); return json({ id: 99, status: 'draft', link: 'https://wp.example/?p=99' }, 201); },
  ], () => run('wordpress', { baseUrl: 'https://wp.example', username: 'u', applicationPassword: 'secret' }, [image]));
  assert.equal(result.status, 'drafted');
  await withFetch([() => json({ id: 100, status: 'future', link: 'https://wp.example/future' }, 201)], async () => { assert.equal((await run('wordpress', { baseUrl: 'https://wp.example', username: 'u', applicationPassword: 'secret', postType: 'publish' })).status, 'unconfirmed'); });
});

test('Postiz uploads files, preserves provider settings, and queued receipt is unconfirmed', async () => {
  const config = { baseUrl: 'https://postiz.example/public/v1', apiKey: 'secret', integrationId: 'integration', settingsJson: '{"who_can_reply_post":"following"}' };
  const result = await withFetch([
    (url, init) => { assert.equal(url, 'https://postiz.example/public/v1/upload'); assert.equal(headers(init).get('Authorization'), 'secret'); assert.ok((init.body as FormData).get('file') instanceof Blob); return json({ id: 'media', path: 'https://postiz.example/media.png' }); },
    (url, init) => { assert.equal(url, 'https://postiz.example/public/v1/posts'); const p = payload(init); assert.equal(p.type, 'now'); assert.equal(p.posts[0].integration.id, 'integration'); assert.deepEqual(p.posts[0].settings, { __type: 'x', who_can_reply_post: 'following' }); assert.deepEqual(p.posts[0].value[0], { content: 'Text', image: [{ id: 'media', path: 'https://postiz.example/media.png' }] }); return json([{ postId: 'internal', integration: 'integration' }]); },
  ], () => run('x', config, [image], {}, 'postiz'));
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.remoteId, 'internal');
  await withFetch([() => json([{ postId: 'draft', integration: 'integration' }])], async () => { assert.equal((await run('x', { ...config, postType: 'draft' }, [], {}, 'postiz')).status, 'drafted'); });
});

test('Postiz reconciliation is GET-only and requires PUBLISHED plus external proof', async () => {
  const c = connection('x', { baseUrl: 'https://postiz.example/public/v1', apiKey: 'secret', integrationId: 'integration' }, 'postiz');
  for (const [row, expected] of [
    [{ state: 'QUEUE' }, null],
    [{ state: 'PUBLISHED' }, null],
    [{ state: 'PUBLISHED', releaseId: 'external', releaseURL: 'https://x.com/i/web/status/external' }, 'published'],
    [{ state: 'DRAFT' }, 'drafted'],
  ] as const) {
    await withFetch([(url, init) => { assert.equal(init.method ?? 'GET', 'GET'); const parsed = new URL(url); assert.equal(parsed.pathname, '/public/v1/posts'); assert.ok(parsed.searchParams.get('startDate')); assert.ok(parsed.searchParams.get('endDate')); return json({ posts: [{ id: 'internal', integration: { id: 'integration' }, ...row }] }); }], async () => { assert.equal((await checkPublication(c, platformById('x'), 'internal'))?.status ?? null, expected); });
  }
  await withFetch([() => json({ posts: [{ id: 'internal', integration: { id: 'different-account' }, state: 'PUBLISHED', releaseId: 'x' }] })], async () => { assert.equal(await checkPublication(c, platformById('x'), 'internal'), null); });
  await withFetch([() => json({ posts: [{ id: 'internal', integration: { id: 'integration' }, state: 'ERROR' }] })], async () => { await assert.rejects(() => checkPublication(c, platformById('x'), 'internal'), (e: any) => e instanceof ConnectorError && !e.uncertain && e.terminalFailure); });
  await withFetch([() => json({}, 401)], async () => { await assert.rejects(() => checkPublication(c, platformById('x'), 'internal'), (e: any) => e instanceof ConnectorError && !e.terminalFailure); });
});

test('Postiz credential check confirms exact account and target provider', async () => {
  const c = connection('reddit', { baseUrl: 'https://postiz.example/public/v1', apiKey: 'secret', integrationId: 'r' }, 'postiz');
  await withFetch([(url, init) => { assert.ok(url.endsWith('/integrations')); assert.equal(init.method ?? 'GET', 'GET'); return json([{ id: 'r', providerIdentifier: 'reddit' }]); }], async () => { assert.equal((await testConnection(c, platformById('reddit'))).ok, true); });
  await withFetch([() => json([{ id: 'r', providerIdentifier: 'x' }])], async () => { assert.equal((await testConnection(c, platformById('reddit'))).ok, false); });
});

test('Xiaohongshu login checks auth and browser success without durable ID stays unconfirmed', async () => {
  const c = connection('xiaohongshu', { baseUrl: 'http://127.0.0.1:18060', apiKey: 'secret' }, 'xiaohongshu');
  await withFetch([(url, init) => { assert.ok(url.endsWith('/api/v1/login/status')); assert.equal(headers(init).get('Authorization'), 'Bearer secret'); return json({ success: true, data: { is_logged_in: true } }); }], async () => { assert.equal((await testConnection(c, platformById('xiaohongshu'))).ok, true); });
  const result = await withFetch([(url, init) => { assert.ok(url.endsWith('/api/v1/publish')); assert.deepEqual(payload(init), { title: 'Title', content: 'Text', images: ['http://127.0.0.1:4318/uploads/cover.png'], tags: ['test'] }); return json({ success: true, data: { status: '发布完成' } }); }], () => publish(c, platformById('xiaohongshu'), variant('xiaohongshu'), [image], context));
  assert.equal(result.status, 'unconfirmed'); assert.match(result.message, /发布完成/);
  await withFetch([], async () => { await assert.rejects(() => publish(c, platformById('xiaohongshu'), variant('xiaohongshu'), [video], context), /暂不支持/); });
});

test('Wechatsync HTTP bridge uses precise method envelopes and only confirms documented draft outcomes', async () => {
  const c = connection('zhihu', { baseUrl: 'http://127.0.0.1:9528' }, 'wechatsync');
  await withFetch([
    (url, init) => { assert.ok(url.endsWith('/status')); assert.equal(init.method ?? 'GET', 'GET'); return json({ connected: true, mode: 'primary' }); },
    (url, init) => { assert.ok(url.endsWith('/request')); assert.deepEqual(payload(init), { method: 'checkAuth', params: { platform: 'zhihu' } }); return json({ result: { isAuthenticated: true } }); },
  ], async () => { assert.equal((await testConnection(c, platformById('zhihu'))).ok, true); });
  const result = await withFetch([(_url, init) => { const p = payload(init); assert.equal(p.method, 'syncArticle'); assert.deepEqual(p.params.platforms, ['zhihu']); assert.equal(p.params.article.title, 'Title'); assert.match(p.params.article.content, /<p>Text<\/p>/); assert.equal(p.params.article.markdown, 'Text'); return json({ result: { results: [{ platform: 'zhihu', success: true, draftOnly: true, postId: 'draft', postUrl: 'https://zhuanlan.zhihu.com/p/draft' }] } }); }], () => publish(c, platformById('zhihu'), variant('zhihu'), [], context));
  assert.equal(result.status, 'drafted');
  await withFetch([() => json({ result: { results: [{ platform: 'zhihu', success: true }] } })], async () => { assert.equal((await publish(c, platformById('zhihu'), variant('zhihu'), [], context)).status, 'unconfirmed'); });
});

test('draft receipts never persist WeChat session tokens or other credential-bearing URLs', async () => {
  const c = connection('wechat', { baseUrl: 'http://127.0.0.1:9528' }, 'wechatsync');
  for (const key of ['token', 'access_token', 'api_key', 'secret', 'authorization', 'signature', 'nonce']) {
    const result = await withFetch([() => json({ result: { results: [{ platform: 'weixin', success: true, draftOnly: true, postId: 'draft-id', postUrl: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&${key}=SESSION_SECRET` }] } })], () => publish(c, platformById('wechat'), variant('wechat'), [], context));
    assert.equal(result.status, 'drafted'); assert.equal(result.remoteId, 'draft-id'); assert.equal(result.url, undefined);
    assert.ok(!JSON.stringify(result).includes('SESSION_SECRET'));
  }
  const noProof = await withFetch([() => json({ result: { results: [{ platform: 'weixin', success: true, draftOnly: true, postUrl: 'https://mp.weixin.qq.com/?token=SESSION_SECRET' }] } })], () => publish(c, platformById('wechat'), variant('wechat'), [], context));
  assert.equal(noProof.status, 'unconfirmed'); assert.equal(noProof.url, undefined);
});

test('MultiPost emits needs_action without doing server-side network work', async () => {
  await withFetch([], async () => { assert.equal((await run('xiaohongshu', {}, [image], {}, 'multipost')).status, 'needs_action'); });
});

test('custom webhook demands explicit completion and external proof; 202 is never complete', async () => {
  const config = { url: 'https://custom.example/publish', apiKey: 'secret' };
  for (const [reply, status, expected] of [
    [{ ok: true }, 200, 'unconfirmed'],
    [{ status: 'scheduled', remoteId: 'id' }, 200, 'unconfirmed'],
    [{ status: 'published' }, 200, 'unconfirmed'],
    [{ status: 'published', remoteId: 'id' }, 202, 'unconfirmed'],
    [{ status: 'published', remoteId: 'id', url: 'https://custom.example/post' }, 200, 'published'],
    [{ status: 'drafted', remoteId: 'id' }, 200, 'drafted'],
  ] as const) {
    await withFetch([(url, init) => { assert.equal(url, config.url); assert.equal(headers(init).get('Authorization'), 'Bearer secret'); const p = payload(init); assert.equal(p.platformId, 'zhihu'); assert.equal(p.media[0].url, 'http://127.0.0.1:4318/uploads/cover.png'); return json(reply, status); }], async () => { assert.equal((await run('zhihu', config, [image], {}, 'webhook')).status, expected); });
  }
});

test('publication network timeout and server errors are uncertain, auth rejection is definite, secret never echoed', async () => {
  await withFetch([() => { throw new Error('network timeout secret token'); }], async () => { await assert.rejects(() => run('x', { accessToken: 'secret' }), (e: any) => e instanceof ConnectorError && e.uncertain && !e.retryable && !e.message.includes('token')); });
  await withFetch([() => json({ secret: 'token' }, 503)], async () => { await assert.rejects(() => run('x', { accessToken: 'secret' }), (e: any) => e instanceof ConnectorError && e.uncertain); });
  await withFetch([() => json({ secret: 'token' }, 401)], async () => { await assert.rejects(() => run('x', { accessToken: 'secret' }), (e: any) => e instanceof ConnectorError && !e.uncertain && !e.message.includes('token')); });
  await withFetch([() => json({ data: { id: 'scheduled' } }, 202)], async () => { assert.equal((await run('x', { accessToken: 'secret' })).status, 'unconfirmed'); });
});

test('invalid credentials, disabled connections, and mismatched content are rejected before network', async () => {
  await withFetch([], async () => {
    const c = connection('x', { accessToken: 'secret' });
    await assert.rejects(() => publish({ ...c, enabled: false }, platformById('x'), variant('x'), [], context), /停用/);
    await assert.rejects(() => publish(c, platformById('x'), variant('reddit'), [], context), /不匹配/);
    await assert.rejects(() => run('x', {}), /Access Token/);
  });
});
