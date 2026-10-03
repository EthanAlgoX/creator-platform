import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { Store } from '../server/storage.js';
import type { ConnectorService } from '../server/queue.js';
import type { Job } from '../server/types.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'creator-bridge-api-'));
  const store = new Store(dir); let handoffJobs = 0;
  const connectors: ConnectorService = {
    getConnectorDefinitions: () => [{ id: 'multipost', name: 'Mock bridge only', description: 'No real browser or network', platformIds: ['reddit'], fields: [], mode: 'bridge' }],
    validateConnection: () => [], testConnection: async () => ({ ok: true, message: 'Configuration only' }),
    publish: async () => { handoffJobs++; return { status: 'needs_action', message: 'Waiting for foreground browser handoff' }; },
  };
  const instance = createApp({ store, connectors, startQueue: false });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function pendingJob(): Promise<Job> {
    const content = (await api('/contents', 'POST', { title: 'Reviewed title', source: 'Substantive reviewed content', media: [] })).body;
    const variant = (await api(`/contents/${content.id}/generate`, 'POST', { platformIds: ['reddit'], mode: 'rules' })).body.variants[0];
    await api(`/variants/${variant.id}`, 'PUT', { approved: true });
    const connection = (await api('/connections', 'POST', { name: 'Mock browser channel', platformId: 'reddit', connector: 'multipost', config: {} })).body;
    const result = await api('/jobs', 'POST', { contentId: content.id, targets: [{ variantId: variant.id, connectionId: connection.id }] });
    assert.equal(result.status, 201);
    await instance.queue.tick();
    const job = store.get<Job>('job', result.body.jobs[0].id)!;
    assert.equal(job.status, 'needs_action');
    return job;
  }
  return { api, store, pendingJob, queue: instance.queue, handoffs: () => handoffJobs, async close() { instance.queue.stop(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('browser receipts distinguish accepted handoff, definite refusal, and uncertain delivery', async () => {
  const f = await fixture();
  try {
    for (const [outcome, status] of [['dispatched', 'needs_action'], ['failed', 'failed'], ['unconfirmed', 'unconfirmed']] as const) {
      const job = await f.pendingJob();
      const result = await f.api(`/jobs/${job.id}/bridge`, 'POST', { outcome });
      assert.equal(result.status, 200); assert.equal(result.body.status, status);
      assert.notEqual(result.body.status, 'published');
      assert.equal(f.store.get<Job>('job', job.id)?.status, status);
      if (outcome === 'unconfirmed') assert.match(result.body.message, /不要重复交接/);
    }
    assert.equal(f.handoffs(), 3, 'Only the original local jobs run; bridge receipts never publish');
  } finally { await f.close(); }
});

test('unknown handoff cannot be casually resent or cancelled and never auto-retries', async () => {
  const f = await fixture();
  try {
    const job = await f.pendingJob();
    const unknown = await f.api(`/jobs/${job.id}/bridge`, 'POST', { outcome: 'unconfirmed', message: 'Timed out; check the extension before another send' });
    assert.equal(unknown.body.status, 'unconfirmed');
    assert.equal((await f.api(`/jobs/${job.id}/bridge`, 'POST', { outcome: 'dispatched' })).status, 409);
    assert.equal((await f.api(`/jobs/${job.id}/cancel`, 'POST', {})).status, 409);
    await f.queue.tick(); await f.queue.tick();
    assert.equal(f.handoffs(), 1); assert.equal(f.store.get<Job>('job', job.id)?.status, 'unconfirmed');
    const confirmed = await f.api(`/jobs/${job.id}/confirm`, 'POST', { outcome: 'drafted', message: 'Found the draft in the platform' });
    assert.equal(confirmed.status, 200); assert.equal(confirmed.body.status, 'drafted');
    assert.equal(f.handoffs(), 1, 'Manual confirmation only records the checked result');
  } finally { await f.close(); }
});

test('bridge receipt validation preserves the pending task on unsupported outcomes', async () => {
  const f = await fixture();
  try {
    const job = await f.pendingJob();
    assert.equal((await f.api(`/jobs/${job.id}/bridge`, 'POST', { outcome: 'published' })).status, 400);
    assert.equal(f.store.get<Job>('job', job.id)?.status, 'needs_action');
    const rejected = await f.api(`/jobs/${job.id}/bridge`, 'POST', { outcome: 'failed', message: 'Trust domain was explicitly refused before forwarding' });
    assert.equal(rejected.body.status, 'failed');
    assert.equal((await f.api(`/jobs/${job.id}/bridge`, 'POST', { outcome: 'unconfirmed' })).status, 409);
    assert.equal(f.handoffs(), 1);
  } finally { await f.close(); }
});
