export type {
  Bootstrap, Platform, Profile, Content, Variant, Connection, Job,
  Settings, ConnectorDefinition, Media, Issue,
} from '../../server/types.js';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(path, { ...options, headers }); }
  catch { throw new Error('无法连接本地服务。请确认工作台服务正在运行，再重试。'); }
  const body = await response.text();
  let parsed: unknown;
  try { parsed = body ? JSON.parse(body) : {}; }
  catch { throw new Error(`服务返回了无法读取的内容（HTTP ${response.status}）。`); }
  if (!response.ok) {
    const error = typeof parsed === 'object' && parsed && 'error' in parsed ? String(parsed.error) : `操作失败（HTTP ${response.status}）`;
    throw new Error(error);
  }
  return parsed as T;
}

export function send<T>(path: string, body: unknown, method = 'POST', headers?: HeadersInit) {
  return request<T>(path, { method, body: JSON.stringify(body), headers });
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作没有完成，请重试。';
