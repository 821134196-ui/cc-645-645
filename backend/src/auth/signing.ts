import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.SIGNING_SECRET || 'local-demo-signing-secret-change-me';

/** 签名地址的有效期（毫秒）：地址本身短期有效，到期/下架后即使未过期也会被服务端拒绝 */
export const URL_TTL_MS = 10 * 60 * 1000;

export type MediaAction = 'play' | 'download';

/** 生成带 HMAC 签名的播放/下载地址，防止地址被篡改 */
export function signMediaUrl(opts: {
  baseUrl: string;
  path: '/api/stream' | '/api/download';
  versionId: string;
  userId: string;
  action: MediaAction;
  expiresAt: number;
}): string {
  const payload = `${opts.versionId}.${opts.userId}.${opts.action}.${opts.expiresAt}`;
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const q = new URLSearchParams({
    v: opts.versionId,
    u: opts.userId,
    a: opts.action,
    exp: String(opts.expiresAt),
    sig,
  });
  return `${opts.baseUrl}${opts.path}?${q.toString()}`;
}

export interface VerifiedToken {
  versionId: string;
  userId: string;
  action: MediaAction;
  expiresAt: number;
}

/** 校验签名与地址自身有效期；不查库（部门/许可状态由调用方再次核对） */
export function verifyMediaToken(q: {
  v?: string;
  u?: string;
  a?: string;
  exp?: string;
  sig?: string;
}): VerifiedToken | null {
  if (!q.v || !q.u || !q.a || !q.exp || !q.sig) return null;
  if (q.a !== 'play' && q.a !== 'download') return null;
  const expiresAt = Number(q.exp);
  if (!Number.isFinite(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;

  const payload = `${q.v}.${q.u}.${q.a}.${expiresAt}`;
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(q.sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return { versionId: q.v, userId: q.u, action: q.a, expiresAt };
}
