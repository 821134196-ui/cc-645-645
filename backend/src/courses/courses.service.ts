import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.module';
import { LicenseCoreService } from '../license/license-core.service';
import { SignedUrlService } from '../license/signed-url.service';

@Injectable()
export class CoursesService {
  constructor(
    private prisma: PrismaService,
    private licenseCore: LicenseCoreService,
    private signedUrl: SignedUrlService,
  ) {}

  /** 员工课程列表：展示每个版本的到期时间与当前可看状态 */
  async listForEmployee(userId: string, departmentId: string) {
    const courses = await this.prisma.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          orderBy: { createdAt: 'asc' },
          include: {
            licenses: {
              where: { supersededById: null },
              orderBy: { createdAt: 'desc' },
              include: { departments: true },
            },
          },
        },
      },
    });

    return courses.map((course) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      versions: course.versions.map((v) => {
        // 最新一条未被接替的许可
        const lic = v.licenses[0] ?? null;
        const deptGranted = !!lic?.departments.some((d) => d.departmentId === departmentId);
        const status = lic ? this.licenseCore.effectiveStatus(lic) : 'NO_LICENSE';
        const playable = lic != null && status !== 'EXPIRED' && status !== 'TAKEN_DOWN' && deptGranted;
        return {
          id: v.id,
          versionLabel: v.versionLabel,
          status,
          statusText: {
            ACTIVE: '授权有效',
            EXPIRING_SOON: '即将到期',
            EXPIRED: '已到期',
            TAKEN_DOWN: '已下架',
            RENEWED: '已续签',
            NO_LICENSE: '无授权',
          }[status as string] || status,
          deptGranted,
          playable,
          validFrom: lic?.validFrom ?? null,
          validUntil: lic?.validUntil ?? null,
          takeDownReason: lic?.takeDownReason ?? null,
          departments: lic?.departments.map((d) => d.departmentId) ?? [],
        };
      }),
    }));
  }

  /**
   * 员工打开/下载视频时调用：服务端再次检查权限，
   * 通过后才签发短时效地址（不暴露文件真实路径）。
   */
  async requestAccess(
    userId: string,
    departmentId: string,
    versionId: string,
    mode: 'STREAM' | 'DOWNLOAD',
  ) {
    const version = await this.prisma.videoVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('视频版本不存在');

    const decision = await this.licenseCore.authorize(versionId, departmentId);
    if (!decision.allowed) {
      // 被拒尝试也留痕（无签名也记录，方便回查越权访问）
      await this.prisma.accessLog.create({
        data: {
          userId, versionId,
          licenseId: decision.license?.id ?? null,
          mode, result: 'DENIED', reason: decision.reason,
        },
      });
      throw new ForbiddenException(this.denyText(decision.reason));
    }

    const signed = this.signedUrl.sign({
      userId, versionId, licenseId: decision.license.id, mode,
    });
    return {
      mode,
      // 相对 API 根路径（前端 axios baseURL 与 e2e BASE 均含 /api）
      url: `/media/${mode === 'STREAM' ? 'stream' : 'download'}/${versionId}?${signed.query}`,
      expiresIn: this.signedUrl.ttlSeconds,
      expiresAt: new Date(signed.exp * 1000).toISOString(),
      licenseId: decision.license.id,
      validUntil: decision.license.validUntil,
    };
  }

  denyText(reason: string) {
    return {
      NO_LICENSE: '该视频暂无有效授权',
      TAKEN_DOWN: '该视频已下架',
      EXPIRED: '授权已到期，请等待管理员续签',
      NOT_STARTED: '授权尚未生效',
      DEPARTMENT_MISMATCH: '您所在的部门未被授权观看该视频',
      BAD_SIGNATURE: '播放地址无效',
      LINK_EXPIRED: '播放地址已过期，请重新进入课程',
    }[reason] || '无权访问';
  }
}
