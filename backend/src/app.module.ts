import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ReminderModule } from './reminder/reminder.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [PrismaModule, ReminderModule, AuthModule, AdminModule],
})
export class AppModule {}
