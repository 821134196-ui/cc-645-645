import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, statSync, existsSync } from 'fs';
import { basename } from 'path';
import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../prisma/prisma.service';

/** 简易身份头：本地演示用 X-User-Id 传用户 ID（员工端切换登录身份） */
function getUserId(req: Request): string {
  const id = (req.headers['x-user-id'] as string) || (req.query.u as string);
  if (!id) {
    throw new Error('MISSING_USER');
  }
  return id;
}

@Controller('api')
export class EmployeeController {
  constructor(
    private authz: AuthorizationService,
    private prisma: PrismaService,
  ) {}

  /** 本地演示：用户清单（供页面顶部切换身份；真实系统应替换为登录/会话） */
  @Get('users')
  users() {
    return this.prisma.user.findMany({
      orderBy: { employeeNo: 'asc' },
      include: { department: true },
    });
  }

  @Get('me/courses')
  listCourses(@Req() req: Request) {
    return this.authz.listEmployeeCourses(getUserId(req));
  }

  /** 打开视频/下载：服务端鉴权后返回短期签名地址 */
  @Post('media/issue')
  @HttpCode(200)
  issue(
    @Req() req: Request,
    @Body() body: { versionId: string; action: 'play' | 'download' },
  ) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.authz.issueMediaUrl(
      getUserId(req),
      body.versionId,
      body.action,
      baseUrl,
      req.ip,
    );
  }

  /** 视频流：二次鉴权（签名 + 实时查库），支持播放器 Range 拖动 */
  @Get('stream')
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    const { filePath } = await this.authz.authorizeMediaRequest(query, req.ip);
    if (!existsSync(filePath)) {
      return res.status(HttpStatus.NOT_FOUND).send('视频文件缺失');
    }
    const stat = statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'range');

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize) {
        res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
          .header('Content-Range', `bytes */${fileSize}`)
          .send();
        return;
      }
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', end - start + 1);
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      createReadStream(filePath).pipe(res);
    }
  }

  /** 下载：同样二次鉴权，跨部门或旧链接无法获取文件 */
  @Get('download')
  async download(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    const { filePath, fileName } =
      await this.authz.authorizeMediaRequest(query, req.ip);
    if (!existsSync(filePath)) {
      return res.status(HttpStatus.NOT_FOUND).send('文件缺失');
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(basename(fileName))}`,
    );
    res.setHeader('Content-Type', 'video/mp4');
    createReadStream(filePath).pipe(res);
  }
}
