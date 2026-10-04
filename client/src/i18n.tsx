import { useEffect, useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import type { Bootstrap } from './api';
import { translateText, type Locale, type TranslationParams } from './translation';

export const LOCALE_KEY = 'creator-workbench-locale-v1';
export function readLocale(value?: string | null): Locale { return value === 'zh-CN' ? 'zh-CN' : 'en'; }
let locale: Locale = 'en';
try { if (typeof localStorage !== 'undefined') locale = readLocale(localStorage.getItem(LOCALE_KEY)); } catch { /* Private browsing can block storage. English remains the default. */ }
const listeners = new Set<() => void>();
export function setLocale(next: Locale) {
  locale = readLocale(next);
  try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* Language switching works even without persistence. */ }
  listeners.forEach(listener => listener());
}
export const getLocale = () => locale;
export const t = (source: string, params?: TranslationParams) => translateText(locale, source, params);
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useI18n() {
  const language = useSyncExternalStore(subscribe, getLocale, () => 'en' as Locale);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'Creator Studio · Content workspace' : '创作间 · 内容工作台';
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_KEY || event.key === null) { locale = readLocale(event.newValue); listeners.forEach(listener => listener()); }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [language]);
  return { locale: language, setLocale, t };
}

export function LanguageSwitcher() {
  const { locale } = useI18n();
  return <label className="language-switcher"><Languages size={16} aria-hidden="true" /><span className="sr-only">{t('界面语言')}</span>
    <select aria-label={t('界面语言')} value={locale} onChange={event => setLocale(readLocale(event.target.value))}>
      <option value="en">English</option><option value="zh-CN">简体中文</option>
    </select>
  </label>;
}

export function localizeBootstrap(data: Bootstrap | null, language: Locale): Bootstrap | null {
  if (!data) return null;
  const text = (source: string) => translateText(language, source);
  return { ...data,
    platforms: data.platforms.map(platform => ({ ...platform, originalName: platform.name, originalShortName: platform.shortName, originalDescription: platform.description,
      name: text(platform.name), shortName: text(platform.shortName), description: text(platform.description), recommendedTone: text(platform.recommendedTone), notes: platform.notes.map(text) })),
    connectorDefinitions: data.connectorDefinitions.map(definition => ({ ...definition, name: text(definition.name), description: text(definition.description),
      fields: definition.fields.map(field => ({ ...field, label: text(field.label), help: field.help && text(field.help), placeholder: field.placeholder && text(field.placeholder) })) })),
  };
}
