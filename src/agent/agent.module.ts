import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { TASK_EXECUTOR } from '../tasks/tasks.constants';
import { VncModule } from '../vnc/vnc.module';
import { ScreenAgent } from './screen-agent';

/** Provee el agente real como TaskExecutor (sustituye al ejecutor provisional). */
@Module({
  imports: [VncModule, LlmModule],
  providers: [
    ScreenAgent,
    { provide: TASK_EXECUTOR, useExisting: ScreenAgent },
  ],
  exports: [TASK_EXECUTOR],
})
export class AgentModule {}
