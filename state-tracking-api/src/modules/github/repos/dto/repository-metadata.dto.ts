import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, IsOptional, IsNumber } from 'class-validator';

/**
 * Repository metadata response DTO
 */
export class RepositoryMetadataDto {
  @ApiProperty({
    description: 'GitHub repository ID',
    example: 'R_kgDOK1234',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Repository name',
    example: 'my-repo',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Repository owner login',
    example: 'octocat',
  })
  @IsString()
  owner: string;

  @ApiProperty({
    description: 'Repository description',
    example: 'A sample repository',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Repository URL',
    example: 'https://github.com/octocat/my-repo',
  })
  @IsString()
  url: string;

  @ApiProperty({
    description: 'Default branch name',
    example: 'main',
  })
  @IsString()
  defaultBranch: string;

  @ApiProperty({
    description: 'Whether the repository is private',
    example: false,
  })
  @IsBoolean()
  isPrivate: boolean;

  @ApiProperty({
    description: 'Linked projects (only included when include_projects=true)',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        url: { type: 'string' },
        number: { type: 'number' },
      },
    },
    required: false,
  })
  @IsOptional()
  projects?: Array<{
    id: string;
    title: string;
    url: string;
    number: number;
  }>;
}

/**
 * Organization metadata response DTO
 */
export class OrganizationMetadataDto {
  @ApiProperty({
    description: 'GitHub organization ID',
    example: 'O_kgDOK5678',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Organization login',
    example: 'my-org',
  })
  @IsString()
  login: string;

  @ApiProperty({
    description: 'Organization name',
    example: 'My Organization',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Organization description',
    example: 'An awesome organization',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Organization URL',
    example: 'https://github.com/my-org',
  })
  @IsString()
  url: string;

  @ApiProperty({
    description: 'Number of ProjectsV2 in the organization',
    example: 42,
  })
  @IsNumber()
  projectsV2Count: number;
}

/**
 * Linked projects response DTO
 */
export class LinkedProjectsDto {
  @ApiProperty({
    description: 'Repository ID',
    example: 'R_kgDOK1234',
  })
  @IsString()
  repositoryId: string;

  @ApiProperty({
    description: 'List of projects linked to the repository',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        url: { type: 'string' },
        number: { type: 'number' },
      },
    },
  })
  projects: Array<{
    id: string;
    title: string;
    url: string;
    number: number;
  }>;
}

/**
 * Query parameters for repository metadata
 */
export class GetRepositoryQueryDto {
  @ApiProperty({
    description: 'Include linked projects in the response',
    example: false,
    required: false,
    default: false,
  })
  @IsOptional()
  include_projects?: string; // Will be parsed as boolean
}
