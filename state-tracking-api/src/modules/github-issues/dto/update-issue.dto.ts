import { IsString, IsOptional, IsArray, MaxLength, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Issue state for updates
 */
export enum UpdateIssueState {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * DTO for updating a GitHub issue
 */
export class UpdateIssueDto {
  @ApiPropertyOptional({
    description: 'Issue title',
    example: 'Updated: Bug fix applied',
    maxLength: 256,
  })
  @IsString()
  @IsOptional()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({
    description: 'Issue body/description',
    example: 'Updated description...',
  })
  @IsString()
  @IsOptional()
  body?: string;

  @ApiPropertyOptional({
    description: 'Issue state',
    enum: UpdateIssueState,
    example: UpdateIssueState.OPEN,
  })
  @IsEnum(UpdateIssueState)
  @IsOptional()
  state?: UpdateIssueState;

  @ApiPropertyOptional({
    description: 'Array of label names',
    example: ['bug', 'fixed'],
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
