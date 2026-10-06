import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { EmployeeController } from './employee.controller';

@Module({
  controllers: [EmployeeController],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthModule {}
