import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';
import { Store } from '../server/storage.js';
import type { ConnectorService } from '../server/queue.js';
import type { Job, JobStatus } from '../server/types.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'creator-connection-security-'));
  const store = new Store(dir);
  let publishCalls = 0;
  const connectors: ConnectorService = {
    getConnectorDefinitions: () => [
      { id: 'multipost', name: 'Mock bridge', description: 'Mock only', platformIds: ['reddit'], fields: [], mode: 'bridge' },
      ...['reddit', 'x'].map(id => ({ id: `native:${id}`, name: 'Mock native', description: 'Mock only', platformIds: [id], fields: [{ key: 'accessToken', label: 'Token', secret: true, required: true }, { key: 'subreddit', label: 'Subreddit' }], mode: 'publish' as const })),
    ],
    validateConnection: c => c.connector === 'multipost' || c.config.accessToken ? [] : ['Token missing'],
    testConnection: async () => ({ ok: true, message: 'Mock' }),
    publish: async () => { publishCalls++; return { status: 'published', message: 'Mock only', remoteId: 'mock' }; },
  };
  const instance = createApp({ store, connectors, startQueue: false });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  }
  async function scheduled(connector: string, config: Record<string, string>) {
    const content = (await api('/contents', 'POST', { title: 'Title', source: 'Substantive text', media: [] })).body;
    const generated = (await api(`/contents/${content.id}/generate`, 'POST', { platformIds: ['reddit'], mode: 'rules' })).body;
    const variant = generated.variants[0];
    assert.equal((await api(`/variants/${variant.id}`, 'PUT', { approved: true })).status, 200);
    const connection = (await api('/connections', 'POST', { name: 'Original', platformId: 'reddit', connector, config })).body;
    const result = await api('/jobs', 'POST', { contentId: content.id, targets: [{ variantId: variant.id, connectionId: connection.id }], scheduledAt: new Date(Date.now() + 120_000).toISOString() });
    assert.equal(result.status, 201);
    return { connection, job: result.body.jobs[0] as Job };
  }
  return { api, store, scheduled, port, calls: () => publishCalls, async close() { instance.queue.stop(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('pending MultiPost work cannot silently switch to direct API publishing', async () => {
  const f = await fixture();
  try {
    const { connection, job } = await f.scheduled('multipost', {});
    for (const status of ['queued', 'scheduled', 'running', 'needs_action', 'unconfirmed'] as JobStatus[]) {
      f.store.put('job', { ...job, status });
      const switched = await f.api(`/connections/${connection.id}`, 'PUT', { name: 'Changed', platformId: 'reddit', connector: 'native', config: { accessToken: 'new-secret' } });
      assert.equal(switched.status, 409, status);
      const current = (await f.api('/bootstrap')).body.connections.find((c: any) => c.id === connection.id);
      assert.equal(current.connector, 'multipost'); assert.equal(current.name, 'Original');
    }
    assert.equal(f.calls(), 0);
    f.store.put('job', { ...job, status: 'cancelled' });
    assert.equal((await f.api(`/connections/${connection.id}`, 'PUT', { name: 'Changed', platformId: 'reddit', connector: 'native', config: { accessToken: 'new-secret' } })).status, 200);
  } finally { await f.close(); }
});

test('active account config is immutable while rename, enablement, and retained blank secrets work', async () => {
  const f = await fixture();
  try {
    const { connection, job } = await f.scheduled('native', { accessToken: 'original-secret', subreddit: 'test' });
    for (const config of [{ accessToken: 'replacement-secret', subreddit: 'test' }, { accessToken: '', subreddit: 'another' }]) {
      const edited = await f.api(`/connections/${connection.id}`, 'PUT', { name: 'Original', platformId: 'reddit', connector: 'native', config });
      assert.equal(edited.status, 409);
    }
    const moved = await f.api(`/connections/${connection.id}`, 'PUT', { name: 'Moved', platformId: 'x', connector: 'native', config: { accessToken: 'other-secret' } });
    assert.equal(moved.status, 409);
    const renamed = await f.api(`/connections/${connection.id}`, 'PUT', { name: 'Renamed', enabled: false, platformId: 'reddit', connector: 'native:reddit', config: { subreddit: 'test', accessToken: '' } });
    assert.equal(renamed.status, 200); assert.equal(renamed.body.name, 'Renamed'); assert.equal(renamed.body.enabled, false); assert.ok(!JSON.stringify(renamed.body).includes('original-secret'));
    assert.deepEqual(f.store.getSecret(`connection:${connection.id}`), { accessToken: 'original-secret', subreddit: 'test' });
    for (const status of ['published', 'drafted', 'failed'] as JobStatus[]) {
      f.store.put('job', { ...job, status });
      assert.equal((await f.api(`/connections/${connection.id}`, 'PUT', { name: 'Renamed', platformId: 'reddit', connector: 'native', config: { accessToken: `new-${status}`, subreddit: status } })).status, 200);
    }
    assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});

test('Host parsing accepts exact loopbacks and rejects other IPv6, credentials and malformed authorities', async () => {
  const f = await fixture();
  async function hostRequest(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: f.port, path: '/api/health', headers: { Host: host } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end();
    });
  }
  try {
    for (const host of ['localhost:4318', '127.0.0.1:4318', '[::1]:4318']) assert.equal(await hostRequest(host), 200, host);
    for (const host of ['attacker.example:4318', '[2001:db8::1]:4318', '[::ffff:192.0.2.1]:4318', 'localhost:invalid', 'user@localhost:4318', 'localhost:4318/path']) assert.equal(await hostRequest(host), 403, host);
  } finally { await f.close(); }
});
