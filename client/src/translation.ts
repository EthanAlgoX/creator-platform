import { appMessages } from './locales/app';
import { pagesMessages } from './locales/pages';
import { platformsMessages } from './locales/platforms';
import { catalogMessages } from './locales/catalog';
import { systemMessages } from './locales/system';

export type Locale = 'en' | 'zh-CN';
export type TranslationParams = Record<string, string | number>;
export const messages = { ...catalogMessages, ...systemMessages, ...appMessages, ...pagesMessages, ...platformsMessages };
const reverse = Object.fromEntries(Object.entries(messages).map(([zh, en]) => [en, zh]));
// Only these placeholders originate from controlled metadata. Other captures may
// contain user-authored titles, names, notes or remote IDs and must stay intact.
const metadataCaptures: Record<string, string[]> = {
  '请填写{p0}。': ['p0'],
  '{p0} 必须是没有内嵌账号密码的 HTTP(S) 地址。': ['p0'],
  '远端服务返回 HTTP {p0}。{p1}': ['p1'],
  '{p0}不能为空': ['p0'],
  '{p0}超过 {p1} 字符限制': ['p0'],
  '{p0} 超过 {p1} 字符限制': ['p0'],
  '{p0}超过 {p1} 个 UTF-8 字节，请缩短后重新审核。': ['p0'],
  '{p0} JSON 请求体': ['p0'],
  '{p0} 原生连接器暂不上传素材；请选择支持素材的连接方式或移除素材。': ['p0'],
  '{p0} 此连接器最多支持 {p1} 张图片，暂不支持其他附件。': ['p0'],
  '{p0} 当前内容超过 {p1} 字符，需先编辑。': ['p0'],
  '小红书服务回报“{p0}”，但没有可核对的帖子 ID 或链接，请在小红书确认结果。': ['p0'],
  '{p0}已返回请求回执，但没有可确认的消息发送结果。请到目标群或工作流运行记录核实后手动确认；不要直接重复发送。': ['p0'],
  '{p0}请求中断或超时，消息可能已经发送。请核实目标群或工作流记录后再处理。': ['p0'],
  '{p0}接口返回 HTTP {p1}。{p2}': ['p0', 'p2'],
  '{p0}拒绝发送消息（错误码 {p1}）。请检查机器人安全设置、密钥、权限或消息格式。': ['p0'],
  '{p0}官方接口确认消息发送成功；该群机器人接口不提供持久消息 ID 或可查询的发布链接。': ['p0'],
  '{p0} 版本尚未审核通过或原稿已变化': ['p0'],
  '模型没有返回唯一的 {p0} 版本，请重试': ['p0'],
  '{p0} 的模型输出格式有误': ['p0'],
  '{p0} 尚无 MultiPost 适配，请使用其他连接或导出内容。': ['p0'],
  '{p0} 需要图片素材，请先上传。': ['p0'],
  '{p0} 需要视频素材，请先上传。': ['p0'],
  '{p0} 需要图片或视频素材，请先上传。': ['p0'],
  '{p0} 的视频适配需要视频文件，请先上传。': ['p0'],
  '{p0}已完成，{p1} 个平台版本等待你审阅。': ['p0'],
  '{p0} 个渠道任务已{p1}。实际结果请查看发布任务。': ['p1'],
  '{p0} 内容版本': ['p0'], '{p0} 文章预览': ['p0'],
  '任务状态已经更新为“{status}”，无需继续人工确认。': ['status'],
};
const interpolate = (template: string, params: TranslationParams) => template.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(params, key) ? String(params[key]) : token);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pattern(template: string) {
  if (!template.replace(/\{\w+\}/g, '').trim()) return null;
  const keys: string[] = []; let last = 0; let expression = '^';
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    expression += escape(template.slice(last, match.index)) + '([\\s\\S]*?)';
    keys.push(match[1]); last = match.index! + match[0].length;
  }
  return keys.length ? { regex: new RegExp(expression + escape(template.slice(last)) + '$'), keys } : null;
}
const patterns = Object.entries(messages).flatMap(([zh, en]) => {
  const source = pattern(zh); const target = pattern(en);
  return source && target ? [{ zh, en, source, target }] : [];
}).sort((a, b) => b.en.replace(/\{\w+\}/g, '').length - a.en.replace(/\{\w+\}/g, '').length);

/** Translate controlled interface copy only. Drafts and account names stay untouched. */
export function translateText(locale: Locale, source: string, params: TranslationParams = {}): string {
  if (locale === 'zh-CN' && Object.hasOwn(messages, source)) return interpolate(source, params);
  const dictionary = locale === 'en' ? messages : reverse;
  const direct = Object.hasOwn(dictionary, source) ? dictionary[source] : undefined;
  if (direct !== undefined) return interpolate(direct, params);
  const trimmed = source.trim();
  if (trimmed !== source && Object.hasOwn(dictionary, trimmed)) return source.replace(trimmed, () => translateText(locale, trimmed, params));
  if (Object.keys(params).length) return interpolate(source, params);
  for (const entry of patterns) {
    const candidate = locale === 'en' ? entry.source : entry.target;
    const match = source.match(candidate.regex);
    if (match) {
      const captures = Object.fromEntries(candidate.keys.map((key, index) => [key, match[index + 1]]));
      for (const key of metadataCaptures[entry.zh] || []) if (captures[key]) captures[key] = translateText(locale, captures[key]);
      return interpolate(locale === 'en' ? entry.en : entry.zh, captures);
    }
  }
  // Validation may join several system errors, or prefix one with an account name.
  if (source.includes('；')) return source.split('；').map(part => translateText(locale, part)).join(locale === 'en' ? '; ' : '；');
  const boundary = source.indexOf('：');
  if (locale === 'en' && boundary > 0) {
    const tail = source.slice(boundary + 1); const translated = translateText(locale, tail);
    if (tail !== translated) return `${source.slice(0, boundary)}: ${translated}`;
  }
  return source;
}
