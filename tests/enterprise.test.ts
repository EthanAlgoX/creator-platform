import test from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseConnectorError, getEnterpriseDefinitions, isEnterprisePlatform, publishEnterprise, testEnterprise, validateEnterprise } from '../server/enterprise.js';
import type { ConnectionPrivate, Media, Platform, PublishContext, Variant } from '../server/types.js';

const endpoints = {
  feishu: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook',
  dingtalk: 'https://oapi.dingtalk.com/robot/send?access_token=private-token',
  wecom: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=private-key',
  teams: 'https://defaulttenant.eu.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/flow-id/triggers/manual/paths/invoke?api-version=1&sig=private-signature',
};
type Id = keyof typeof endpoints;
function platform(id: string): Platform { return { id, name: id, shortName: id, region: 'domestic', category: 'social', color: '#000', description: '', titleLimit: 100, bodyLimit: 20000, formats: ['text'], recommendedTone: '', notes: [] }; }
function connection(id: Id, extra: Record<string, string> = {}): ConnectionPrivate { return { id: 'c', name: 'bot', platformId: id, connector: 'native', enabled: true, config: { webhookUrl: endpoints[id], ...extra } }; }
function variant(id: Id, change: Partial<Variant> = {}): Variant { return { id: 'v', contentId: 'content', platformId: id, title: '标题', body: '中文 body', tags: [], thread: [], source: 'manual', issues: [], approved: true, updatedAt: '2026-10-03T00:00:00Z', ...change }; }
const context: PublishContext = { publicBaseUrl: 'http://127.0.0.1:4318', readMedia: async () => { throw new Error('Media must not be read'); } };
const image: Media = { id: 'm', name: 'photo.png', mime: 'image/png', size: 3, url: '/uploads/photo.png' };
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function payload(init: RequestInit): any { return JSON.parse(String(init.body)); }
type RequestStep = (url: string, init: RequestInit) => Response | Promise<Response>;
async function withFetch<T>(steps: RequestStep[], run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const step = steps[calls++];
    assert.ok(step, 'Unexpected network request (real network disabled)');
    return step(String(input), init);
  };
  try { const result = await run(); assert.equal(calls, steps.length); return result; }
  finally { globalThis.fetch = original; }
}
function run(id: Id, config: Record<string, string> = {}, change: Partial<Variant> = {}, media: Media[] = [], ctx = context) { return publishEnterprise(connection(id, config), platform(id), variant(id, change), media, ctx); }
function error(uncertain: boolean): (e: unknown) => boolean { return e => e instanceof EnterpriseConnectorError && e.uncertain === uncertain; }

test('enterprise definitions are specific and secret fields are marked', () => {
  assert.deepEqual(getEnterpriseDefinitions(Object.keys(endpoints).map(platform)).map(d => d.id), ['native:feishu', 'native:dingtalk', 'native:wecom', 'native:teams']);
  assert.deepEqual(getEnterpriseDefinitions([platform('feishu')]).map(d => d.id), ['native:feishu']);
  for (const d of getEnterpriseDefinitions(Object.keys(endpoints).map(platform))) assert.equal(d.fields.find(f => f.key === 'webhookUrl')?.secret, true);
  assert.equal(getEnterpriseDefinitions([platform('feishu')])[0].fields.find(f => f.key === 'secret')?.secret, true);
  assert.equal(isEnterprisePlatform('teams'), true);
  assert.equal(isEnterprisePlatform('wechat'), false);
});

test('official webhook hosts, unique credentials and optional signing configuration are validated', () => {
  for (const id of Object.keys(endpoints) as Id[]) assert.deepEqual(validateEnterprise(connection(id), platform(id)), []);
  const invalid: [Id, string][] = [
    ['feishu', 'https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/token'],
    ['feishu', 'http://open.feishu.cn/open-apis/bot/v2/hook/token'],
    ['feishu', 'https://user:password@open.feishu.cn/open-apis/bot/v2/hook/token'],
    ['feishu', endpoints.feishu + '#secret'],
    ['dingtalk', 'https://oapi.dingtalk.com/robot/send'],
    ['dingtalk', endpoints.dingtalk + '&access_token=other'],
    ['dingtalk', endpoints.dingtalk + '&sign=stale&timestamp=123'],
    ['wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='],
    ['wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=one&key=two'],
    ['teams', 'https://tenant.webhook.office.com/webhookb2/legacy'],
    ['teams', endpoints.teams.replace('environment.api.powerplatform.com', 'environment.api.powerplatform.com.evil.example')],
    ['teams', endpoints.teams.replace('&sig=private-signature', '')],
  ];
  for (const [id, webhookUrl] of invalid) assert.ok(validateEnterprise(connection(id, { webhookUrl }), platform(id)).length, id);
  assert.deepEqual(validateEnterprise(connection('dingtalk', { webhookUrl: endpoints.dingtalk + '&sign=old&timestamp=1', secret: 'SEC-test' }), platform('dingtalk')), []);
  assert.ok(validateEnterprise(connection('wecom', { format: 'html' }), platform('wecom')).length);
  assert.ok(validateEnterprise(connection('teams', { authToken: 'token' }), platform('teams')).length);
  assert.ok(validateEnterprise({ ...connection('feishu'), connector: 'webhook' }, platform('feishu')).length);
});

test('Teams accepts current scale-unit URL and supported official workflow URL variants', () => {
  for (const webhookUrl of [
    endpoints.teams.replace('/direct/workflows/', '/direct/cu/20/workflows/'),
    'https://prod-1.westeurope.logic.azure.com:443/workflows/flow-id/triggers/manual/paths/invoke?api-version=2016-06-01&sig=signature',
  ]) assert.deepEqual(validateEnterprise(connection('teams', { webhookUrl }), platform('teams')), []);
});

test('all four connection checks perform local validation without any network or message', async () => {
  await withFetch([], async () => {
    for (const id of Object.keys(endpoints) as Id[]) {
      const result = await testEnterprise(connection(id), platform(id));
      assert.equal(result.ok, true);
      assert.match(result.message, /没有发送消息/);
      assert.match(result.message, /没有验证密钥/);
    }
    assert.equal((await testEnterprise(connection('wecom', { webhookUrl: 'not a URL' }), platform('wecom'))).ok, false);
  });
});

test('Feishu text payload and documented numeric code confirm delivery without invented IDs', async () => {
  const result = await withFetch([(url, init) => {
    assert.equal(url, endpoints.feishu);
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.deepEqual(payload(init), { msg_type: 'text', content: { text: '中文 body' } });
    assert.ok(init.signal); assert.equal(new Headers(init.headers).has('Authorization'), false);
    return json({ code: 0, msg: 'success', StatusCode: 0 });
  }], () => run('feishu'));
  assert.equal(result.status, 'published'); assert.equal(result.remoteId, undefined); assert.equal(result.url, undefined);
});

test('Feishu and DingTalk generate different official signatures with their correct timestamp units', async () => {
  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    await withFetch([(_url, init) => {
      assert.equal(payload(init).timestamp, '1700000000');
      assert.equal(payload(init).sign, 'wVkXGs7tnGGdFP0ROb5TA58qvnldaoxe43r/OZmowJ8=');
      return json({ code: 0 });
    }], async () => { assert.equal((await run('feishu', { secret: 'SEC-test' })).status, 'published'); });
    await withFetch([(url, init) => {
      const endpoint = new URL(url);
      assert.equal(endpoint.searchParams.get('access_token'), 'private-token');
      assert.equal(endpoint.searchParams.get('timestamp'), '1700000000000');
      assert.equal(endpoint.searchParams.get('sign'), 'Sf/ft2shUSqoR1REF+DS39IoTlwQRyDPwfM8S94ODOc=');
      assert.equal(endpoint.searchParams.getAll('sign').length, 1);
      assert.deepEqual(payload(init), { msgtype: 'text', text: { content: '中文 body' }, at: { isAtAll: false } });
      return json({ errcode: 0, errmsg: 'ok' });
    }], async () => { assert.equal((await run('dingtalk', { secret: 'SEC-test' })).status, 'published'); });
  } finally { Date.now = originalNow; }
});

test('DingTalk supports an unsigned bot and documented Markdown fields without mass mentions', async () => {
  await withFetch([(url, init) => {
    assert.equal(url, endpoints.dingtalk);
    assert.equal(new URL(url).searchParams.has('sign'), false);
    assert.deepEqual(payload(init), { msgtype: 'markdown', markdown: { title: '标题', text: '**正文**' }, at: { isAtAll: false } });
    return json({ errcode: 0 });
  }], async () => { assert.equal((await run('dingtalk', { format: 'markdown' }, { body: '**正文**' })).status, 'published'); });
});

test('WeCom sends exactly its text or Markdown message shape and counts UTF-8 bytes', async () => {
  await withFetch([(_url, init) => {
    assert.deepEqual(payload(init), { msgtype: 'text', text: { content: '中'.repeat(682) + 'ab' } });
    return json({ errcode: 0, errmsg: 'ok' });
  }], async () => { assert.equal((await run('wecom', {}, { body: '中'.repeat(682) + 'ab' })).status, 'published'); });
  await withFetch([(_url, init) => { assert.deepEqual(payload(init), { msgtype: 'markdown', markdown: { content: '中'.repeat(1365) + 'a' } }); return json({ errcode: 0 }); }], async () => {
    assert.equal((await run('wecom', { format: 'markdown' }, { body: '中'.repeat(1365) + 'a' })).status, 'published');
  });
  await withFetch([], async () => {
    await assert.rejects(() => run('wecom', {}, { body: '中'.repeat(683) }), /2048/);
    await assert.rejects(() => run('wecom', { format: 'markdown' }, { body: '中'.repeat(1366) }), /4096/);
  });
});

test('full JSON size includes signature and escaping, and is rejected before any request', async () => {
  await withFetch([], async () => {
    await assert.rejects(() => run('feishu', { secret: 'SEC-test' }, { body: '"'.repeat(11_000) }), /20480/);
    await assert.rejects(() => run('dingtalk', {}, { body: '中'.repeat(7_000) }), /20480/);
    await assert.rejects(() => run('teams', {}, { body: 'a'.repeat(28 * 1024) }), /28672/);
  });
});

test('Teams Workflows uses its Adaptive Card envelope; HTTP 202 is unconfirmed', async () => {
  const result = await withFetch([(url, init) => {
    assert.equal(url, endpoints.teams);
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.deepEqual(payload(init), { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.2', body: [{ type: 'TextBlock', text: '中文 body', wrap: true }] } }] });
    return new Response(null, { status: 202 });
  }], () => run('teams'));
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.remoteId, undefined);
  await withFetch([() => new Response('1', { status: 200 })], async () => { assert.equal((await run('teams')).status, 'unconfirmed'); });
});

test('unexpected receipts never become successful delivery claims', async () => {
  for (const [id, reply] of [
    ['feishu', json({ StatusCode: 0 })],
    ['feishu', json({ code: '0' })],
    ['feishu', json({ code: 0 }, 202)],
    ['dingtalk', json({ success: true })],
    ['wecom', new Response('not json', { status: 200 })],
    ['wecom', new Response(null, { status: 204 })],
  ] as [Id, Response][]) await withFetch([() => reply], async () => { assert.equal((await run(id)).status, 'unconfirmed'); });
});

test('numeric API rejection is definite and upstream error messages stay private', async () => {
  for (const id of ['feishu', 'dingtalk', 'wecom'] as Id[]) {
    await withFetch([() => json({ [id === 'feishu' ? 'code' : 'errcode']: 310000, msg: endpoints[id], errmsg: 'private-key private-token private-signature' })], async () => {
      await assert.rejects(() => run(id), e => {
        assert.ok(e instanceof EnterpriseConnectorError);
        assert.equal(e.uncertain, false);
        assert.match(e.message, /310000/);
        assert.doesNotMatch(e.message, /private-|https:/);
        return true;
      });
    });
  }
});

test('HTTP errors distinguish definitive rejection from unknown delivery and do not retry', async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 408]) {
    await withFetch([() => new Response('private-token ' + endpoints.feishu, { status })], async () => {
      await assert.rejects(() => run('feishu'), e => {
        assert.ok(e instanceof EnterpriseConnectorError);
        assert.equal(e.uncertain, status >= 500 || status === 408);
        assert.match(e.message, new RegExp(String(status)));
        assert.doesNotMatch(e.message, /private-|https:/);
        return true;
      });
    });
  }
});

test('network and response-read failures are uncertain and redact secret URLs', async () => {
  await withFetch([() => { throw new Error('network error ' + endpoints.dingtalk); }], async () => {
    await assert.rejects(() => run('dingtalk'), e => { assert.ok(e instanceof EnterpriseConnectorError); assert.equal(e.uncertain, true); assert.doesNotMatch(e.message, /private-token|https:/); return true; });
  });
  await withFetch([() => { const response = json({ errcode: 0 }); response.text = async () => { throw new Error('private-key'); }; return response; }], async () => { await assert.rejects(() => run('wecom'), error(true)); });
});

test('unsupported media, threads, wrong targets, disabled connections and empty bodies fail before network', async () => {
  await withFetch([], async () => {
    await assert.rejects(() => run('feishu', {}, {}, [image]), /暂不上传素材/);
    await assert.rejects(() => run('wecom', {}, { thread: ['one', 'two'] }), /不支持分段线程/);
    await assert.rejects(() => run('dingtalk', {}, { body: ' \n ' }), /正文不能为空/);
    await assert.rejects(() => run('teams', {}, { platformId: 'x' }), /不匹配/);
    await assert.rejects(() => publishEnterprise({ ...connection('feishu'), enabled: false }, platform('feishu'), variant('feishu'), [], context), /已停用/);
    await assert.rejects(() => run('wecom', {}, {}, [], { ...context, signal: AbortSignal.abort() }), error(false));
  });
});
