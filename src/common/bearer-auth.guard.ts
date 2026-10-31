import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ApiError } from './api-error';
import { IS_PUBLIC } from './public.decorator';

/**
 * Bearer obligatorio en todo salvo rutas @Public (ADR-0010). Se comparan los SHA-256 con
 * timingSafeEqual: tiempo constante y sin filtrar la longitud del token.
 */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.expected = digest(config.getOrThrow<string>('AGENT_API_TOKEN'));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
    if (!match || !timingSafeEqual(digest(match[1].trim()), this.expected)) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Token Bearer ausente o inválido',
      );
    }
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
