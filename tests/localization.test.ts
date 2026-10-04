import assert from 'node:assert/strict';
import test from 'node:test';
import { platforms } from '../server/catalog.js';
import { getConnectorDefinitions } from '../server/connectors.js';
import type { Bootstrap } from '../client/src/api.js';
import { translateText } from '../client/src/translation.js';

type I18n = typeof import('../client/src/i18n.js');
class FakeStorage {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: [string, string][] = [];
  failWrites = false;
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes.push([key, value]);
    if (this.failWrites) throw new Error('Storage unavailable in this test');
    this.values.set(key, value);
  }
}

// Install the fake before the first runtime import: no real localStorage is read.
async function withStorage(run: (i18n: I18n, storage: FakeStorage) => Promise<void> | void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  let i18n: I18n | undefined;
  let previous: ReturnType<I18n['getLocale']> | undefined;
  try {
    i18n = await import('../client/src/i18n.js');
    previous = i18n.getLocale();
    await run(i18n, storage);
  } finally {
    if (i18n && previous) i18n.setLocale(previous);
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('missing or invalid stored language defaults to English; explicit Chinese persists and switches', async () => {
  await withStorage((i18n, storage) => {
    assert.equal(i18n.getLocale(), 'en');
    assert.deepEqual(storage.reads, [i18n.LOCALE_KEY]);
    for (const value of [undefined, null, '', 'en', 'fr', 'zh-TW', 'invalid']) {
      assert.equal(i18n.readLocale(value), 'en', String(value));
    }
    assert.equal(i18n.readLocale('zh-CN'), 'zh-CN');
    assert.equal(i18n.t('界面语言'), 'Interface language');

    i18n.setLocale('zh-CN');
    assert.equal(i18n.getLocale(), 'zh-CN');
    assert.equal(storage.values.get(i18n.LOCALE_KEY), 'zh-CN');
    assert.equal(i18n.readLocale(storage.getItem(i18n.LOCALE_KEY)), 'zh-CN');
    assert.equal(i18n.t('界面语言'), '界面语言');

    i18n.setLocale('en');
    assert.equal(i18n.getLocale(), 'en');
    assert.equal(storage.values.get(i18n.LOCALE_KEY), 'en');
    assert.equal(i18n.t('界面语言'), 'Interface language');
  });
});

test('language switching still works when storage writes are denied', async () => {
  await withStorage((i18n, storage) => {
    storage.failWrites = true;
    assert.doesNotThrow(() => i18n.setLocale('zh-CN'));
    assert.equal(i18n.getLocale(), 'zh-CN');
    assert.equal(i18n.t('界面语言'), '界面语言');
    assert.doesNotThrow(() => i18n.setLocale('en'));
    assert.equal(i18n.t('界面语言'), 'Interface language');
    assert.equal(storage.values.size, 0);
  });
});

test('a fresh language module restores an explicit Chinese preference from fake storage', async () => {
  await withStorage(async (i18n, storage) => {
    storage.values.set(i18n.LOCALE_KEY, 'zh-CN');
    const restored: I18n = await import(new URL('../client/src/i18n.tsx?localization-test-stored-chinese', import.meta.url).href);
    assert.equal(restored.getLocale(), 'zh-CN');
    assert.equal(restored.t('工作台设置已保存。'), '工作台设置已保存。');
    assert.equal(storage.values.get(i18n.LOCALE_KEY), 'zh-CN');
    assert.equal(storage.reads.at(-1), i18n.LOCALE_KEY);
  });
});

test('controlled static labels and parameterized counts render in both languages', () => {
  assert.equal(translateText('en', '工作台设置已保存。'), 'Workspace settings saved.');
  assert.equal(translateText('zh-CN', '工作台设置已保存。'), '工作台设置已保存。');
  assert.equal(translateText('zh-CN', 'Workspace settings saved.'), '工作台设置已保存。');
  assert.equal(translateText('en', '{count} 个任务需处理', { count: 7 }), '7 tasks need attention');
  assert.equal(translateText('zh-CN', '{count} 个任务需处理', { count: 7 }), '7 个任务需处理');
  assert.equal(translateText('en', '等待排期时间'), 'Waiting for scheduled time');
});

test('unknown text remains unchanged rather than matching a template made only of a placeholder', () => {
  for (const source of ['constructor', 'toString', '__proto__', ' constructor ']) {
    assert.equal(translateText('en', source), source);
    assert.equal(translateText('zh-CN', source), source);
  }
  for (const source of ['Unknown remote detail $& {name}', '我的自定义文本 $& {count}']) {
    assert.equal(translateText('en', source), source);
    assert.equal(translateText('zh-CN', source), source);
  }
});

test('backend messages with resolved dynamic parameters translate and reverse without dropping context', () => {
  const chinese = 'AI 服务返回 HTTP 429，请检查模型、配额与 API Key';
  const english = 'AI provider returned HTTP 429. Check the model, quota, and API key.';
  assert.equal(translateText('en', chinese), english);
  assert.equal(translateText('zh-CN', english), chinese);
  assert.equal(translateText('en', '标题超过 120 字符'), 'Title exceeds 120 characters');
  assert.equal(translateText('zh-CN', 'Title exceeds 120 characters'), '标题超过 120 字符');
  assert.equal(translateText('en', '请在 MultiPost 扩展设置中将 creator.example 加入信任域名，然后重试。'),
    'Add creator.example to trusted domains in MultiPost settings, then try again.');
});

test('interpolation treats dollar sequences, braces and known UI words inside account names as user text', () => {
  const name = '等待发布 $& $1 $$ {count} {name} 中文账号';
  const source = '删除账号连接“{name}”？不会删除平台账号或已发布内容。';
  const expected = `Delete the connection “${name}”? The platform account and published content will remain.`;
  assert.equal(translateText('en', source, { name }), expected);
  assert.equal(translateText('zh-CN', source, { name }), `删除账号连接“${name}”？不会删除平台账号或已发布内容。`);
  assert.equal(translateText('zh-CN', expected), `删除账号连接“${name}”？不会删除平台账号或已发布内容。`);
  assert.equal(translateText('en', `删除账号连接“${name}”？不会删除平台账号或已发布内容。`), expected);
});

test('whitespace around controlled copy does not interpret dollar sequences in user parameters', () => {
  const name = '原文 $& {count}';
  const source = '  删除账号连接“{name}”？不会删除平台账号或已发布内容。  ';
  assert.equal(translateText('en', source, { name }),
    `  Delete the connection “${name}”? The platform account and published content will remain.  `);
});

test('backend account prefixes and joined validation errors preserve account names while translating system text', () => {
  const account = '我的账号 $& {name}';
  assert.equal(translateText('en', `${account}：渠道已停用`), `${account}: Connection is disabled`);
  assert.equal(translateText('en', '请填写标题；请填写内容'), 'Enter a title; Enter content');
});

function bootstrap(): Bootstrap {
  const at = '2026-10-04T02:03:00Z';
  const variant: Bootstrap['variants'][number] = {
    id: 'variant-中文-id', contentId: 'content-中文-id', platformId: 'wechat', title: '等待发布',
    body: '启用 AI 创作 $& {count} 是我的原稿', html: '<p>原文 $& {name}</p>',
    thread: ['第一条原文', '第二条原文'], tags: ['我的标签'], source: 'manual',
    issues: [{ severity: 'warning', message: '我的未翻译校验记录' }], approved: true, updatedAt: at,
  };
  const media = { id: 'media-中文-id', name: '我的文件 $&.png', url: '/uploads/example.png', mime: 'image/png', size: 68 };
  return {
    platforms,
    connectorDefinitions: getConnectorDefinitions(platforms),
    profiles: [{ id: 'profile-中文-id', name: '检查失败', audience: '我的中文受众', tone: '我的中文语气',
      language: 'zh-CN', description: '我的创作方向 $& {name}', forbiddenWords: ['未发布'], updatedAt: at }],
    contents: [{ id: 'content-中文-id', title: '等待发布', source: '我的中文原稿 $& {count}',
      profileId: 'profile-中文-id', media: [media], createdAt: at, updatedAt: at }],
    variants: [variant],
    connections: [{ id: 'connection-中文-id', name: '添加连接', platformId: 'wechat', connector: 'multipost',
      enabled: true, configured: true, config: { userAgent: '我的客户端 $& {name}' }, secretKeys: [], createdAt: at,
      lastTest: { at, ok: true, message: '参数检查通过', scope: 'configuration' } }],
    jobs: [{ id: 'job-中文-id', batchId: 'batch-中文-id', contentId: variant.contentId, variantId: variant.id,
      connectionId: 'connection-中文-id', platformId: 'wechat', connectionName: '添加连接', title: '等待发布',
      status: 'needs_action', scheduledAt: at, attempts: 0,
      message: '内容已交给 MultiPost 审阅窗口。请核对远端结果。', createdAt: at, updatedAt: at,
      snapshot: variant, media: [media] }],
    settings: { generation: { enabled: false, baseUrl: '', model: '我的模型-ID', hasApiKey: false }, timezone: 'Asia/Shanghai' },
    remoteMode: true,
  };
}

test('bootstrap localization only changes system metadata, preserving authored content, IDs and raw receipts', async () => {
  await withStorage((i18n) => {
    const source = bootstrap();
    const before = structuredClone(source);
    assert.equal(i18n.localizeBootstrap(null, 'en'), null);
    const english = i18n.localizeBootstrap(source, 'en')!;
    assert.equal(english.platforms.find(platform => platform.id === 'wechat')?.name, 'WeChat Official Accounts');
    assert.equal(english.platforms.find(platform => platform.id === 'wechat')?.originalName, '微信公众号');
    assert.equal(english.connectorDefinitions.find(definition => definition.id === 'multipost')?.name, 'MultiPost Browser Extension');

    for (const localized of [english, i18n.localizeBootstrap(source, 'zh-CN')!]) {
      for (const key of ['contents', 'profiles', 'variants', 'connections', 'jobs', 'settings'] as const) {
        assert.deepEqual(localized[key], source[key], `${key} must remain unchanged`);
        assert.equal(localized[key], source[key], `${key} must retain its original data reference`);
      }
      assert.deepEqual(localized.platforms.map(platform => platform.id), source.platforms.map(platform => platform.id));
      assert.deepEqual(localized.connectorDefinitions.map(definition => definition.id), source.connectorDefinitions.map(definition => definition.id));
      for (const [index, platform] of localized.platforms.entries()) {
        const original = source.platforms[index];
        for (const key of ['postizId', 'multipostId', 'wechatsyncId', 'formats', 'requiredMedia', 'titleLimit', 'bodyLimit', 'region', 'category'] as const) {
          assert.deepEqual(platform[key], original[key], `${platform.id}.${key}`);
        }
      }
      for (const [index, definition] of localized.connectorDefinitions.entries()) {
        const original = source.connectorDefinitions[index];
        assert.deepEqual(definition.platformIds, original.platformIds);
        assert.equal(definition.mode, original.mode);
        assert.deepEqual(definition.fields.map(({ key, required, secret }) => ({ key, required, secret })),
          original.fields.map(({ key, required, secret }) => ({ key, required, secret })));
      }
    }
    assert.deepEqual(source, before, 'Localization must not mutate the raw bootstrap');
  });
});

test('every live catalog platform and connector field has English display metadata', async () => {
  await withStorage((i18n) => {
    const source = bootstrap();
    const english = i18n.localizeBootstrap(source, 'en')!;
    const untranslated: { path: string; source: string; displayed: string }[] = [];
    const check = (path: string, displayed: string | undefined, original: string | undefined) => {
      // Brand labels must also use their English name or romanization; no Han-name exceptions.
      if (displayed && /\p{Script=Han}/u.test(displayed)) untranslated.push({ path, source: original || '', displayed });
    };
    for (const [index, platform] of english.platforms.entries()) {
      const original = source.platforms[index];
      for (const key of ['name', 'shortName', 'description', 'recommendedTone'] as const) {
        check(`platforms.${platform.id}.${key}`, platform[key], original[key]);
      }
      platform.notes.forEach((note, noteIndex) => check(`platforms.${platform.id}.notes.${noteIndex}`, note, original.notes[noteIndex]));
    }
    for (const [index, definition] of english.connectorDefinitions.entries()) {
      const original = source.connectorDefinitions[index];
      check(`connectors.${definition.id}.name`, definition.name, original.name);
      check(`connectors.${definition.id}.description`, definition.description, original.description);
      for (const [fieldIndex, field] of definition.fields.entries()) {
        for (const key of ['label', 'help', 'placeholder'] as const) {
          check(`connectors.${definition.id}.${field.key}.${key}`, field[key], original.fields[fieldIndex][key]);
        }
      }
    }
    assert.equal(english.platforms.length, source.platforms.length);
    assert.equal(english.connectorDefinitions.length, source.connectorDefinitions.length);
    assert.deepEqual(untranslated, [], 'English display metadata must not retain untranslated Chinese');
  });
});

test('date display follows the interface locale while preserving the selected time zone and safe fallbacks', async () => {
  await withStorage(async (i18n) => {
    const { formatDate } = await import('../client/src/ui.js');
    const instant = '2026-10-04T02:03:00Z';
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' };
    i18n.setLocale('en');
    const english = formatDate(instant, options.timeZone);
    assert.equal(english, new Intl.DateTimeFormat('en-US', options).format(new Date(instant)));
    i18n.setLocale('zh-CN');
    const chinese = formatDate(instant, options.timeZone);
    assert.equal(chinese, new Intl.DateTimeFormat('zh-CN', options).format(new Date(instant)));
    assert.notEqual(english, chinese);
    assert.equal(formatDate(instant, 'UTC'), new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: 'UTC' }).format(new Date(instant)));
    assert.equal(formatDate('invalid-date', 'UTC'), 'invalid-date');
    assert.equal(formatDate(instant, 'invalid-time-zone'), instant);
  });
});

test('controlled nested field labels and system fragments translate without touching user remarks', () => {
  assert.equal(translateText('en', '请填写目标 Subreddit。'), 'Enter Target subreddit.');
  assert.equal(translateText('en', '远端服务返回 HTTP 401。请检查账号权限和凭据。'), 'The remote service returned HTTP 401. Check account permissions and credentials.');
  assert.equal(translateText('zh-CN', 'Body must not be empty'), '正文不能为空');
  assert.equal(translateText('en', '第 2 条串帖超过 280 字符限制'), 'Post 2 exceeds the limit of 280 characters');
  assert.equal(translateText('zh-CN', 'AI writing complete. Versions to review: 5.'), 'AI 创作已完成，5 个平台版本等待你审阅。');
  assert.equal(translateText('en', '用户已核对远端结果：自然、具体、清楚'), 'User verified the remote result: 自然、具体、清楚');
});

test('platform search keeps both language aliases and badges use compact readable marks', async () => {
  const { localizeBootstrap } = await import('../client/src/i18n.js');
  const { platformMonogram, platformSearchText } = await import('../client/src/platforms.js');
  const data = { platforms, connectorDefinitions: [] } as unknown as Bootstrap;
  for (const language of ['en', 'zh-CN'] as const) {
    const localized = localizeBootstrap(data, language)!;
    const xhs = localized.platforms.find(platform => platform.id === 'xiaohongshu')!;
    assert.ok(platformSearchText(xhs).includes('小红书'));
    assert.ok(platformSearchText(xhs).includes('rednote'));
    if (language === 'en') assert.equal(platformMonogram(xhs), 'RN');
  }
});
