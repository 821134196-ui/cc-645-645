import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReminderService } from '../reminder/reminder.service';

const DAY = 86400000;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private reminders: ReminderService,
  ) {}

  // ---------- 基础数据 ----------

  listDepartments() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }

  listCourses() {
    return this.prisma.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          include: {
            licenses: {
              orderBy: { createdAt: 'desc' },
              include: { departments: true },
            },
          },
        },
      },
    });
  }

  createCourse(data: { title: string; description?: string }) {
    return this.prisma.course.create({ data });
  }

  createVersion(data: {
    courseId: string;
    versionLabel: string;
    lecturer: string;
    fileName: string;
    filePath: string;
    durationSec?: number;
  }) {
    return this.prisma.videoVersion.create({ data });
  }

  // ---------- 许可 ----------

  /**
   * 登记许可：为指定【视频版本】登记许可文件、可观看部门与截止日期，
   * 产生一条全新的 ACTIVE 许可记录。
   */
  async registerLicense(data: {
    versionId: string;
    licenseFileName: string;
    licenseFilePath: string;
    departmentIds: string[];
    validFrom: string;
    validUntil: string;
    note?: string;
  }) {
    const version = await this.prisma.videoVersion.findUnique({
      where: { id: data.versionId },
    });
    if (!version) throw new NotFoundException('视频版本不存在');
    if (!data.departmentIds.length) {
      throw new BadRequestException('至少选择一个可观看部门');
    }
    const validFrom = new Date(data.validFrom);
    const validUntil = new Date(data.validUntil);
    if (!(validUntil > validFrom)) {
      throw new BadRequestException('截止日期必须晚于生效日期');
    }

    return this.prisma.license.create({
      data: {
        versionId: data.versionId,
        licenseFileName: data.licenseFileName,
        licenseFilePath: data.licenseFilePath,
        validFrom,
        validUntil,
        note: data.note,
        departments: {
          create: data.departmentIds.map((departmentId) => ({ departmentId })),
        },
      },
      include: { departments: true },
    });
  }

  /**
   * 续签：必须选择对应视频版本，且必须【新建许可记录】。
   * 旧许可不延期、不修改，而是置为 SUPERSEDED 保留，可回查。
   */
  async renewLicense(input: {
    versionId: string;
    licenseFileName: string;
    licenseFilePath: string;
    departmentIds: string[];
    validFrom: string;
    validUntil: string;
    note?: string;
  }) {
    const version = await this.prisma.videoVersion.findUnique({
      where: { id: input.versionId },
      include: { licenses: { where: { status: 'ACTIVE' } } },
    });
    if (!version) throw new NotFoundException('视频版本不存在');
    if (version.licenses.length === 0) {
      throw new BadRequestException(
        '该版本当前没有生效中的许可，请使用“登记许可”',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // 旧记录全部标记为“已被续签替代”，保留其部门、期限与许可文件信息
      await tx.license.updateMany({
        where: { versionId: input.versionId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      });
      return tx.license.create({
        data: {
          versionId: input.versionId,
          licenseFileName: input.licenseFileName,
          licenseFilePath: input.licenseFilePath,
          validFrom: new Date(input.validFrom),
          validUntil: new Date(input.validUntil),
          note: input.note,
          departments: {
            create: input.departmentIds.map((departmentId) => ({
              departmentId,
            })),
          },
        },
        include: { departments: true },
      });
    });
    return created;
  }

  /**
   * 下架：许可置 REVOKED 并强制记录下架原因。
   * 历史记录保留；员工手中旧的播放/下载地址在下次请求时立即失效。
   */
  async revokeLicense(licenseId: string, revokeReason: string) {
    if (!revokeReason?.trim()) {
      throw new BadRequestException('下架必须填写原因');
    }
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
    });
    if (!license) throw new NotFoundException('许可不存在');
    if (license.status !== 'ACTIVE') {
      throw new BadRequestException('仅生效中的许可可以下架');
    }
    return this.prisma.license.update({
      where: { id: licenseId },
      data: { status: 'REVOKED', revokeReason: revokeReason.trim() },
    });
  }

  /** 许可列表（支持按授权状态筛选） */
  async listLicenses(status?: string) {
    const licenses = await this.prisma.license.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ validUntil: 'asc' }],
      include: {
        version: { include: { course: true } },
        departments: { include: { department: true } },
      },
    });
    const now = Date.now();
    return licenses.map((l) => ({
      ...l,
      // 动态状态：数据库状态之外，标记是否已经到期但尚未处理
      timeState:
        l.status === 'ACTIVE'
          ? now > l.validUntil.getTime()
            ? 'EXPIRED_PENDING'
            : now > l.validUntil.getTime() - 7 * DAY
              ? 'DUE_SOON'
              : 'VALID'
          : null,
    }));
  }

  /** 未来一周内需要续签的课程版本（ACTIVE 且 7 天内到期，含已过期未处理） */
  async renewalDue(days = 7) {
    const now = new Date();
    const until = new Date(now.getTime() + Number(days) * DAY);
    const licenses = await this.prisma.license.findMany({
      where: { status: 'ACTIVE', validUntil: { lte: until } },
      orderBy: { validUntil: 'asc' },
      include: {
        version: { include: { course: true } },
        departments: { include: { department: true } },
      },
    });
    return licenses.map((l) => ({
      ...l,
      overdue: l.validUntil < now,
      daysLeft: Math.ceil((l.validUntil.getTime() - now.getTime()) / DAY),
    }));
  }

  /** 某视频版本的完整授权历史（登记、续签替代、下架原因全部保留） */
  licenseHistory(versionId: string) {
    return this.prisma.license.findMany({
      where: { versionId },
      orderBy: { createdAt: 'desc' },
      include: { departments: { include: { department: true } } },
    });
  }

  findLicenseForFile(licenseId: string) {
    return this.prisma.license
      .findUniqueOrThrow({ where: { id: licenseId } })
      .catch(() => {
        throw new NotFoundException('许可不存在');
      });
  }

  // ---------- 访问记录 ----------

  async accessLogs(filter: { versionId?: string; result?: string; limit?: number }) {
    return this.prisma.accessLog.findMany({
      where: {
        versionId: filter.versionId || undefined,
        result: filter.result || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 200, 1000),
      include: {
        user: { include: { department: true } },
        version: { include: { course: true } },
      },
    });
  }
}
