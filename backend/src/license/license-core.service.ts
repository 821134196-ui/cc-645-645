import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { License, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.module';

export type DenyReason =
  | 'NO_LICENSE'
  | 'TAKEN_DOWN'
  | 'EXPIRED'
  | 'NOT_STARTED'
  | 'DEPARTMENT_MISMATCH';

export type EffectiveStatus =
  | 'ACTIVE'          // 有效，且不在续签提醒窗口
  | 'EXPIRING_SOON'   // 有效，但未来 N 天内到期
  | 'EXPIRED'         // 到期，未续签
  | 'TAKEN_DOWN'      // 管理员下架
  | 'RENEWED';        // 已被新版本的许可接替（仅历史展示）

@Injectable()
export class LicenseCoreService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  get renewWindowMs() {
    const days = Number(this.config.get<string>('RENEW_WINDOW_DAYS')) || 7;
    return days * 24 * 60 * 60 * 1000;
  }

  /** 列表/筛选使用的派生状态（绝不允许直接改 validUntil） */
  effectiveStatus(lic: License & { supersededById?: string | null }, now = new Date()): EffectiveStatus {
    if (lic.supersededById) return 'RENEWED';
    if (lic.status === 'TAKEN_DOWN') return 'TAKEN_DOWN';
    if (lic.validUntil.getTime() < now.getTime()) return 'EXPIRED';
    if (lic.validFrom.getTime() > now.getTime()) return 'EXPIRED'; // 未生效，演示中按不可用处理
    if (lic.validUntil.getTime() - now.getTime() <= this.renewWindowMs) return 'EXPIRING_SOON';
    return 'ACTIVE';
  }

  /**
   * 服务端在“打开视频/下载”时做的真正鉴权。
   * 只认真实数据：许可仍 ACTIVE（未下架）、当前时间在期限内、部门在名单内。
   */
  async authorize(
    versionId: string,
    departmentId: string,
    now = new Date(),
  ): Promise<{ allowed: true; license: License } | { allowed: false; reason: DenyReason; license: License | null }> {
    const license = await this.prisma.license.findFirst({
      where: {
        versionId,
        // 已被续签接替的许可不再生效
        supersededById: null,
        validFrom: { lte: now },
      },
      orderBy: { createdAt: 'desc' },
      include: { departments: true },
    });

    if (!license) return { allowed: false, reason: 'NO_LICENSE', license: null };
    if (license.status === 'TAKEN_DOWN') return { allowed: false, reason: 'TAKEN_DOWN', license };
    if (license.validUntil.getTime() < now.getTime()) return { allowed: false, reason: 'EXPIRED', license };
    if (!license.departments.some((d) => d.departmentId === departmentId)) {
      return { allowed: false, reason: 'DEPARTMENT_MISMATCH', license };
    }
    return { allowed: true, license };
  }

  /** 未来一周内到期且仍有效（未下架、未续签）的许可 */
  renewDueWhere(now = new Date()): Prisma.LicenseWhereInput {
    return {
      status: 'ACTIVE',
      supersededById: null,
      validUntil: { gte: now, lte: new Date(now.getTime() + this.renewWindowMs) },
    };
  }
}
