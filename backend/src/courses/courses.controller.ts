import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CoursesService } from './courses.service';

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(private courses: CoursesService) {}

  @Get('mine')
  mine(@CurrentUser() user: any) {
    return this.courses.listForEmployee(user.sub, user.dept);
  }

  @Post(':versionId/access')
  access(
    @CurrentUser() user: any,
    @Param('versionId') versionId: string,
    @Query('mode') mode: string,
  ) {
    const m = mode === 'DOWNLOAD' ? 'DOWNLOAD' : 'STREAM';
    return this.courses.requestAccess(user.sub, user.dept, versionId, m);
  }
}
