import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync } from 'fs';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { ReminderService } from '../reminder/reminder.service';

const videoStorage = diskStorage({
  destination: join(process.cwd(), 'storage/videos'),
  filename: (_req, file, cb) => {
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const licenseStorage = diskStorage({
  destination: join(process.cwd(), 'storage/licenses'),
  filename: (_req, file, cb) => {
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}-${safe}`);
  },
});

@Controller('api/admin')
export class AdminController {
  constructor(
    private admin: AdminService,
    private reminders: ReminderService,
  ) {}

  @Get('departments')
  departments() {
    return this.admin.listDepartments();
  }

  @Get('courses')
  courses() {
    return this.admin.listCourses();
  }

  @Post('courses')
  createCourse(@Body() body: { title: string; description?: string }) {
    if (!body.title?.trim()) throw new BadRequestException('课程名称必填');
    return this.admin.createCourse({
      title: body.title.trim(),
      description: body.description,
    });
  }

  /** 上传视频文件并登记新版本（视频存放在本地 storage/videos） */
  @Post('versions')
  @UseInterceptors(FileInterceptor('file', { storage: videoStorage }))
  createVersion(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      courseId: string;
      versionLabel: string;
      lecturer: string;
      durationSec?: string;
    },
  ) {
    if (!file) throw new BadRequestException('请上传视频文件');
    return this.admin.createVersion({
      courseId: body.courseId,
      versionLabel: body.versionLabel,
      lecturer: body.lecturer,
      fileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      filePath: file.path,
      durationSec: body.durationSec ? Number(body.durationSec) : undefined,
    });
  }

  // ---------- 许可登记 / 续签 / 下架 ----------

  @Post('licenses')
  @UseInterceptors(FileInterceptor('licenseFile', { storage: licenseStorage }))
  registerLicense(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      versionId: string;
      departmentIds: string | string[];
      validFrom: string;
      validUntil: string;
      note?: string;
    },
  ) {
    if (!file) throw new BadRequestException('请上传许可文件');
    return this.admin.registerLicense({
      versionId: body.versionId,
      licenseFileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      licenseFilePath: file.path,
      departmentIds: this.parseDepartments(body.departmentIds),
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      note: body.note,
    });
  }

  /**
   * 续签：前端必须指定视频版本并重新上传新许可文件，
   * 服务端创建全新许可记录，旧记录置 SUPERSEDED 保留。
   */
  @Post('licenses/renew')
  @UseInterceptors(FileInterceptor('licenseFile', { storage: licenseStorage }))
  renewLicense(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      versionId: string;
      departmentIds: string | string[];
      validFrom: string;
      validUntil: string;
      note?: string;
    },
  ) {
    if (!file) throw new BadRequestException('续签必须上传新的许可文件');
    return this.admin.renewLicense({
      versionId: body.versionId,
      licenseFileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      licenseFilePath: file.path,
      departmentIds: this.parseDepartments(body.departmentIds),
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      note: body.note,
    });
  }

  @Post('licenses/:id/revoke')
  revoke(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.admin.revokeLicense(id, body.reason);
  }

  @Get('licenses')
  listLicenses(@Query('status') status?: string) {
    return this.admin.listLicenses(status);
  }

  @Get('renewals-due')
  renewalsDue(@Query('days') days?: string) {
    return this.admin.renewalDue(days ? Number(days) : 7);
  }

  @Get('versions/:id/license-history')
  history(@Param('id') id: string) {
    return this.admin.licenseHistory(id);
  }

  @Get('access-logs')
  accessLogs(
    @Query('versionId') versionId?: string,
    @Query('result') result?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.accessLogs({
      versionId,
      result,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 查看/下载登记的许可文件（仅管理端） */
  @Get('licenses/:id/file')
  licenseFile(@Param('id') id: string, @Res() res: Response) {
    return this.admin.findLicenseForFile(id).then((license) => {
      if (!existsSync(license.licenseFilePath)) {
        return res.status(404).send('许可文件缺失');
      }
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(license.licenseFileName)}`,
      );
      res.sendFile(license.licenseFilePath);
    });
  }

  // ---------- 模拟提醒 ----------

  /** 手动触发扫描（真实系统可由定时任务调用，这里提供接口模拟） */
  @Post('reminders/scan')
  scan(@Query('days') days?: string) {
    return this.reminders.runDueScan(days ? Number(days) : 7);
  }

  @Get('reminders')
  listReminders(@Query('limit') limit?: string) {
    return this.reminders.list(limit ? Number(limit) : 100);
  }

  private parseDepartments(raw: string | string[]): string[] {
    if (Array.isArray(raw)) return raw;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [raw];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
}
