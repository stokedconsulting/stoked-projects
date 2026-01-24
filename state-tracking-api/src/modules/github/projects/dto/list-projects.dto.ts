import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for listing repository-linked projects
 */
export class ListRepoProjectsDto {
  @ApiProperty({
    description: 'Repository owner (org or user)',
    example: 'anthropics',
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: 'Repository name',
    example: 'claude-projects',
  })
  @IsString()
  @IsNotEmpty()
  repo: string;
}

/**
 * DTO for listing organization projects
 */
export class ListOrgProjectsDto {
  @ApiProperty({
    description: 'Organization name',
    example: 'anthropics',
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiPropertyOptional({
    description: 'Number of projects to fetch (max 100)',
    example: 20,
    default: 100,
  })
  @IsOptional()
  first?: number;
}
