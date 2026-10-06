import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.module';
import { LicenseCoreService } from '../license/license-core.service';

/**
 * 提醒服务（模拟实现）：
 * 真实系统可替换为邮件/企业 IM 推送；这里只落库 Notification 并打日志。
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications(mock)');

  constructor(
    private prisma: PrismaService,
    private licenseCore: LicenseCoreService,
  ) {}

  /** 扫描未来一周需要续签的许可，生成/刷新模拟提醒 */
  async runRenewScan() {
    const now = new Date();
    const due = await this.prisma.license.findMany({
      where: this.licenseCore.renewDueWhere(now),
      include: { version: { include: { course: true } } },
    });

    const results: any[] = [];
    for (const lic of due) {
      const message =
        `【模拟提醒】课程《${lic.version.course.title}》${lic.version.versionLabel} 的授权将于 ` +
        `${lic.validUntil.toLocaleString('zh-CN')} 到期，请及时续签（许可文件：${lic.licenseFileName}）`;

      // 同一许可保留最近一条未处理提醒，避免重复轰炸；历史可另存
      const existing = await this.prisma.notification.findFirst({
        where: { licenseId: lic.id, type: 'RENEW_DUE' },
        orderBy: { createdAt: 'desc' },
      });

      let notif;
      if (existing && !existing.sent) {
        notif = await this.prisma.notification.update({
          where: { id: existing.id },
          data: { message },
        });
      } else {
        notif = await this.prisma.notification.create({
          data: {
            type: 'RENEW_DUE',
            licenseId: lic.id,
            versionId: lic.versionId,
            message,
            sent: false,
          },
        });
      }
      // 模拟“发送”动作：打印到服务端日志
      this.logger.log(`>>> [MOCK 发送给管理员] ${message}`);
      results.push(notif);
    }
    return {
      scannedAt: now.toISOString(),
      renewWindowDays: this.licenseCore.renewWindowMs / 86400000,
      dueCount: due.length,
      notifications: results,
    };
  }

  /** 管理员确认已处理，标记提醒为已发送/已处理 */
  async markSent(ids: string[]) {
    await this.prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: { sent: true },
    });
    return { updated: ids.length };
  }

  list() {
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
