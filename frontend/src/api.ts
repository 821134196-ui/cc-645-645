// 统一接口封装：本地演示用 X-User-Id 头切换当前登录员工
let currentUserId = '';

export function setCurrentUser(id: string) {
  currentUserId = id;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(currentUserId ? { 'X-User-Id': currentUserId } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.message ? String(body.message) : JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function fmtDate(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fmtDateTime(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${fmtDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function toDateInput(d: Date) {
  return fmtDate(d);
}
