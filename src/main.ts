import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { nestLogLevels } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  app.useLogger(nestLogLevels(config.get<string>('LOG_LEVEL')));
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
