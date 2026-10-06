import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { LicenseCoreModule } from '../license/license-core.module';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    LicenseCoreModule,
    MulterModule.register({
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = process.cwd() + '/uploads/licenses';
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^\w.\-一-龥]+/g, '_');
          cb(null, `${Date.now()}-${safe}`);
        },
      }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, NotificationsService],
})
export class AdminModule {}
