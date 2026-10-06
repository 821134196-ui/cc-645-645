import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../prisma.module';

class LoginDto {
  @IsString() @IsNotEmpty()
  account: string;

  @IsString() @IsNotEmpty()
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.account, dto.password);
  }

  /** 演示环境：直接拿到可选账号列表，便于登录页切换 */
  @Get('users')
  users() {
    return this.prisma.user.findMany({
      select: {
        id: true, account: true, name: true, role: true,
        department: { select: { name: true } },
      },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    return user;
  }
}
