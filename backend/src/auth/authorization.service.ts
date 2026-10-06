import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MediaAction,
  signMediaUrl,
  verifyMediaToken,
  VerifiedToken,
} from './signing';

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  licenseId?: string;
}

@Injectable()
export class AuthorizationService {
  constructor(private prisma: PrismaService) {}

  /**
   * 核心鉴权：某用户此刻能否访问某视频版本。
   * 条件全部满足才放行：
   *  1. 存在 ACTIVE 许可（未下架、未被续签替代）
   *  2. 当前时间落在 [validFrom, validUntil] 内（已到期则拒绝）
   *  3. 许可的可观看部门包含用户所在部门（跨部门拒绝）
   */
  async checkAccess(
    versionId: string,
    departmentId: string,
    now: Date = new Date(),
  ): Promise<AccessDecision> {
    const version = await this.prisma.videoVersion.findUnique({
      where: { id: versionId },
      include: {
        licenses: {
          where: { status: 'ACTIVE' },
          include: { departments: true },
        },
      },
    });
    if (!version) return { allowed: false, reason: 'VIDEO_NOT_FOUND' };

    for (const license of version.licenses) {
      const deptOk = license.departments.some(
        (d) => d.departmentId === departmentId,
      );
      if (!deptOk) continue;
      if (now < license.validFrom) continue;
      if (now > license.validUntil) {
        return {
          allowed: false,
          reason: 'LICENSE_EXPIRED',
          licenseId: license.id,
        };
      }
      return { allowed: true, reason: 'OK', licenseId: license.id };
    }

    // 区分“从未授权给该部门”与“授权过但已下架/被替代”，便于记录与提示
    const anyDeptLicense = await this.prisma.license.findFirst({
      where: {
        versionId,
        departments: { some: { departmentId } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!anyDeptLicense) return { allowed: false, reason: 'DEPARTMENT_NOT_LICENSED' };
    return { allowed: false, reason: `NO_ACTIVE_LICENSE:${anyDeptLicense.status}` };
  }

  /** 员工课程列表：只列出本部门曾被授权的版本，附带当前状态与到期时间 */
  async listEmployeeCourses(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { department: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const now = new Date();

    const courses = await this.prisma.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          include: {
            licenses: {
              include: { departments: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    const result: Array<{
      courseId: string;
      title: string;
      description: string | null;
      versions: Array<{
        versionId: string;
        versionLabel: string;
        lecturer: string;
        durationSec: number | null;
        status: string;
        validUntil: Date;
        daysLeft: number;
      }>;
    }> = [];
    for (const course of courses) {
      const visibleVersions: (typeof result)[number]['versions'] = [];
      for (const v of course.versions) {
        const deptLicenses = v.licenses.filter((l) =>
          l.departments.some((d) => d.departmentId === user.departmentId),
        );
        if (deptLicenses.length === 0) continue; // 未授权给本部门的版本不可见
        const decision = await this.checkAccess(v.id, user.departmentId, now);
        // 找到判定所依据的许可（生效中的或最近一条）
        const effective =
          deptLicenses.find((l) => l.id === decision.licenseId) ??
          deptLicenses[0];
        visibleVersions.push({
          versionId: v.id,
          versionLabel: v.versionLabel,
          lecturer: v.lecturer,
          durationSec: v.durationSec,
          status: decision.allowed
            ? 'AVAILABLE'
            : decision.reason === 'LICENSE_EXPIRED'
              ? 'EXPIRED'
              : effective.status === 'REVOKED'
                ? 'REVOKED'
                : 'UNAVAILABLE',
          validUntil: effective.validUntil,
          daysLeft: decision.allowed
            ? Math.ceil(
                (effective.validUntil.getTime() - now.getTime()) / 86400000,
              )
            : 0,
        });
      }
      if (visibleVersions.length > 0) {
        result.push({
          courseId: course.id,
          title: course.title,
          description: course.description,
          versions: visibleVersions,
        });
      }
    }
    return { employee: { id: user.id, name: user.name, department: user.department.name }, courses: result };
  }

  /** 员工打开视频时换取短期签名地址：服务端第一次鉴权并留痕 */
  async issueMediaUrl(
    userId: string,
    versionId: string,
    action: MediaAction,
    baseUrl: string,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    const decision = await this.checkAccess(versionId, user.departmentId);

    await this.prisma.accessLog.create({
      data: {
        userId: user.id,
        versionId,
        licenseId: decision.licenseId,
        action: action === 'play' ? 'ISSUE_PLAY' : 'ISSUE_DOWNLOAD',
        result: decision.allowed ? 'GRANTED' : 'DENIED',
        reason: decision.reason,
        ip,
      },
    });

    if (!decision.allowed) {
      throw new ForbiddenException(
        this.humanReason(decision.reason),
      );
    }

    const expiresAt = Date.now() + 10 * 60 * 1000;
    const url = signMediaUrl({
      baseUrl,
      path: action === 'play' ? '/api/stream' : '/api/download',
      versionId,
      userId,
      action,
      expiresAt,
    });
    return { url, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * 视频流/下载的最终鉴权：签名合法之外，再查一次库。
   * 这样即使员工拿到的是之前合法签发的地址，许可一旦到期或下架，地址立即失效。
   */
  async authorizeMediaRequest(
    query: Record<string, string>,
    ip?: string,
  ): Promise<{ token: VerifiedToken; filePath: string; fileName: string; licenseId: string }> {
    const token = verifyMediaToken(query);
    const deny = async (reason: string, versionId?: string, userId?: string) => {
      await this.prisma.accessLog.create({
        data: {
          userId: userId ?? null,
          versionId: versionId ?? null,
          action: query.a === 'download' ? 'DOWNLOAD' : 'STREAM',
          result: 'DENIED',
          reason,
          ip,
        },
      });
      throw new ForbiddenException(this.humanReason(reason));
    };

    if (!token) return deny('INVALID_OR_EXPIRED_URL', query.v, query.u);

    const user = await this.prisma.user.findUnique({
      where: { id: token.userId },
    });
    if (!user) return deny('USER_NOT_FOUND', token.versionId, token.userId);

    const decision = await this.checkAccess(token.versionId, user.departmentId);
    if (!decision.allowed || !decision.licenseId) {
      return deny(decision.reason, token.versionId, token.userId);
    }

    const version = await this.prisma.videoVersion.findUnique({
      where: { id: token.versionId },
    });
    if (!version) {
      return deny('VIDEO_NOT_FOUND', token.versionId, token.userId);
    }

    await this.prisma.accessLog.create({
      data: {
        userId: user.id,
        versionId: token.versionId,
        licenseId: decision.licenseId,
        action: token.action === 'play' ? 'STREAM' : 'DOWNLOAD',
        result: 'GRANTED',
        reason: 'OK',
        ip,
      },
    });

    return {
      token,
      filePath: version.filePath,
      fileName: version.fileName,
      licenseId: decision.licenseId,
    };
  }

  private humanReason(reason: string): string {
    const map: Record<string, string> = {
      VIDEO_NOT_FOUND: '视频版本不存在',
      LICENSE_EXPIRED: '授权已到期',
      DEPARTMENT_NOT_LICENSED: '您所在部门未获得该课程授权',
      INVALID_OR_EXPIRED_URL: '播放地址无效或已过期，请重新打开视频',
      USER_NOT_FOUND: '用户不存在',
    };
    if (map[reason]) return map[reason];
    if (reason.startsWith('NO_ACTIVE_LICENSE:')) {
      const status = reason.split(':')[1];
      if (status === 'REVOKED') return '该课程已被管理员下架';
      return '当前无有效授权（原授权已被新版许可替代）';
    }
    return '无权访问';
  }
}
