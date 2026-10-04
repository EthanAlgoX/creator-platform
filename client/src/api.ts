import { appUrl } from './urls';
import { t } from './i18n';
import type { Bootstrap as ServerBootstrap, Platform as ServerPlatform } from '../../server/types.js';

export type {
  Profile, Content, Variant, Connection, Job,
  Settings, ConnectorDefinition, Media, Issue,
} from '../../server/types.js';
export type Platform = ServerPlatform & { originalName?: string; originalShortName?: string; originalDescription?: string };
export type Bootstrap = Omit<ServerBootstrap, 'platforms'> & { platforms: Platform[] };

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(appUrl(path), { ...options, headers }); }
  catch { throw new Error(t('无法连接工作台服务。请确认服务正在运行，再重试。')); }
  const body = await response.text();
  let parsed: unknown;
  try { parsed = body ? JSON.parse(body) : {}; }
  catch { throw new Error(t('服务返回了无法读取的内容（HTTP {status}）。', { status: response.status })); }
  if (!response.ok) {
    const error = typeof parsed === 'object' && parsed && 'error' in parsed ? String(parsed.error) : `操作失败（HTTP ${response.status}）`;
    throw new Error(t(error));
  }
  return parsed as T;
}

export function send<T>(path: string, body: unknown, method = 'POST', headers?: HeadersInit) {
  return request<T>(path, { method, body: JSON.stringify(body), headers });
}

export const errorText = (error: unknown) => t(error instanceof Error ? error.message : '操作没有完成，请重试。');
