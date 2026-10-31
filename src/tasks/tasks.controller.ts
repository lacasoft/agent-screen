import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';
import type {
  TaskCreatedResponse,
  TaskStatusResponse,
} from './dto/task.responses';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** 200 con `{"task_id"}` en < 2 s; la ejecución sigue en segundo plano. */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateTaskDto): TaskCreatedResponse {
    return this.tasks.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string): TaskStatusResponse {
    return this.tasks.get(id);
  }
}
