import { IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Query DTO for finding recoverable sessions
 */
export class RecoverableSessionsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by project ID',
    example: '123',
  })
  @IsOptional()
  @IsString()
  project_id?: string;

  @ApiPropertyOptional({
    description: 'Filter by machine ID',
    example: 'macbook-pro-m1',
  })
  @IsOptional()
  @IsString()
  machine_id?: string;

  @ApiPropertyOptional({
    description: 'Maximum age in minutes (sessions older than this are excluded)',
    example: 60,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  max_age_minutes?: number;

  @ApiPropertyOptional({
    description: 'Minimum age in minutes (sessions newer than this are excluded)',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_age_minutes?: number;
}
