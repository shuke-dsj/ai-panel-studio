import type { Discussion, Snapshot } from '../../shared/types';
export interface Health {
  ok: boolean;
  mode: 'real' | 'demo';
  configured: boolean;
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? '请求未完成，请重试。');
  return value as T;
}
export const api = {
  health: () => request<Health>('/health'),
  list: () => request<Discussion[]>('/discussions'),
  snapshot: (id: string) => request<Snapshot>(`/discussions/${id}`),
  create: (body: { topic: string; expertCount: number; maxTurns: number }) =>
    request<Discussion>('/discussions', body),
  command: (id: string, action: string) => request<Snapshot>(`/discussions/${id}/${action}`, {}),
};
