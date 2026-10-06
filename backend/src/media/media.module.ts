import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LicenseCoreModule } from '../license/license-core.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [ConfigModule, LicenseCoreModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
