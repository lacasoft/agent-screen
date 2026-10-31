import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DesktopLeases } from './desktop-lease';
import { SqliteTaskRepository } from './sqlite/sqlite-task.repository';
import { UnavailableAgentExecutor } from './task-executor';
import { TaskRunner } from './task-runner';
import type { TaskRepository } from './task.repository';
import { TASK_EXECUTOR, TASK_REPOSITORY } from './tasks.constants';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [
    {
      provide: TASK_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SqliteTaskRepository(config.getOrThrow<string>('DATABASE_PATH')),
    },
    // Provisional: el AgentModule lo sustituirá por el agente real.
    { provide: TASK_EXECUTOR, useClass: UnavailableAgentExecutor },
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
