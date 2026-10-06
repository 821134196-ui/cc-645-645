import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { basename } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private media: MediaService) {}

  /** 在线播放：支持 Range 拖放；每次请求都重新过鉴权 */
  @Get('stream/:versionId')
  async stream(
    @CurrentUser() user: any,
    @Param('versionId') versionId: string,
    @Query() query: Record<string, any>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    query._ip = req.ip;
    await this.media.guard(user, query, 'STREAM');
    const file = await this.media.resolveFile(versionId);

    const range = req.headers.range;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : file.size - 1;
      if (start >= file.size || end >= file.size) {
        res.status(416).header('Content-Range', `bytes */${file.size}`).end();
        return;
      }
      res.status(206).header({
        'Content-Range': `bytes ${start}-${end}/${file.size}`,
        'Content-Length': String(end - start + 1),
      });
      this.media.openStream(file.abs, start, end).pipe(res);
    } else {
      res.header('Content-Length', String(file.size));
      this.media.openStream(file.abs).pipe(res);
    }
  }

  /** 下载：同样每次重新鉴权，禁止直接拿旧链接跨部门/到期下载 */
  @Get('download/:versionId')
  async download(
    @CurrentUser() user: any,
    @Param('versionId') versionId: string,
    @Query() query: Record<string, any>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    query._ip = req.ip;
    await this.media.guard(user, query, 'DOWNLOAD');
    const file = await this.media.resolveFile(versionId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(basename(file.abs))}`,
    );
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'private, no-store');
    this.media.openStream(file.abs).pipe(res);
  }
}
