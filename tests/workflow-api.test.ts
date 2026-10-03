import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { Store } from '../server/storage.js';
import { revision, uid } from '../server/domain.js';
import type { ConnectorService } from '../server/queue.js';
import type { Bootstrap, Connection, Content, Job, JobStatus, Variant } from '../server/types.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function aiReply(ids: string[]) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ variants: ids.map(platformId => ({ platformId, title: 'Generated title', body: 'Generated substantive text', tags: [], thread: [] })) }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'creator-workflow-'));
  const store = new Store(dir);
  const networkFetch = globalThis.fetch;
  let checks = 0; let publishes = 0;
  let check: ConnectorService['testConnection'] = async () => ({ ok: true, message: 'Mock read-only result' });
  const connectors: ConnectorService = {
    getConnectorDefinitions: ps => [
      ...ps.map(p => ({ id: `native:${p.id}`, name: 'Mock only', description: 'No remote network', platformIds: [p.id], fields: [{ key: 'accessToken', label: 'Token', secret: true, required: true }, { key: 'setting', label: 'Setting' }], mode: 'publish' as const })),
      { id: 'multipost', name: 'Mock bridge', description: 'Mock only', platformIds: ps.map(p => p.id), fields: [], mode: 'bridge' },
      { id: 'webhook', name: 'Mock webhook', description: 'Mock only', platformIds: ps.map(p => p.id), fields: [{ key: 'url', label: 'URL', required: true, secret: true }, { key: 'healthUrl', label: 'Health URL' }, { key: 'apiKey', label: 'Token', secret: true }], mode: 'custom' },
    ],
    validateConnection: c => c.connector === 'multipost' ? [] : c.connector === 'webhook' ? c.config.url ? [] : ['URL missing'] : c.config.accessToken ? [] : ['Token missing'],
    testConnection: async (c, p) => { checks++; return check(c, p); },
    publish: async () => { publishes++; return { status: 'unconfirmed', message: 'Mock receipt only', remoteId: `mock-${publishes}` }; },
  };
  const instance = createApp({ store, connectors, startQueue: false });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function api(path: string, method = 'GET', body?: unknown) {
    // Retain the real loopback fetch even while the AI provider fetch is mocked.
    const response = await networkFetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function content(profileId?: string): Promise<Content> {
    return (await api('/contents', 'POST', { title: 'Original title', source: 'Original substantive text', profileId, media: [] })).body;
  }
  async function generate(c: Content, ids = ['reddit'], extra: Record<string, unknown> = {}): Promise<Variant[]> {
    const result = await api(`/contents/${c.id}/generate`, 'POST', { platformIds: ids, mode: 'rules', ...extra });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.variants;
  }
  async function connection(platformId = 'reddit', connector = 'native', config: Record<string, string> = { accessToken: 'private-test-token' }): Promise<Connection> {
    const result = await api('/connections', 'POST', { name: 'Mock account', platformId, connector, config });
    assert.equal(result.status, 201);
    return result.body;
  }
  async function approve(v: Variant) {
    const result = await api(`/variants/${v.id}`, 'PUT', { approved: true });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body as Variant;
  }
  async function scheduled(c: Content, v: Variant, channel: Connection): Promise<Job> {
    const result = await api('/jobs', 'POST', { contentId: c.id, targets: [{ variantId: v.id, connectionId: channel.id }], scheduledAt: new Date(Date.now() + 120_000).toISOString() });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.jobs[0];
  }
  async function bootstrap(): Promise<Bootstrap> { return (await api('/bootstrap')).body; }
  async function enableAI(handler: typeof fetch) {
    await api('/settings', 'PUT', { generation: { enabled: true, baseUrl: 'https://llm.invalid/v1', model: 'mock-model', apiKey: 'private-ai-token' } });
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://llm.invalid/v1/chat/completions', 'Only the mock AI provider may receive non-loopback fetches');
      return handler(url, init);
    };
  }
  return { api, store, content, generate, connection, approve, scheduled, bootstrap, enableAI, queue: instance.queue, checks: () => checks, publishes: () => publishes, setCheck: (value: ConnectorService['testConnection']) => { check = value; }, async close() { globalThis.fetch = networkFetch; instance.queue.stop(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('existing versions require explicit replacement and remain unchanged on conflict', async () => {
  const f = await fixture();
  try {
    const c = await f.content(); const [reddit, zhihu] = await f.generate(c, ['reddit', 'zhihu']);
    await f.api(`/variants/${reddit.id}`, 'PUT', { body: 'Carefully edited manual version' });
    await f.approve(reddit);
    const before = (await f.bootstrap()).variants;
    let providerCalls = 0;
    await f.enableAI(async () => { providerCalls++; return aiReply(['reddit']); });
    for (const extra of [{}, { replaceExisting: false }]) {
      const result = await f.api(`/contents/${c.id}/generate`, 'POST', { platformIds: ['reddit', 'wechat'], mode: 'ai', ...extra });
      assert.equal(result.status, 409); assert.deepEqual((await f.bootstrap()).variants, before);
    }
    assert.equal(providerCalls, 0, 'Conflicts are checked before spending an AI request');
    const [newReddit] = await f.generate(c, ['reddit'], { replaceExisting: true });
    assert.notEqual(newReddit.id, reddit.id); assert.equal(newReddit.approved, false);
    const after = (await f.bootstrap()).variants;
    assert.equal(after.some(v => v.id === reddit.id), false);
    assert.deepEqual(after.find(v => v.id === zhihu.id), before.find(v => v.id === zhihu.id));
  } finally { await f.close(); }
});

test('delayed regeneration cannot overwrite a manual edit made after its baseline', async () => {
  const f = await fixture(); const started = deferred<void>(); const reply = deferred<Response>();
  try {
    const c = await f.content(); const [v] = await f.generate(c);
    await f.enableAI(async () => { started.resolve(); return reply.promise; });
    const pending = f.api(`/contents/${c.id}/generate`, 'POST', { platformIds: ['reddit'], mode: 'ai', replaceExisting: true });
    await started.promise;
    const edit = await f.api(`/variants/${v.id}`, 'PUT', { body: 'Latest manual edit must survive' });
    reply.resolve(aiReply(['reddit']));
    const result = await pending;
    assert.equal(result.status, 409); assert.match(result.body.error, /平台版本发生变化/);
    assert.deepEqual((await f.bootstrap()).variants.find(item => item.id === v.id), edit.body);
  } finally { reply.resolve(aiReply(['reddit'])); await f.close(); }
});

test('generation of a missing target refuses to replace a concurrently created version', async () => {
  const f = await fixture(); const started = deferred<void>(); const reply = deferred<Response>();
  try {
    const c = await f.content();
    await f.enableAI(async () => { started.resolve(); return reply.promise; });
    const pending = f.api(`/contents/${c.id}/generate`, 'POST', { platformIds: ['reddit'], mode: 'ai' });
    await started.promise;
    const [newVersion] = await f.generate(c);
    reply.resolve(aiReply(['reddit']));
    assert.equal((await pending).status, 409);
    assert.deepEqual((await f.bootstrap()).variants, [newVersion]);
  } finally { reply.resolve(aiReply(['reddit'])); await f.close(); }
});

test('failed later AI batches never remove existing platform versions', async () => {
  const f = await fixture();
  try {
    const c = await f.content(); const ids = ['x', 'reddit', 'zhihu', 'wechat', 'linkedin', 'threads', 'wordpress'];
    await f.generate(c, ids); const before = (await f.bootstrap()).variants; let calls = 0;
    await f.enableAI(async (_url, init) => {
      calls++; if (calls === 2) return new Response('Mock failure', { status: 503 });
      const prompt = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      return aiReply(prompt.platforms.map((p: { id: string }) => p.id));
    });
    const result = await f.api(`/contents/${c.id}/generate`, 'POST', { platformIds: ids, mode: 'ai', replaceExisting: true });
    assert.equal(result.status, 400); assert.match(result.body.error, /503/); assert.equal(calls, 2);
    assert.deepEqual((await f.bootstrap()).variants, before);
  } finally { await f.close(); }
});

test('generation also rejects a profile change while the provider is working', async () => {
  const f = await fixture(); const started = deferred<void>(); const reply = deferred<Response>();
  try {
    const profile = (await f.api('/profiles', 'POST', { name: 'Original profile', tone: 'Natural', language: '中文' })).body;
    const c = await f.content(profile.id);
    await f.enableAI(async () => { started.resolve(); return reply.promise; });
    const pending = f.api(`/contents/${c.id}/generate`, 'POST', { platformIds: ['reddit'], mode: 'ai' });
    await started.promise;
    await f.api(`/profiles/${profile.id}`, 'PUT', { name: 'Changed profile', tone: 'Formal', language: '中文' });
    reply.resolve(aiReply(['reddit']));
    const result = await pending;
    assert.equal(result.status, 409); assert.match(result.body.error, /创作画像/);
    assert.equal((await f.bootstrap()).variants.length, 0);
  } finally { reply.resolve(aiReply(['reddit'])); await f.close(); }
});

test('explicit rebase preserves wording, revokes approval, and requires a separate review', async () => {
  const f = await fixture();
  try {
    const c = await f.content(); const [v] = await f.generate(c, ['zhihu']); await f.approve(v);
    const current = (await f.api(`/contents/${c.id}`, 'PUT', { title: c.title, source: 'Updated original source', media: [] })).body as Content;
    assert.equal((await f.api(`/variants/${v.id}`, 'PUT', { approved: true })).status, 400);
    const unchanged = await f.api(`/variants/${v.id}`, 'PUT', { title: v.title, body: v.body });
    assert.equal(unchanged.body.sourceRevision, v.sourceRevision);
    assert.ok(unchanged.body.issues.some((issue: { message: string }) => issue.message.includes('原稿已修改')));
    const result = await f.api(`/variants/${v.id}`, 'PUT', { rebase: true, approved: true });
    assert.equal(result.status, 200); assert.equal(result.body.approved, false);
    assert.equal(result.body.sourceRevision, revision(current));
    assert.equal(result.body.body, v.body); assert.equal(result.body.title, v.title); assert.deepEqual(result.body.tags, v.tags);
    assert.equal(Object.hasOwn(result.body, 'rebase'), false);
    assert.equal(result.body.issues.some((issue: { severity: string }) => issue.severity === 'error'), false);
    assert.equal((await f.approve(result.body)).approved, true);
    const profile = (await f.api('/profiles', 'POST', { name: 'Forbidden profile', forbiddenWords: ['Original'] })).body;
    await f.api(`/contents/${c.id}`, 'PUT', { title: c.title, source: current.source, profileId: profile.id, media: [] });
    const invalid = await f.api(`/variants/${v.id}`, 'PUT', { rebase: true });
    assert.ok(invalid.body.issues.some((issue: { message: string }) => issue.message.includes('禁用词')));
    assert.equal((await f.api(`/variants/${v.id}`, 'PUT', { approved: true })).status, 400);
  } finally { await f.close(); }
});

test('active task uniqueness survives regeneration while scheduled snapshots stay immutable', async () => {
  const f = await fixture();
  try {
    const c = await f.content(); const [original] = await f.generate(c); const approved = await f.approve(original); const channel = await f.connection();
    const job = await f.scheduled(c, approved, channel);
    await f.api(`/contents/${c.id}`, 'PUT', { title: 'Changed title', source: 'Changed original content', media: [] });
    const [newVersion] = await f.generate(c, ['reddit'], { replaceExisting: true }); await f.approve(newVersion);
    assert.deepEqual(f.store.get<Job>('job', job.id)?.snapshot, approved);
    const request = { contentId: c.id, targets: [{ variantId: newVersion.id, connectionId: channel.id }], scheduledAt: new Date(Date.now() + 120_000).toISOString() };
    for (const status of ['queued', 'scheduled', 'running', 'needs_action', 'unconfirmed'] as JobStatus[]) {
      f.store.put('job', { ...job, status, scheduledAt: new Date(Date.now() + 120_000).toISOString() });
      assert.equal((await f.api('/jobs', 'POST', request)).status, 409, status);
    }
    const otherChannel = await f.connection(); await f.scheduled(c, newVersion, otherChannel);
    for (const status of ['published', 'drafted', 'failed', 'cancelled'] as JobStatus[]) {
      f.store.put('job', { ...job, status });
      const result = await f.api('/jobs', 'POST', request);
      assert.equal(result.status, 201, status);
      f.store.put('job', { ...result.body.jobs[0], status: 'cancelled' });
    }
    assert.equal(f.publishes(), 0, 'All schedules are in the future; no remote publishes occur');
  } finally { await f.close(); }
});

test('retry excludes its own uncertain job but blocks other active versions of the same target', async () => {
  const f = await fixture();
  try {
    const c = await f.content(); const [v] = await f.generate(c); await f.approve(v); const channel = await f.connection();
    const original = await f.scheduled(c, v, channel);
    f.store.put('job', { ...original, status: 'unconfirmed' });
    const result = await f.api(`/jobs/${original.id}/retry`, 'POST', {});
    assert.equal(result.status, 201); assert.notEqual(result.body.id, original.id);
    await f.queue.tick();
    assert.equal(f.publishes(), 1); assert.equal(f.store.get<Job>('job', result.body.id)?.status, 'unconfirmed');
    assert.equal((await f.api(`/jobs/${original.id}/retry`, 'POST', {})).status, 409);
    f.store.put('job', { ...result.body, status: 'failed' });
    const blockerId = uid();
    for (const status of ['queued', 'scheduled', 'running', 'needs_action', 'unconfirmed'] as JobStatus[]) {
      f.store.put('job', { ...original, id: blockerId, variantId: uid(), status, scheduledAt: new Date(Date.now() + 120_000).toISOString() });
      assert.equal((await f.api(`/jobs/${original.id}/retry`, 'POST', {})).status, 409, status);
    }
    assert.equal(f.publishes(), 1);
    f.store.remove('job', blockerId);
  } finally { await f.close(); }
});

test('connection checks persist success, validation failures, and exceptions without exposing credentials', async () => {
  const f = await fixture();
  try {
    const channel = await f.connection(); assert.equal(channel.lastTest, undefined); assert.equal(f.checks(), 0);
    const first = await f.api(`/connections/${channel.id}/test`, 'POST', {});
    assert.equal(first.status, 200); assert.equal(first.body.ok, true); assert.equal(first.body.scope, 'credentials');
    assert.ok(Number.isFinite(Date.parse(first.body.at)));
    assert.deepEqual((await f.bootstrap()).connections.find(c => c.id === channel.id)?.lastTest, first.body);
    f.setCheck(async c => ({ ok: false, message: `Mock 401: ${c.config.accessToken}` }));
    const failed = await f.api(`/connections/${channel.id}/test`, 'POST', {});
    assert.equal(failed.body.ok, false); assert.match(failed.body.message, /已隐藏/);
    assert.deepEqual((await f.bootstrap()).connections.find(c => c.id === channel.id)?.lastTest, failed.body);
    f.setCheck(async () => { throw new Error('Mock rejected Bearer private-test-token'); });
    const thrown = await f.api(`/connections/${channel.id}/test`, 'POST', {});
    assert.equal(thrown.status, 200); assert.equal(thrown.body.ok, false);
    assert.equal(JSON.stringify((await f.bootstrap()).connections).includes('private-test-token'), false);
    assert.equal(JSON.stringify(f.store.get('connection', channel.id)).includes('private-test-token'), false);
    const incomplete = await f.connection('x', 'native', {}); const checks = f.checks();
    const invalid = await f.api(`/connections/${incomplete.id}/test`, 'POST', {});
    assert.equal(invalid.body.ok, false); assert.match(invalid.body.message, /Token missing/); assert.equal(f.checks(), checks);
    assert.deepEqual((await f.bootstrap()).connections.find(c => c.id === incomplete.id)?.lastTest, invalid.body);
    const webhook = await f.connection('reddit', 'webhook', { url: 'https://mock.invalid/publish?secret=webhook-private' });
    f.setCheck(async c => ({ ok: false, message: `Cannot reach ${c.config.url}` }));
    const urlError = await f.api(`/connections/${webhook.id}/test`, 'POST', {});
    assert.equal(urlError.body.ok, false); assert.match(urlError.body.message, /已隐藏/);
    assert.equal(JSON.stringify(f.store.get('connection', webhook.id)).includes('webhook-private'), false, 'Secret URL fields are redacted even when their key is simply url');
  } finally { await f.close(); }
});

test('configuration-only checks are distinguished and account changes invalidate persisted checks', async () => {
  const f = await fixture();
  try {
    for (const platformId of ['slack', 'feishu', 'dingtalk', 'wecom', 'teams']) {
      const c = await f.connection(platformId);
      assert.equal((await f.api(`/connections/${c.id}/test`, 'POST', {})).body.scope, 'configuration', platformId);
    }
    const bridge = await f.connection('reddit', 'multipost', {});
    assert.equal((await f.api(`/connections/${bridge.id}/test`, 'POST', {})).body.scope, 'configuration');
    const webhook = await f.connection('reddit', 'webhook', { url: 'https://mock.invalid/publish' });
    assert.equal((await f.api(`/connections/${webhook.id}/test`, 'POST', {})).body.scope, 'configuration');
    const health = await f.api(`/connections/${webhook.id}`, 'PUT', { name: webhook.name, platformId: 'reddit', connector: 'webhook', config: { healthUrl: 'https://mock.invalid/health' } });
    assert.equal(health.body.lastTest, undefined);
    assert.equal((await f.api(`/connections/${webhook.id}/test`, 'POST', {})).body.scope, 'credentials');
    const c = await f.connection(); const lastTest = (await f.api(`/connections/${c.id}/test`, 'POST', {})).body;
    const rename = await f.api(`/connections/${c.id}`, 'PUT', { name: 'Renamed', platformId: 'reddit', connector: 'native', enabled: false, config: { accessToken: '' } });
    assert.deepEqual(rename.body.lastTest, lastTest);
    const changed = await f.api(`/connections/${c.id}`, 'PUT', { name: 'Renamed', platformId: 'reddit', connector: 'native', config: { setting: 'changed' } });
    assert.equal(changed.body.lastTest, undefined);
    await f.api(`/connections/${c.id}/test`, 'POST', {});
    const moved = await f.api(`/connections/${c.id}`, 'PUT', { name: 'Moved', platformId: 'x', connector: 'native', config: { accessToken: 'replacement-token' } });
    assert.equal(moved.body.lastTest, undefined);
  } finally { await f.close(); }
});

test('an old async connection check cannot mark changed account credentials as checked', async () => {
  const f = await fixture(); const started = deferred<void>(); const reply = deferred<{ ok: boolean; message: string }>();
  try {
    const c = await f.connection();
    f.setCheck(async () => { started.resolve(); return reply.promise; });
    const pending = f.api(`/connections/${c.id}/test`, 'POST', {});
    await started.promise;
    await f.api(`/connections/${c.id}`, 'PUT', { name: c.name, platformId: c.platformId, connector: c.connector, config: { accessToken: 'new-private-token' } });
    reply.resolve({ ok: true, message: 'Old token was accepted' });
    assert.equal((await pending).status, 409);
    const current = (await f.bootstrap()).connections.find(item => item.id === c.id);
    assert.equal(current?.lastTest, undefined);
  } finally { reply.resolve({ ok: true, message: 'Mock cleanup' }); await f.close(); }
});
