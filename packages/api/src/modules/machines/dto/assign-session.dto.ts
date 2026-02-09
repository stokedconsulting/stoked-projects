import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignSessionDto {
  @ApiProperty({
    description: 'Session ID to assign to this machine',
    example: 'session-xyz789',
  })
  @IsString()
  session_id: string;

  @ApiPropertyOptional({
    description: 'Specific docker slot to assign (optional - will auto-assign if not provided)',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  docker_slot?: number;
}
