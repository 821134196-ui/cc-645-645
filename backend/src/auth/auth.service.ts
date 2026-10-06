import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.module';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(account: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { account },
      include: { department: true },
    });
    if (!user || user.password !== password) {
      throw new UnauthorizedException('账号或密码错误');
    }
    const token = await this.jwt.signAsync({
      sub: user.id,
      account: user.account,
      role: user.role,
      dept: user.departmentId,
    });
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        account: user.account,
        role: user.role,
        department: { id: user.department.id, name: user.department.name },
      },
    };
  }
}
