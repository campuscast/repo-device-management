import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '@campuscast/shared-libs';

@Injectable()
export class InternalOrJwtGuard implements CanActivate {
  private readonly logger = new Logger(InternalOrJwtGuard.name);
  private readonly internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || '';
  private readonly jwtGuard = new JwtAuthGuard();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const internalHeader = request.headers['x-internal-token'];
    const presentedInternalToken = Array.isArray(internalHeader) ? internalHeader[0] : internalHeader;

    if (this.internalServiceToken && presentedInternalToken && presentedInternalToken === this.internalServiceToken) {
      request.internalAuth = { service: true };
      this.logger.log('Internal service auth granted');
      return true;
    }

    return this.jwtGuard.canActivate(context);
  }
}
