import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86400000;

/**
 * 提醒服务（模拟实现）：
 * 不真正发邮件，而是把提醒内容写入 Reminder 表，管理端可查看“已发送”记录。
 * 同一许可每天最多一条，避免重复轰炸。
 */
@Injectable()
export class ReminderService {
  constructor(private prisma: PrismaService) {}

  /** 扫描未来 days 天内到期（含已过期未处理）的生效许可，生成模拟提醒 */
  async runDueScan(days = 7, now = new Date()) {
    const cutoff = new Date(now.getTime() + days * DAY);
    const due = await this.prisma.license.findMany({
      where: { status: 'ACTIVE', validUntil: { lte: cutoff } },
      orderBy: { validUntil: 'asc' },
      include: {
        version: { include: { course: true } },
        departments: { include: { department: true } },
      },
    });

    const sent: Array<{ id: string }> = [];
    let createdCount = 0;
    for (const license of due) {
      const dayKey = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const exists = await this.prisma.reminder.findUnique({
        where: { licenseId_sentAt: { licenseId: license.id, sentAt: dayKey } },
      });
      if (exists) {
        continue;
      }

      const daysLeft = Math.ceil(
        (license.validUntil.getTime() - now.getTime()) / DAY,
      );
      const deptNames = license.departments
        .map((d) => d.department.name)
        .join('、');
      const content =
        daysLeft < 0
          ? `【模拟邮件】课程《${license.version.course.title}》版本 ${license.version.versionLabel}（讲师：${license.version.lecturer}）授权已于 ${license.validUntil.toISOString().slice(0, 10)} 到期，面向部门：${deptNames}，请立即续签或下架。`
          : `【模拟邮件】课程《${license.version.course.title}》版本 ${license.version.versionLabel}（讲师：${license.version.lecturer}）将于 ${daysLeft} 天后（${license.validUntil.toISOString().slice(0, 10)}）到期，面向部门：${deptNames}，请及时续签。`;

      const reminder = await this.prisma.reminder.create({
        data: { licenseId: license.id, channel: 'MOCK_EMAIL', content, sentAt: dayKey },
      });
      sent.push(reminder);
      createdCount++;
    }
    return { scanned: due.length, sent: createdCount, reminders: sent };
  }

  list(limit = 100) {
    return this.prisma.reminder.findMany({
      orderBy: { sentAt: 'desc' },
      take: limit,
      include: {
        license: { include: { version: { include: { course: true } } } },
      },
    });
  }
}
