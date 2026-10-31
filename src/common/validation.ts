import {
  HttpStatus,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ApiError } from './api-error';

/**
 * ValidationPipe global (whitelist + forbidNonWhitelisted + transform). Los detalles solo
 * nombran campos y restricciones, nunca los valores recibidos (pueden ser contraseñas).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'El cuerpo de la petición no es válido',
        flatten(errors),
      ),
  });
}

function flatten(
  errors: ValidationError[],
  parent = '',
): { field: string; rules: string[] }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints
      ? [{ field, rules: Object.keys(e.constraints) }]
      : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}
