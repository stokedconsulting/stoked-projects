import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for linking an issue to a GitHub Project
 */
export class LinkIssueDto {
  @ApiProperty({
    description: 'GitHub Project ID (node ID)',
    example: 'PVT_kwDOABCDEF01234567',
  })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiPropertyOptional({
    description: 'Status field option name to set (e.g., "In Progress", "Done")',
    example: 'In Progress',
  })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({
    description: 'Priority field value',
    example: 'High',
  })
  @IsString()
  @IsOptional()
  priority?: string;
}
