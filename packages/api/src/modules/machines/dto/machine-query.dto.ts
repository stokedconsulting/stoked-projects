import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { MachineStatus } from '../../../schemas/machine.schema';

export class MachineQueryDto {
  @ApiPropertyOptional({
    enum: MachineStatus,
    description: 'Filter by machine status',
    example: MachineStatus.ONLINE,
  })
  @IsOptional()
  @IsEnum(MachineStatus)
  status?: MachineStatus;

  @ApiPropertyOptional({
    description: 'Filter by machine hostname',
    example: 'claude-worker-01.local',
  })
  @IsOptional()
  @IsString()
  hostname?: string;
}
