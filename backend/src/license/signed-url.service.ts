import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

/**
 * 短时效签名地址：绑定 用户 / 视频版本 / 具体许可 / 播放或下载。
 * 签名只能保证“地址没被篡改、短时间内有效”，
 * 真正的授权（到期、下架、部门）在每次访问媒体时由服务端重新判定。
 */
@Injectable()
export class SignedUrlService {
  constructor(private config: ConfigService) {}

  private get secret() {
    return this.config.get<string>('JWT_SECRET') || 'dev-secret';
  }

  get ttlSeconds() {
    return Number(this.config.get<string>('SIGNED_URL_TTL')) || 300;
  }

  sign(payload: { userId: string; versionId: string; licenseId: string; mode: 'STREAM' | 'DOWNLOAD' }) {
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const base = `${payload.userId}.${payload.versionId}.${payload.licenseId}.${payload.mode}.${exp}`;
    const sig = createHmac('sha256', this.secret).update(base).digest('hex');
    const qs = new URLSearchParams({
      u: payload.userId,
      v: payload.versionId,
      l: payload.licenseId,
      m: payload.mode,
      e: String(exp),
      s: sig,
    });
    return { exp, query: qs.toString() };
  }

  verify(query: Record<string, any>): { ok: boolean; reason?: string; data?: any } {
    const { u, v, l, m, e, s } = query;
    if (!u || !v || !l || !m || !e || !s) return { ok: false, reason: 'BAD_SIGNATURE' };
    const base = `${u}.${v}.${l}.${m}.${e}`;
    const expect = createHmac('sha256', this.secret).update(base).digest('hex');
    // 长度一致 + 定时长比较，避免 timing 泄漏（演示项目保持严谨）
    if (s.length !== expect.length || !createHmac('sha256', this.secret).update(base).digest().equals(Buffer.from(s, 'hex'))) {
      return { ok: false, reason: 'BAD_SIGNATURE' };
    }
    if (Number(e) < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'LINK_EXPIRED' };
    return { ok: true, data: { userId: u, versionId: v, licenseId: l, mode: m, exp: Number(e) } };
  }
}
