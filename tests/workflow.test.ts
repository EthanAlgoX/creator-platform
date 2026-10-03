import test from 'node:test';
import assert from 'node:assert/strict';
import { aiReady, generationTargets, isSourceDirty, needsSourceReview } from '../client/src/workflow.js';
import type { Content, Variant } from '../server/types.js';

const source: Content = { id: 'one', title: 'Saved title', source: 'Saved original', media: [], createdAt: '', updatedAt: '' };
const draft = { id: 'one', title: source.title, source: source.source, profileId: '', media: [] };
test('clearing a saved draft remains dirty and cannot masquerade as unchanged content', () => {
  assert.equal(isSourceDirty(draft, source), false);
  assert.equal(isSourceDirty({ ...draft, title: '', source: '' }, source), true);
  assert.equal(isSourceDirty({ title: '', source: '', profileId: '', media: [] }), false);
  assert.equal(isSourceDirty({ ...draft, profileId: 'different' }, source), true);
  assert.equal(isSourceDirty({ ...draft, media: [{ id: 'm', name: 'm.png', url: '/uploads/m.png', size: 1, mime: 'image/png' }] }, source), true);
});
test('default generation preserves every existing version; explicit replacement names selected targets only', () => {
  const current = [{ platformId: 'x' }, { platformId: 'wechat' }] as Variant[];
  assert.deepEqual(generationTargets(['x', 'reddit', 'reddit'], current), ['reddit']);
  assert.deepEqual(generationTargets(['x', 'reddit'], current, true), ['x', 'reddit']);
  assert.deepEqual(generationTargets(['x'], current), []);
});
test('AI readiness requires all four saved prerequisites, not just enabled and a key', () => {
  const settings = { timezone: 'Asia/Shanghai', generation: { enabled: true, hasApiKey: true, baseUrl: 'https://model.example/v1', model: 'writer' } };
  assert.equal(aiReady(settings), true);
  for (const field of ['enabled', 'hasApiKey', 'baseUrl', 'model'] as const) assert.equal(aiReady({ ...settings, generation: { ...settings.generation, [field]: typeof settings.generation[field] === 'boolean' ? false : '' } }), false);
});
test('source review is separated from other validation errors', () => {
  assert.equal(needsSourceReview({ issues: [{ severity: 'error', message: '原稿已变化，请重新核对' }] } as Variant), true);
  assert.equal(needsSourceReview({ issues: [{ severity: 'error', message: '缺少图片' }] } as Variant), false);
});
