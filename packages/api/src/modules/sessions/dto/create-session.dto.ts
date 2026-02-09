import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiProperty({
    description: 'GitHub Project ID this session is working on',
    example: '123',
  })
  @IsString()
  project_id: string;

  @ApiProperty({
    description: 'Machine identifier running this session',
    example: 'macbook-pro-m1',
  })
  @IsString()
  machine_id: string;

  @ApiPropertyOptional({
    description: 'Docker slot number (if using containerized execution)',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  docker_slot?: number;

  @ApiPropertyOptional({
    description: 'Additional session context (VSCode version, extension version, etc.)',
    example: { vscode_version: '1.85.0', extension_version: '0.1.0' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
