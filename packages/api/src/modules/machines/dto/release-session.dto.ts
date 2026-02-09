import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ReleaseSessionDto {
  @ApiProperty({
    description: 'Session ID to release from this machine',
    example: 'session-xyz789',
  })
  @IsString()
  session_id: string;
}
