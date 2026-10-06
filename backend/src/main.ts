import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppModule } from './app.module';
import { ReminderService } from './reminder/reminder.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();

  // 生产模式下直接托管前端打包产物（单条本地命令启动后访问 http://localhost:3000）
  const frontendDist = join(process.cwd(), '../frontend/dist');
  if (existsSync(frontendDist)) {
    app.useStaticAssets(frontendDist);
  }

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);

  // 启动时执行一次模拟提醒扫描；之后每 24 小时扫描一次（模拟定时任务）
  const reminders = app.get(ReminderService);
  await reminders.runDueScan(7).catch(() => undefined);
  setInterval(() => {
    reminders.runDueScan(7).catch(() => undefined);
  }, 24 * 60 * 60 * 1000).unref();

  console.log('服务已启动: http://localhost:3000');
}
bootstrap();
