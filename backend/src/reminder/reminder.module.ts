import { Global, Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';

@Global()
@Module({
  providers: [ReminderService],
  exports: [ReminderService],
})
export class ReminderModule {}
