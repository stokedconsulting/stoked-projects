import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request DTO for recovering a session
 */
export class RecoverSessionDto {
  @ApiPropertyOptional({
    description: 'New machine ID to assign the session to',
    example: 'macbook-air-m2',
  })
  @IsOptional()
  @IsString()
  new_machine_id?: string;

  @ApiPropertyOptional({
    description: 'New docker slot to assign',
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  new_docker_slot?: number;

  @ApiPropertyOptional({
    description: 'Task ID to resume from (defaults to last task)',
    example: 'task-uuid-456',
  })
  @IsOptional()
  @IsString()
  resume_from_task_id?: string;
}
