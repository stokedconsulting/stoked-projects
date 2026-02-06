import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for linking a project to a repository
 */
export class LinkProjectDto {
  @ApiProperty({
    description: 'Repository ID to link to',
    example: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
  })
  @IsString()
  @IsNotEmpty()
  repositoryId: string;
}

/**
 * DTO for unlinking a project from a repository
 */
export class UnlinkProjectDto {
  @ApiProperty({
    description: 'Repository ID to unlink from',
    example: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
  })
  @IsString()
  @IsNotEmpty()
  repositoryId: string;
}
