import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream, statSync } from 'fs';
import { join, resolve, normalize } from 'path';
import { PrismaService } from '../prisma.module';
import { LicenseCoreService } from '../license/license-core.service';
import { SignedUrlService } from '../license/signed-url.service';

export interface MediaContext {
  versionId: string;
  licenseId: string;
  mode: 'STREAM' | 'DOWNLOAD';
}

@Injectable()
export class MediaService {
  private readonly mediaRoot = resolve(process.cwd(), 'media');

  constructor(
    private prisma: PrismaService,
    private signedUrl: SignedUrlService,
    private licenseCore: LicenseCoreService,
  ) {}

  /**
   * 媒体访问的最终闸门。即使员工手里有之前拿到的地址，
   * 这里仍会重新校验：登录身份、签名（含绑定的人/版本/许可/模式/短时效）、
   * 以及数据库中该许可此刻是否仍有效且覆盖其部门。
   */
  async guard(
    jwtUser: { sub: string; dept: string },
    query: Record<string, any>,
    expectedMode: 'STREAM' | 'DOWNLOAD',
  ): Promise<MediaContext> {
    const fail = async (reason: string, versionId?: string, licenseId?: string) => {
      await this.prisma.accessLog.create({
        data: {
          userId: jwtUser.sub,
          versionId: versionId || query.v || 'unknown',
          licenseId: licenseId || query.l || null,
          mode: expectedMode, result: 'DENIED', reason,
          ip: query._ip as string,
        },
      }).catch(() => undefined);
      throw new ForbiddenException(reason);
    };

    const sig = this.signedUrl.verify(query);
    if (!sig.ok) return fail(sig.reason!);
    const { userId, versionId, licenseId, mode } = sig.data;

    // 签名地址只能本人使用，且播放/下载用途不可互换
    if (userId !== jwtUser.sub) return fail('USER_MISMATCH', versionId, licenseId);
    if (mode !== expectedMode) return fail('MODE_MISMATCH', versionId, licenseId);

    // 签名里写的许可必须仍是当前生效的那一条：
    // 到期/下架/被续签接替后，旧地址立即失效
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      include: { departments: true },
    });
    if (!license) return fail('NO_LICENSE', versionId, licenseId);
    if (license.versionId !== versionId) return fail('BAD_SIGNATURE', versionId, licenseId);
    if (license.status === 'TAKEN_DOWN') return fail('TAKEN_DOWN', versionId, licenseId);
    if (license.validUntil.getTime() < Date.now()) return fail('EXPIRED', versionId, licenseId);
    if (license.validFrom.getTime() > Date.now()) return fail('NOT_STARTED', versionId, licenseId);
    if (license.supersededById) return fail('RENEWED', versionId, licenseId);
    if (!license.departments.some((d) => d.departmentId === jwtUser.dept)) {
      return fail('DEPARTMENT_MISMATCH', versionId, licenseId);
    }

    await this.prisma.accessLog.create({
      data: {
        userId: jwtUser.sub, versionId, licenseId,
        mode: expectedMode, result: 'ALLOWED', ip: query._ip,
      },
    });
    return { versionId, licenseId, mode: expectedMode };
  }

  resolveFile(versionId: string) {
    return this.prisma.videoVersion.findUnique({ where: { id: versionId } }).then((v) => {
      if (!v) throw new NotFoundException('视频版本不存在');
      // 规范化后必须仍在 media 目录内，防止任何路径穿越读到其他文件
      const abs = normalize(resolve(process.cwd(), v.filePath));
      if (abs !== this.mediaRoot && !abs.startsWith(this.mediaRoot + '/')) {
        throw new ForbiddenException('文件路径非法');
      }
      let st;
      try { st = statSync(abs); } catch { throw new NotFoundException('视频文件缺失'); }
      return { abs, size: st.size, version: v };
    });
  }

  openStream(abs: string, start?: number, end?: number) {
    return createReadStream(abs, start != null ? { start, end } : {});
  }
}
