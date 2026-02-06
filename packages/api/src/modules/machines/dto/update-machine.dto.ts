import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsEnum, IsObject, IsOptional, ArrayUnique, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MachineStatus } from '../../../schemas/machine.schema';

export class UpdateMachineDto {
  @ApiPropertyOptional({
    description: 'List of available docker slot numbers (unique positive integers)',
    example: [1, 2, 3, 4, 5],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @ArrayUnique()
  @Type(() => Number)
  docker_slots?: number[];

  @ApiPropertyOptional({
    enum: MachineStatus,
    description: 'Machine availability status',
    example: MachineStatus.ONLINE,
  })
  @IsOptional()
  @IsEnum(MachineStatus)
  status?: MachineStatus;

  @ApiPropertyOptional({
    description: 'Machine specifications and OS information',
    example: { os: 'Ubuntu 22.04', cpu: '8 cores', memory: '32GB' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
