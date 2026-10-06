import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CoursesModule } from './courses/courses.module';
import { MediaModule } from './media/media.module';
import { AdminModule } from './admin/admin.module';
import { PrismaModule } from './prisma.module';
import { LicenseCoreModule } from './license/license-core.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    LicenseCoreModule,
    AuthModule,
    CoursesModule,
    MediaModule,
    AdminModule,
  ],
})
export class AppModule {}
