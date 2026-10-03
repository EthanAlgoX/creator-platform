import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ConnectorError, getConnectorDefinitions, publish, testConnection, validateConnection } from '../server/connectors.js';
import { platforms, platformById } from '../server/catalog.js';
import type { ConnectionPrivate, Media, PublishContext, Variant } from '../server/types.js';

const context: PublishContext = { publicBaseUrl: 'http://127.0.0.1:4318', readMedia: async () => new Uint8Array([1, 2, 3]) };
const image: Media = { id: 'i', name: 'cover.png', mime: 'image/png', url: '/uploads/cover.png', size: 3 };
const ghostSecret = '12'.repeat(32);
const configs: Record<string, Record<string, string>> = {
  ghost: { baseUrl: 'https://ghost.example', adminApiKey: `${'ab'.repeat(12)}:${ghostSecret}` },
  hashnode: { accessToken: 'hashnode-secret', publicationId: 'abcdef123456abcdef123456' },
  misskey: { baseUrl: 'https://misskey.example', accessToken: 'misskey-secret' },
  lemmy: { baseUrl: 'https://lemmy.example', accessToken: 'lemmy-secret', communityId: '42' },
  blogger: { accessToken: 'blogger-secret', blogId: '123456789' },
};
function connection(id: string, extras: Record<string, string> = {}): ConnectionPrivate { return { id: 'connection', name: 'Mock account', platformId: id, connector: 'native', enabled: true, config: { ...configs[id], ...extras } }; }
function variant(platformId: string): Variant { return { id: 'variant', contentId: 'content', platformId, title: 'Title', body: 'Body', tags: ['api'], thread: [], issues: [], approved: true, source: 'manual', updatedAt: '2026-10-03T00:00:00Z' }; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const payload = (init: RequestInit) => JSON.parse(String(init.body));
const headers = (init: RequestInit) => new Headers(init.headers);
type Step = (url: string, init: RequestInit) => Response | Promise<Response>;
async function mock<T>(steps: Step[], callback: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (input, init = {}) => { const step = steps[calls++]; assert.ok(step, `Unexpected network call ${String(input)}; live publishing disabled`); return step(String(input), init); };
  try { const result = await callback(); assert.equal(calls, steps.length); return result; } finally { globalThis.fetch = original; }
}
const run = (id: string, extras: Record<string, string> = {}, media: Media[] = []) => publish(connection(id, extras), platformById(id), variant(id), media, context);
function checkGhostJwt(init: RequestInit) {
  assert.equal(headers(init).get('Accept-Version'), 'v5.0');
  const authorization = headers(init).get('Authorization')!; assert.ok(authorization.startsWith('Ghost '));
  const [header, body, signature] = authorization.slice(6).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'HS256', typ: 'JWT', kid: 'ab'.repeat(12) });
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()); assert.equal(claims.aud, '/admin/'); assert.equal(claims.exp - claims.iat, 300); assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 2);
  assert.equal(signature, createHmac('sha256', Buffer.from(ghostSecret, 'hex')).update(`${header}.${body}`).digest('base64url'));
}

test('five additional native definitions expose correct credentials and reject missing or malformed settings', () => {
  const definitions = getConnectorDefinitions(platforms);
  for (const id of Object.keys(configs)) {
    const def = definitions.find(d => d.id === `native:${id}`); assert.ok(def);
    const key = id === 'ghost' ? 'adminApiKey' : 'accessToken'; assert.equal(def.fields.find(f => f.key === key)?.secret, true);
    assert.deepEqual(validateConnection(connection(id), platformById(id)), []);
    assert.ok(validateConnection({ ...connection(id), config: {} }, platformById(id)).length);
  }
  assert.ok(validateConnection(connection('ghost', { adminApiKey: 'content-key' }), platformById('ghost')).length);
  assert.ok(validateConnection(connection('hashnode', { publicationId: 'publication-slug' }), platformById('hashnode')).length);
  for (const communityId of ['0', '-1', 'name', '9007199254740992']) assert.ok(validateConnection(connection('lemmy', { communityId }), platformById('lemmy')).length);
  assert.ok(validateConnection(connection('lemmy', { apiVersion: 'v2' }), platformById('lemmy')).length);
  assert.ok(validateConnection(connection('misskey', { visibility: 'specified' }), platformById('misskey')).length);
  assert.ok(validateConnection(connection('misskey', { cw: 'x'.repeat(101) }), platformById('misskey')).length);
  assert.ok(validateConnection(connection('blogger', { blogId: 'blog-name' }), platformById('blogger')).length);
  for (const id of ['ghost', 'hashnode', 'blogger']) assert.ok(validateConnection(connection(id, { postType: 'schedule' }), platformById(id)).length);
});

test('Ghost credential test uses authenticated posts GET and validates its signed JWT', async () => {
  await mock([(url, init) => { assert.equal(url, 'https://ghost.example/ghost/api/admin/posts/?limit=1&fields=id'); assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined); checkGhostJwt(init); return json({ posts: [] }); }], async () => { assert.equal((await testConnection(connection('ghost'), platformById('ghost'))).ok, true); });
  await mock([() => json({ site: { title: 'Public site' } })], async () => { assert.equal((await testConnection(connection('ghost'), platformById('ghost'))).ok, false); });
});

test('Ghost uploads local images and sends HTML with draft default, without newsletter actions', async () => {
  const result = await mock([
    (url, init) => { assert.equal(url, 'https://ghost.example/ghost/api/admin/images/upload/'); checkGhostJwt(init); const form = init.body as FormData; assert.ok(form.get('file') instanceof Blob); assert.equal(form.get('purpose'), 'image'); return json({ images: [{ url: 'https://ghost.example/content/images/cover.png' }] }, 201); },
    (url, init) => { assert.equal(url, 'https://ghost.example/ghost/api/admin/posts/?source=html'); checkGhostJwt(init); const p = payload(init).posts[0]; assert.equal(p.status, 'draft'); assert.equal(p.title, 'Title'); assert.match(p.html, /<p>Body<\/p>/); assert.match(p.html, /content\/images/); assert.equal(p.feature_image, 'https://ghost.example/content/images/cover.png'); assert.deepEqual(p.tags, [{ name: 'api' }]); assert.equal(p.newsletter, undefined); return json({ posts: [{ id: 'draft', status: 'draft', url: 'https://ghost.example/preview/draft/' }] }, 201); },
  ], () => run('ghost', {}, [image]));
  assert.equal(result.status, 'drafted'); assert.equal(result.remoteId, 'draft');
  await mock([(_url, init) => { assert.equal(payload(init).posts[0].status, 'published'); return json({ posts: [{ id: 'published', status: 'published', url: 'https://ghost.example/article/' }] }, 201); }], async () => { assert.equal((await run('ghost', { postType: 'publish' })).status, 'published'); });
  await mock([() => json({ posts: [{ id: 'queued', status: 'scheduled' }] })], async () => { assert.equal((await run('ghost', { postType: 'publish' })).status, 'unconfirmed'); });
});

test('Hashnode test is a GraphQL query, validates PAT and exact Publication and handles Pro errors', async () => {
  await mock([(url, init) => { assert.equal(url, 'https://gql.hashnode.com'); assert.equal(headers(init).get('Authorization'), 'Bearer hashnode-secret'); const p = payload(init); assert.ok(p.query.startsWith('query ')); assert.match(p.query, /me \{ id \}/); assert.equal(p.variables.id, configs.hashnode.publicationId); return json({ data: { me: { id: 'user' }, publication: { id: configs.hashnode.publicationId } } }); }], async () => { assert.equal((await testConnection(connection('hashnode'), platformById('hashnode'))).ok, true); });
  await mock([() => json({ errors: [{ message: 'upstream secret details', extensions: { code: 'FORBIDDEN' } }] })], async () => { const result = await testConnection(connection('hashnode'), platformById('hashnode')); assert.equal(result.ok, false); assert.match(result.message, /Pro/); assert.ok(!result.message.includes('upstream secret')); });
});

test('Hashnode saves default draft and confirms public mutation with exact variables', async () => {
  await mock([(_url, init) => { const p = payload(init); assert.match(p.query, /CreateDraftInput/); assert.deepEqual(p.variables.input, { publicationId: configs.hashnode.publicationId, title: 'Title', contentMarkdown: 'Body', tags: [{ slug: 'api' }] }); return json({ data: { createDraft: { draft: { id: 'draft' } } } }); }], async () => { assert.equal((await run('hashnode')).status, 'drafted'); });
  await mock([(_url, init) => { assert.match(payload(init).query, /PublishPostInput/); return json({ data: { publishPost: { post: { id: 'post', url: 'https://user.hashnode.dev/article' } } } }); }], async () => { const result = await run('hashnode', { postType: 'publish' }); assert.equal(result.status, 'published'); assert.equal(result.url, 'https://user.hashnode.dev/article'); });
});

test('Hashnode local image follows signed PUT then explicit confirmation before article creation', async () => {
  const result = await mock([
    (_url, init) => { const p = payload(init); assert.match(p.query, /CreateImageUploadInput/); assert.deepEqual(p.variables.input, { contentType: 'image/png' }); return json({ data: { createImageUploadURL: { presignedPut: { url: 'https://storage.example/presigned?token=storage-token', key: 'object-key', cdnUrl: 'https://cdn.hashnode.com/cover.png' } } } }); },
    (url, init) => { assert.equal(url, 'https://storage.example/presigned?token=storage-token'); assert.equal(init.method, 'PUT'); assert.equal(headers(init).get('Authorization'), null); assert.equal(headers(init).get('Content-Type'), 'image/png'); assert.ok(init.body instanceof Blob); return new Response(null, { status: 200 }); },
    (_url, init) => { const p = payload(init); assert.match(p.query, /ConfirmImageUploadInput/); assert.deepEqual(p.variables.input, { key: 'object-key' }); return json({ data: { confirmImageUpload: { ok: true, cdnUrl: 'https://cdn.hashnode.com/cover.png' } } }); },
    (_url, init) => { const p = payload(init).variables.input; assert.match(p.contentMarkdown, /cdn\.hashnode\.com\/cover\.png/); assert.deepEqual(p.coverImageOptions, { coverImageURL: 'https://cdn.hashnode.com/cover.png' }); return json({ data: { createDraft: { draft: { id: 'draft' } } } }); },
  ], () => run('hashnode', {}, [image]));
  assert.equal(result.status, 'drafted');
  await mock([], async () => { await assert.rejects(() => run('hashnode', {}, [{ ...image, size: 8 * 1024 * 1024 + 1 }]), /8 MB/); });
});

test('Hashnode unconfirmed uploads cannot create articles; unknown mutation errors stay uncertain', async () => {
  await mock([
    () => json({ data: { createImageUploadURL: { presignedPut: { url: 'https://storage.example/image', key: 'key', cdnUrl: 'https://cdn.example/image' } } } }),
    () => new Response(null, { status: 200 }),
    () => json({ data: { confirmImageUpload: { ok: false } } }),
  ], async () => { await assert.rejects(() => run('hashnode', {}, [image]), (error: any) => error instanceof ConnectorError && !error.uncertain); });
  for (const [reply, uncertain] of [
    [{ errors: [{ extensions: { code: 'FORBIDDEN' } }] }, false],
    [{ errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }, true],
    [{ data: { publishPost: { post: { id: 'possibly-created' } } }, errors: [{ extensions: { code: 'FORBIDDEN' } }] }, true],
  ] as const) await mock([() => json(reply)], async () => { await assert.rejects(() => run('hashnode', { postType: 'publish' }), (error: any) => error instanceof ConnectorError && error.uncertain === uncertain); });
});

test('Misskey current-user test is read-only even though its HTTP API uses POST', async () => {
  await mock([(url, init) => { assert.equal(url, 'https://misskey.example/api/i'); assert.deepEqual(payload(init), { i: 'misskey-secret' }); return json({ id: 'user', username: 'creator' }); }], async () => { assert.equal((await testConnection(connection('misskey'), platformById('misskey'))).ok, true); });
});

test('Misskey uploads Drive files and uses their IDs in the Note, preserving visibility and warning', async () => {
  const result = await mock([
    (url, init) => { assert.ok(url.endsWith('/api/drive/files/create')); const form = init.body as FormData; assert.equal(form.get('i'), 'misskey-secret'); assert.ok(form.get('file') instanceof Blob); assert.equal(form.get('name'), 'cover.png'); return json({ id: 'drive-file', url: 'https://misskey.example/files/cover.png' }); },
    (url, init) => { assert.ok(url.endsWith('/api/notes/create')); assert.deepEqual(payload(init), { i: 'misskey-secret', text: 'Body', visibility: 'followers', cw: 'Content warning', fileIds: ['drive-file'] }); return json({ createdNote: { id: 'note', visibility: 'followers' } }); },
  ], () => run('misskey', { visibility: 'followers', cw: 'Content warning' }, [image]));
  assert.equal(result.status, 'published'); assert.equal(result.remoteId, 'note'); assert.equal(result.url, undefined);
  await mock([], async () => { await assert.rejects(() => run('misskey', {}, Array.from({ length: 17 }, (_, i) => ({ ...image, id: String(i) }))), /16/); });
});

test('Lemmy v3/v4 tests use the correct authenticated read endpoints and numeric community', async () => {
  for (const version of ['v3', 'v4']) await mock([
    (url, init) => { assert.equal(url, `https://lemmy.example/api/${version}/${version === 'v3' ? 'site' : 'account'}`); assert.equal(init.method ?? 'GET', 'GET'); assert.equal(headers(init).get('Authorization'), 'Bearer lemmy-secret'); const local_user_view = { person: { id: 1 } }; return json(version === 'v3' ? { my_user: { local_user_view } } : { local_user_view }); },
    (url, init) => { assert.equal(url, `https://lemmy.example/api/${version}/community?id=42`); assert.equal(init.method ?? 'GET', 'GET'); return json({ community_view: { community: { id: 42 } } }); },
  ], async () => { assert.equal((await testConnection(connection('lemmy', { apiVersion: version }), platformById('lemmy'))).ok, true); });
  await mock([() => json({ site_view: { site: { name: 'Public site' } } })], async () => { assert.equal((await testConnection(connection('lemmy'), platformById('lemmy'))).ok, false); });
});

test('Lemmy creates a Markdown post, uses ap_id not external link, and never counts federation pending', async () => {
  const result = await mock([(url, init) => { assert.equal(url, 'https://lemmy.example/api/v3/post'); assert.deepEqual(payload(init), { name: 'Title', body: 'Body', community_id: 42 }); assert.equal(headers(init).get('Authorization'), 'Bearer lemmy-secret'); return json({ post_view: { post: { id: 99, ap_id: 'https://lemmy.example/post/99', url: 'https://unrelated.example/article', removed: false, deleted: false } } }); }], () => run('lemmy'));
  assert.equal(result.status, 'published'); assert.equal(result.url, 'https://lemmy.example/post/99');
  for (const fields of [{ federation_pending: true }, { scheduled_publish_time_at: '2026-11-01T00:00:00Z' }, { removed: true }, { deleted: true }]) await mock([() => json({ post_view: { post: { id: 99, ...fields } } })], async () => { assert.equal((await run('lemmy', { apiVersion: 'v4' })).status, 'unconfirmed'); });
  await mock([], async () => { await assert.rejects(() => run('lemmy', {}, [image]), /公网/); });
});

test('Blogger user and exact owned/accessed blog are checked without creating any post', async () => {
  await mock([
    (url, init) => { assert.equal(url, 'https://www.googleapis.com/blogger/v3/users/self'); assert.equal(init.method ?? 'GET', 'GET'); assert.equal(headers(init).get('Authorization'), 'Bearer blogger-secret'); return json({ id: 'user' }); },
    (url, init) => { assert.ok(url.endsWith('/users/self/blogs')); assert.equal(init.method ?? 'GET', 'GET'); return json({ items: [{ id: '123456789' }] }); },
  ], async () => { assert.equal((await testConnection(connection('blogger'), platformById('blogger'))).ok, true); });
  await mock([() => json({ id: 'user' }), () => json({ items: [{ id: 'wrong-blog' }] })], async () => { assert.equal((await testConnection(connection('blogger'), platformById('blogger'))).ok, false); });
});

test('Blogger isDraft flag and HTML are exact, returned status controls outcome', async () => {
  const media = { ...image, url: 'https://images.example/cover.png' };
  for (const [postType, status, expected] of [['draft', 'DRAFT', 'drafted'], ['publish', 'LIVE', 'published'], ['publish', 'SCHEDULED', 'unconfirmed']] as const) await mock([(url, init) => {
    const endpoint = new URL(url); assert.equal(endpoint.pathname, '/blogger/v3/blogs/123456789/posts'); assert.equal(endpoint.searchParams.get('isDraft'), String(postType === 'draft'));
    const p = payload(init); assert.equal(p.kind, 'blogger#post'); assert.equal(p.title, 'Title'); assert.match(p.content, /<p>Body<\/p>/); assert.match(p.content, /images\.example\/cover\.png/); assert.deepEqual(p.labels, ['api']);
    return json({ id: 'post', status, url: 'https://blog.blogspot.com/article.html', blog: { id: '123456789' } });
  }], async () => { assert.equal((await run('blogger', { postType }, [media])).status, expected); });
  await mock([() => json({ id: 'post', published: '2026-10-03T00:00:00Z', url: 'https://blog.blogspot.com/article.html' })], async () => { assert.equal((await run('blogger', { postType: 'publish' })).status, 'unconfirmed'); });
  await mock([], async () => { await assert.rejects(() => run('blogger', {}, [image]), /公网/); });
});

test('all five HTTP 202 and publication timeouts remain unconfirmed, with no live retries', async () => {
  const accepted: Record<string, unknown> = {
    ghost: { posts: [{ id: 'accepted', status: 'published' }] },
    hashnode: { data: { publishPost: { post: { id: 'accepted', url: 'https://example.com/post' } } } },
    misskey: { createdNote: { id: 'accepted' } },
    lemmy: { post_view: { post: { id: 99 } } },
    blogger: { id: 'accepted', status: 'LIVE' },
  };
  for (const id of Object.keys(configs)) {
    const extras: Record<string, string> = ['ghost', 'hashnode', 'blogger'].includes(id) ? { postType: 'publish' } : {};
    await mock([() => json(accepted[id], 202)], async () => { assert.equal((await run(id, extras)).status, 'unconfirmed', id); });
    await mock([() => { throw new Error('upstream timeout secret'); }], async () => { await assert.rejects(() => run(id, extras), (error: any) => error instanceof ConnectorError && error.uncertain && !error.retryable && !error.message.includes('secret')); });
  }
});
