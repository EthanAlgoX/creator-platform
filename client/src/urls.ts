/** Resolve local API/assets against Vite's deployment base without changing stored URLs. */
export function appUrl(path: string, base = import.meta.env?.BASE_URL || '/'): string {
  // Remote URLs, browser-managed URLs and anchors retain their original meaning.
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return path;
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}`;
  const root = prefix === '/' ? '/' : `${prefix}/`;
  if (root !== '/' && (path === prefix || path.startsWith(root))) return path;
  return `${root}${path.replace(/^\/+/, '')}`;
}

/** Only uploaded local files are remapped; result links to external platforms are unchanged. */
export function mediaUrl(path: string, base = import.meta.env?.BASE_URL || '/'): string {
  return /^\/uploads(?:\/|\?|$)/.test(path) ? appUrl(path, base) : path;
}

/** Keep uploaded images/links usable in sandbox previews and downloaded text files. */
export function resolveUploadReferences(
  content: string,
  format: 'html' | 'markdown',
  origin: string,
  base = import.meta.env?.BASE_URL || '/',
): string {
  const absolute = (path: string) => new URL(mediaUrl(path, base), origin).href;
  if (format === 'html') {
    return content.replace(/(\b(?:src|href)\s*=\s*["'])(\/uploads\/[^"'<>]*)(["'])/gi,
      (_match, before: string, path: string, after: string) => `${before}${absolute(path)}${after}`);
  }
  return content
    .replace(/(\]\(\s*<?)(\/uploads\/[^\s)>]*)(>?)(?=\s|\))/g,
      (_match, before: string, path: string, after: string) => `${before}${absolute(path)}${after}`)
    .replace(/(^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?)(\/uploads\/[^\s>]*)(>?)(?=\s|$)/gm,
      (_match, before: string, path: string, after: string) => `${before}${absolute(path)}${after}`);
}
