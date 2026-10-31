import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marca una ruta como abierta (sin Bearer). Solo `GET /health`. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
