import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentModule } from '../agent/agent.module';
import { DesktopLeases } from './desktop-lease';
import { SqliteTaskRepository } from './sqlite/sqlite-task.repository';
import { TaskRunner } from './task-runner';
import type { TaskRepository } from './task.repository';
import { TASK_REPOSITORY } from './tasks.constants';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  // El agente (AgentModule) aporta el TaskExecutor real.
  imports: [AgentModule],
  controllers: [TasksController],
  providers: [
    {
      provide: TASK_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SqliteTaskRepository(config.getOrThrow<string>('DATABASE_PATH')),
    },
    DesktopLeases,
    TaskRunner,
    TasksService,
  ],
})
export class TasksModule implements OnModuleDestroy {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repository: TaskRepository,
  ) {}

  onModuleDestroy(): void {
    if (this.repository instanceof SqliteTaskRepository)
      this.repository.close();
  }
}
