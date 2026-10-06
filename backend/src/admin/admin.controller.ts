import {
  BadRequestException,
  Body, Controller, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';import { createReadStream } from 'fs';
import { normalize, resolve } from 'path';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser, Roles } from '../auth/current-user.decorator';
import { AdminService, LicFilter } from './admin.service';
import { NotificationsService } from './notifications.service';

class IssueLicenseDto {
  @IsString() @IsNotEmpty()
  versionId: string;

  @IsOptional() @IsString()
  oldLicenseId?: string | null;

  @IsString() @IsNotEmpty()
  validFrom: string;

  @IsString() @IsNotEmpty()
  validUntil: string;

  @IsOptional()
  // multipart 表单中数组可能以单值或同名字段多值提交，这里兼容两种形式
  departmentIds: string[] | string;
}

class TakeDownDto {
  @IsString() @IsNotEmpty()
  reason: string;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  private readonly uploadRoot = resolve(process.cwd(), 'uploads/licenses');
  private readonly mediaRoot = resolve(process.cwd(), 'media');

  constructor(
    private admin: AdminService,
    private notifications: NotificationsService,
  ) {}

  @Post('courses')
  createCourse(@Body('title') title: string, @Body('description') description?: string) {
    return this.admin.createCourse(title, description);
  }

  @Get('departments')
  departments() {
    return this.admin.departments();
  }

  @Get('courses-versions')
  coursesWithVersions() {
    return this.admin.coursesWithVersions();
  }

  @Get('licenses')
  list(@Query('status') status?: string) {
    return this.admin.listLicenses((status as LicFilter) || 'ALL');
  }

  @Get('renew-due')
  renewDue() {
    return this.admin.renewDue();
  }

  /** 签发新许可 / 对新版本续签（multipart，必须登记许可文件） */
  @Post('licenses')
  @UseInterceptors(FileInterceptor('licenseFile'))
  issue(@UploadedFile() file: any, @Body() dto: IssueLicenseDto) {
    if (!file) throw new BadRequestException('必须上传许可文件');
    return this.admin.issueLicense({
      versionId: dto.versionId,
      oldLicenseId: dto.oldLicenseId || null,
      licenseFile: `uploads/licenses/${file.filename}`,
      licenseFileName: file.originalname,
      validFrom: new Date(dto.validFrom),
      validUntil: new Date(dto.validUntil),
      departmentIds: Array.isArray(dto.departmentIds) ? dto.departmentIds : [dto.departmentIds],
    });
  }

  /** 新建视频版本并上传本地视频文件（续签的前提：必须选择具体视频版本） */
  @Post('versions')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, resolve(process.cwd(), 'media')),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^\w.\-一-龥]+/g, '_');
          cb(null, `${Date.now()}-${safe}`);
        },
      }),
    }),
  )
  createVersion(
    @UploadedFile() file: any,
    @Body('courseId') courseId: string,
    @Body('versionLabel') versionLabel: string,
  ) {
    return this.admin.createVersion(courseId, versionLabel, `media/${file.filename}`, file.size);
  }

  @Post('licenses/:id/takedown')
  @HttpCode(200)
  takeDown(@Param('id') id: string, @Body() dto: TakeDownDto) {
    return this.admin.takeDown(id, dto.reason);
  }

  @Get('history')
  history(@Query('courseId') courseId?: string, @Query('versionId') versionId?: string) {
    return this.admin.history(courseId, versionId);
  }

  @Get('access-logs')
  accessLogs(
    @Query('result') result?: string,
    @Query('userId') userId?: string,
    @Query('versionId') versionId?: string,
    @Query('licenseId') licenseId?: string,
  ) {
    return this.admin.accessLogs({ result, userId, versionId, licenseId });
  }

  /** 管理员回查登记的许可文件（按 id 查库后再读盘，禁止任意文件读取） */
  @Get('licenses/:id/file')
  async licenseFile(@Param('id') id: string, @Res() res: Response) {
    const file = await this.admin.getLicenseFilePath(id);
    const abs = normalize(file.abs);
    if (!abs.startsWith(this.uploadRoot + '/')) {
      res.status(403).json({ message: '路径非法' });
      return;
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    createReadStream(abs).pipe(res);
  }

  // —— 模拟提醒 ——
  @Post('notifications/scan')
  scan() {
    return this.notifications.runRenewScan();
  }

  @Get('notifications')
  listNotifications() {
    return this.notifications.list();
  }

  @Post('notifications/mark-sent')
  markSent(@Body('ids') ids: string[]) {
    return this.notifications.markSent(ids || []);
  }
}
