import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from './api-error';

const CODE_BY_STATUS: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Todos los errores salen como `{ code, message, details? }`. Los 5xx nunca filtran internals:
 * se loguea solo el nombre y el mensaje del error (nunca el body de la petición).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json(toBody(exception, status));
      return;
    }
    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`${err.name}: ${err.message}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servicio',
    } satisfies ApiErrorBody);
  }
}

function toBody(exception: HttpException, status: number): ApiErrorBody {
  const response = exception.getResponse();
  if (isApiErrorBody(response)) return response;
  const code =
    CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR');
  const message =
    status >= 500
      ? 'Error interno del servicio'
      : exception.message || 'Error en la petición';
  return { code, message };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).code === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}
