import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LicenseCoreService } from './license-core.service';
import { SignedUrlService } from './signed-url.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LicenseCoreService, SignedUrlService],
  exports: [LicenseCoreService, SignedUrlService],
})
export class LicenseCoreModule {}
