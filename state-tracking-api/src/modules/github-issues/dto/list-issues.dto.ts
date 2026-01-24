import { IsString, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Issue state filter
 */
export enum IssueStateFilter {
  OPEN = 'open',
  CLOSED = 'closed',
  ALL = 'all',
}

/**
 * Issue sort field
 */
export enum IssueSortField {
  CREATED = 'created',
  UPDATED = 'updated',
  COMMENTS = 'comments',
}

/**
 * Sort direction
 */
export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * DTO for listing GitHub issues with filters
 */
export class ListIssuesDto {
  @ApiPropertyOptional({
    description: 'Filter by issue state',
    enum: IssueStateFilter,
    default: IssueStateFilter.OPEN,
  })
  @IsEnum(IssueStateFilter)
  @IsOptional()
  state?: IssueStateFilter = IssueStateFilter.OPEN;

  @ApiPropertyOptional({
    description: 'Filter by labels (comma-separated)',
    example: 'bug,priority-high',
  })
  @IsString()
  @IsOptional()
  labels?: string;

  @ApiPropertyOptional({
    description: 'Filter by assignee username',
    example: 'octocat',
  })
  @IsString()
  @IsOptional()
  assignee?: string;

  @ApiPropertyOptional({
    description: 'Filter by creator username',
    example: 'octocat',
  })
  @IsString()
  @IsOptional()
  creator?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: IssueSortField,
    default: IssueSortField.CREATED,
  })
  @IsEnum(IssueSortField)
  @IsOptional()
  sort?: IssueSortField = IssueSortField.CREATED;

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: SortDirection,
    default: SortDirection.DESC,
  })
  @IsEnum(SortDirection)
  @IsOptional()
  direction?: SortDirection = SortDirection.DESC;

  @ApiPropertyOptional({
    description: 'Results per page',
    minimum: 1,
    maximum: 100,
    default: 30,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  perPage?: number = 30;

  @ApiPropertyOptional({
    description: 'Page number',
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;
}
