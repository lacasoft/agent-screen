import { HttpException, HttpStatus } from '@nestjs/common';

/** Envelope de error del servicio: `{ code, message, details? }`. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details?: unknown,
  ) {
    const body: ApiErrorBody = { code, message };
    if (details !== undefined) body.details = details;
    super(body, status);
  }
}
