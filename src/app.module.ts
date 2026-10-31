import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { BearerAuthGuard } from './common/bearer-auth.guard';
import { createValidationPipe } from './common/validation';
import { envValidationSchema } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      // En tests solo cuenta el entorno del proceso, nunca el .env local.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    // TasksModule → AgentModule → VncModule + LlmModule
    TasksModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: BearerAuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
