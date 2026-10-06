import type {
  AccessLogView, CourseView, LicenseView, NotificationView, UserInfo,
} from './types';

const TOKEN_KEY = 'training_token';
const USER_KEY = 'training_user';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export function currentUser(): UserInfo | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${tokenStore.get()}`,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      Array.isArray(data?.message) ? data.message.join('；') : data?.message || `请求失败 (${res.status})`,
    );
  }
  return data as T;
}

/** 媒体地址需要给 <video> 使用，令牌以 query 形式附加 */
export function mediaUrl(signedPath: string): string {
  const sep = signedPath.includes('?') ? '&' : '?';
  return `/api${signedPath}${sep}token=${encodeURIComponent(tokenStore.get() || '')}`;
}

export async function login(account: string, password: string) {
  const data = await api<{ token: string; user: UserInfo }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  });
  tokenStore.set(data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export const apiClient = {
  myCourses: () => api<CourseView[]>('/courses/mine'),
  requestAccess: (versionId: string, mode: 'STREAM' | 'DOWNLOAD') =>
    api<{ url: string; expiresIn: number; licenseId: string; validUntil: string }>(
      `/courses/${versionId}/access?mode=${mode}`, { method: 'POST' },
    ),

  departments: () => api<{ id: string; name: string }[]>('/admin/departments'),
  coursesVersions: () =>
    api<any[]>('/admin/courses-versions'),
  licenses: (status: string) =>
    api<LicenseView[]>(`/admin/licenses?status=${encodeURIComponent(status)}`),
  renewDue: () => api<LicenseView[]>('/admin/renew-due'),
  history: (courseId?: string) =>
    api<LicenseView[]>(`/admin/history${courseId ? `?courseId=${courseId}` : ''}`),
  accessLogs: (result = '') =>
    api<AccessLogView[]>(`/admin/access-logs${result ? `?result=${result}` : ''}`),
  takeDown: (id: string, reason: string) =>
    api(`/admin/licenses/${id}/takedown`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  scanNotifications: () =>
    api<{ dueCount: number; notifications: NotificationView[] }>('/admin/notifications/scan', { method: 'POST' }),
  notifications: () => api<NotificationView[]>('/admin/notifications'),
  licenseFileUrl: (id: string) =>
    `/api/admin/licenses/${id}/file?token=${encodeURIComponent(tokenStore.get() || '')}`,

  createCourse: (title: string) =>
    api('/admin/courses', { method: 'POST', body: JSON.stringify({ title }) }),
};
