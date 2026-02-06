import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarkFailedDto {
  @ApiProperty({
    description: 'Reason for session failure',
    example: 'Claude process crashed unexpectedly',
  })
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    description: 'Additional error details (stack trace, error code, etc.)',
    example: {
      error_code: 'ERR_CLAUDE_CRASH',
      stack_trace: 'Error: ...',
      exit_code: 1,
    },
  })
  @IsOptional()
  @IsObject()
  error_details?: Record<string, any>;
}
