import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { License } from '@prisma/client';
import { resolve } from 'path';
import { PrismaService } from '../prisma.module';
import { LicenseCoreService } from '../license/license-core.service';

export type LicFilter = 'ALL' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'TAKEN_DOWN' | 'RENEWED';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private licenseCore: LicenseCoreService,
  ) {}

  /** 管理端课程/版本/授权总览，支持按派生授权状态筛选 */
  async listLicenses(filter: LicFilter = 'ALL') {
    const licenses = await this.prisma.license.findMany({
      orderBy: [{ validUntil: 'desc' }],
      include: {
        version: { include: { course: true } },
        departments: { include: { department: true } },
        supersededBy: { include: { version: true } },
      },
    });

    const now = new Date();
    return licenses
      .map((lic) => this.shape(lic, now))
      .filter((lic) => filter === 'ALL' || lic.effectiveStatus === filter)
      .sort((a, b) => a.validUntil.getTime() - b.validUntil.getTime());
  }

  /** 未来一周需要续签：有效且窗口内到期 */
  async renewDue() {
    const now = new Date();
    const licenses = await this.prisma.license.findMany({
      where: this.licenseCore.renewDueWhere(now),
      orderBy: { validUntil: 'asc' },
      include: {
        version: { include: { course: true } },
        departments: { include: { department: true } },
      },
    });
    return licenses.map((lic) => ({
      ...this.shape(lic, now),
      daysLeft: Math.ceil((lic.validUntil.getTime() - now.getTime()) / 86400000),
    }));
  }

  private shape(lic: License & any, now: Date) {
    return {
      id: lic.id,
      licenseFileName: lic.licenseFileName,
      licenseFile: lic.licenseFile,
      validFrom: lic.validFrom,
      validUntil: lic.validUntil,
      storedStatus: lic.status,
      takeDownReason: lic.takeDownReason,
      takenDownAt: lic.takenDownAt,
      createdAt: lic.createdAt,
      effectiveStatus: lic.supersededById ? 'RENEWED' : this.licenseCore.effectiveStatus(lic, now),
      versionId: lic.versionId,
      versionLabel: lic.version?.versionLabel,
      courseId: lic.version?.courseId,
      courseTitle: lic.version?.course?.title,
      departments: lic.departments.map((d: any) => ({ id: d.departmentId, name: d.department?.name })),
      supersededById: lic.supersededById,
      supersededByVersion: lic.supersededBy?.version?.versionLabel,
    };
  }

  async departments() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }

  async coursesWithVersions() {
    return this.prisma.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /**
   * 签发/续签统一入口：永远“新建一条许可”。
   * 续签时传 oldLicenseId —— 旧许可只允许标记被哪条新许可接替，
   * 不允许修改旧许可的截止日期。
   */
  async issueLicense(params: {
    versionId: string;
    oldLicenseId?: string | null;
    licenseFile: string;
    licenseFileName: string;
    validFrom: Date;
    validUntil: Date;
    departmentIds: string[];
  }) {
    const { versionId, oldLicenseId } = params;
    const version = await this.prisma.videoVersion.findUnique({
      where: { id: versionId },
      include: { course: true },
    });
    if (!version) throw new NotFoundException('视频版本不存在');
    if (params.validUntil.getTime() <= params.validFrom.getTime()) {
      throw new BadRequestException('截止日期必须晚于生效日期');
    }
    if (!params.departmentIds.length) throw new BadRequestException('至少选择一个可观看部门');

    let old: License | null = null;
    if (oldLicenseId) {
      old = await this.prisma.license.findUnique({ where: { id: oldLicenseId } });
      if (!old) throw new NotFoundException('被续签的旧许可不存在');
      if (old.supersededById) throw new BadRequestException('该许可已续签过，不能重复续签');
      // 续签必须选择对应视频版本：同一门课程下的版本
      const oldVersion = await this.prisma.videoVersion.findUnique({ where: { id: old.versionId } });
      if (!oldVersion || oldVersion.courseId !== version.courseId) {
        throw new BadRequestException('续签必须选择同一门课程对应的视频版本');
      }
      if (old.versionId === versionId) {
        throw new BadRequestException('不能在同一视频版本上直接延长旧许可，请使用新的视频版本续签');
      }
    }

    // 同一版本只允许有一条当前有效（未被接替、未下架）的许可链头
    const conflict = await this.prisma.license.findFirst({
      where: { versionId, supersededById: null },
    });
    if (conflict && conflict.status === 'ACTIVE') {
      throw new BadRequestException('该视频版本已存在当前许可，请在其基础上用新版本续签');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.license.create({
        data: {
          versionId,
          licenseFile: params.licenseFile,
          licenseFileName: params.licenseFileName,
          validFrom: params.validFrom,
          validUntil: params.validUntil,
          status: 'ACTIVE',
          departments: {
            create: params.departmentIds.map((departmentId) => ({ departmentId })),
          },
        },
      });
      if (old) {
        // 只建立接替关系，旧许可的任何字段（含截止日期）都不变
        await tx.license.update({
          where: { id: old.id },
          data: { supersededById: created.id },
        });
      }
      return tx.license.findUnique({
        where: { id: created.id },
        include: { version: { include: { course: true } }, departments: true },
      });
    });
  }

  /** 下架：记录原因与时间，不删除许可，历史保留 */
  async takeDown(licenseId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('下架原因必填');
    const lic = await this.prisma.license.findUnique({ where: { id: licenseId } });
    if (!lic) throw new NotFoundException('许可不存在');
    if (lic.status === 'TAKEN_DOWN') throw new BadRequestException('该许可已下架');
    return this.prisma.license.update({
      where: { id: licenseId },
      data: { status: 'TAKEN_DOWN', takeDownReason: reason.trim(), takenDownAt: new Date() },
    });
  }

  /** 历史授权：某课程下所有版本的许可链 */
  async history(courseId?: string, versionId?: string) {
    const licenses = await this.prisma.license.findMany({
      where: versionId
        ? { versionId }
        : courseId
          ? { version: { courseId } }
          : {},
      orderBy: { createdAt: 'desc' },
      include: {
        version: { include: { course: true } },
        departments: { include: { department: true } },
        supersededBy: { include: { version: true } },
      },
    });
    const now = new Date();
    return licenses.map((lic) => this.shape(lic, now));
  }

  /** 访问记录回查，可按结果/用户/版本过滤 */
  async accessLogs(params: { result?: string; userId?: string; versionId?: string; licenseId?: string; limit?: number }) {
    return this.prisma.accessLog.findMany({
      where: {
        ...(params.result ? { result: params.result } : {}),
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.versionId ? { versionId: params.versionId } : {}),
        ...(params.licenseId ? { licenseId: params.licenseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit || 200, 1000),
      include: {
        user: { include: { department: true } },
        version: { include: { course: true } },
        license: true,
      },
    });
  }

  /** 取许可文件的绝对路径（仅供管理员下载，先按 id 查库，杜绝任意文件读取） */
  async getLicenseFilePath(id: string) {
    const lic = await this.prisma.license.findUnique({ where: { id } });
    if (!lic) throw new NotFoundException('许可不存在');
    return { abs: resolve(process.cwd(), lic.licenseFile), name: lic.licenseFileName };
  }

  async createCourse(title: string, description?: string) {
    return this.prisma.course.create({ data: { title, description } });
  }

  /** 新建视频版本（续签前先上传新版本视频） */
  async createVersion(courseId: string, versionLabel: string, filePath: string, fileSize: number) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('课程不存在');
    const exists = await this.prisma.videoVersion.findUnique({
      where: { courseId_versionLabel: { courseId, versionLabel } },
    });
    if (exists) throw new BadRequestException('该课程下已存在同名版本');
    return this.prisma.videoVersion.create({ data: { courseId, versionLabel, filePath, fileSize } });
  }
}
