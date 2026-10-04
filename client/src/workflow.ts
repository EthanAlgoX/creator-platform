import type { Connection, Content, Media, Settings, Variant } from './api';
import { t } from './i18n';

export type Composer = { id?: string; title: string; source: string; profileId: string; media: Media[] };
export function isSourceDirty(composer: Composer, saved?: Content): boolean {
  if (!saved) return Boolean(composer.title || composer.source || composer.profileId || composer.media.length);
  return composer.title !== saved.title || composer.source !== saved.source || composer.profileId !== (saved.profileId || '') || JSON.stringify(composer.media) !== JSON.stringify(saved.media);
}
export function generationTargets(selected: string[], current: Variant[], replace = false): string[] {
  const existing = new Set(current.map(v => v.platformId));
  return [...new Set(selected)].filter(id => replace || !existing.has(id));
}
export function aiReady(settings: Settings): boolean {
  const g = settings.generation; return Boolean(g.enabled && g.hasApiKey && g.baseUrl.trim() && g.model.trim());
}
export function needsSourceReview(variant: Variant): boolean {
  return variant.issues.some(i => i.severity === 'error' && i.message.includes('原稿'));
}
export function accountState(connection: Connection): string {
  if (!connection.enabled) return t('已停用');
  if (!connection.configured) return t('参数不完整');
  if (!connection.lastTest) return t('参数齐全 · 未检查');
  if (!connection.lastTest.ok) return t('检查失败');
  return t(connection.lastTest.scope === 'configuration' ? '参数检查通过' : '连接检查通过');
}
