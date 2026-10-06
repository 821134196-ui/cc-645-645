import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    // 媒体端点同时支持 query token（<video> 标签无法带自定义头）
    const token = auth?.startsWith('Bearer ')
      ? auth.slice(7)
      : (req.query.token as string | undefined);
    if (!token) throw new UnauthorizedException('未登录');
    try {
      req.user = await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('登录已失效');
    }
  }
}
