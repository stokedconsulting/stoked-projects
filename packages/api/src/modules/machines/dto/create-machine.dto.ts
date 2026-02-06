import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsNumber, IsObject, IsOptional, ArrayUnique, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMachineDto {
  @ApiProperty({
    description: 'Unique machine identifier',
    example: 'machine-abc123',
  })
  @IsString()
  machine_id: string;

  @ApiProperty({
    description: 'Machine hostname',
    example: 'claude-worker-01.local',
  })
  @IsString()
  hostname: string;

  @ApiProperty({
    description: 'List of available docker slot numbers (unique positive integers)',
    example: [1, 2, 3, 4, 5],
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @ArrayUnique()
  @Type(() => Number)
  docker_slots: number[];

  @ApiPropertyOptional({
    description: 'Machine specifications and OS information',
    example: { os: 'Ubuntu 22.04', cpu: '8 cores', memory: '32GB' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
