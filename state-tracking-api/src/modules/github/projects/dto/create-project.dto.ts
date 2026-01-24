import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Project visibility enum
 */
export enum ProjectVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

/**
 * DTO for creating a new project
 */
export class CreateProjectDto {
  @ApiProperty({
    description: 'Organization or user login',
    example: 'anthropics',
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: 'Project title',
    example: 'Q1 2026 Roadmap',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    description: 'Project description',
    example: 'Tracking Q1 2026 initiatives',
  })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    description: 'Project visibility',
    enum: ProjectVisibility,
    default: ProjectVisibility.PRIVATE,
  })
  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @ApiPropertyOptional({
    description: 'Repository ID to link project to (optional)',
    example: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
  })
  @IsOptional()
  @IsString()
  repositoryId?: string;
}
