import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TasksModule } from './tasks/tasks.module';
import { AgentModule } from './agent/agent.module';
import { VncModule } from './vnc/vnc.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [TasksModule, AgentModule, VncModule, LlmModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
