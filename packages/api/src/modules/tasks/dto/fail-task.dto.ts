import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FailTaskDto {
  @ApiProperty({
    description: 'Reason for task failure',
    example: 'Database connection timeout after 3 retry attempts',
  })
  @IsString()
  @IsNotEmpty()
  error_message: string;
}
