import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/public.decorator';

@Controller('health')
export class HealthController {
  /** Abierto (sin Bearer): 200 cuando el servicio acepta tareas. */
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
