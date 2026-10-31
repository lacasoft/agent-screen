import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class DesktopDto {
  @IsUrl({
    protocols: ['wss', 'ws'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2_048)
  url!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

/** Cuerpo de POST /tasks, con los nombres literales del contrato. */
export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000)
  tarea!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => DesktopDto)
  escritorio!: DesktopDto;
}
