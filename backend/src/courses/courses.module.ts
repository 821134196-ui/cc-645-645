import { Module } from '@nestjs/common';
import { LicenseCoreModule } from '../license/license-core.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [LicenseCoreModule],
  controllers: [CoursesController],
  providers: [CoursesService],
})
export class CoursesModule {}
