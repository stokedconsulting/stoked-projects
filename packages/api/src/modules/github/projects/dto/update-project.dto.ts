import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectVisibility } from './create-project.dto';

/**
 * DTO for updating a project
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({
    description: 'Updated project title',
    example: 'Q1 2026 Roadmap (Updated)',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Updated project description',
    example: 'Updated description',
  })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    description: 'Updated project visibility',
    enum: ProjectVisibility,
  })
  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @ApiPropertyOptional({
    description: 'Whether the project is closed',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  closed?: boolean;
}
