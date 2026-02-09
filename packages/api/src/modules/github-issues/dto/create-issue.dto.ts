import { IsString, IsNotEmpty, IsOptional, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a GitHub issue
 */
export class CreateIssueDto {
  @ApiProperty({
    description: 'Repository owner',
    example: 'octocat',
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: 'Repository name',
    example: 'hello-world',
  })
  @IsString()
  @IsNotEmpty()
  repo: string;

  @ApiProperty({
    description: 'Issue title',
    example: 'Bug: Application crashes on startup',
    maxLength: 256,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({
    description: 'Issue body/description',
    example: 'The application crashes when...',
  })
  @IsString()
  @IsOptional()
  body?: string;

  @ApiPropertyOptional({
    description: 'Array of label names',
    example: ['bug', 'priority-high'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labels?: string[];

  @ApiPropertyOptional({
    description: 'Array of assignee usernames',
    example: ['octocat'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  assignees?: string[];
}
