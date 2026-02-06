import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkStalledDto {
  @ApiProperty({
    description: 'Reason for marking session as stalled',
    example: 'No heartbeat received for 15 minutes',
  })
  @IsString()
  reason: string;
}
