import { ApiProperty } from '@nestjs/swagger';
import { MachineStatus } from '../../../schemas/machine.schema';

export class MachineHeartbeatResponseDto {
  @ApiProperty({ description: 'Machine ID' })
  machine_id: string;

  @ApiProperty({ enum: MachineStatus, description: 'Current machine status' })
  status: MachineStatus;

  @ApiProperty({ description: 'Last heartbeat timestamp' })
  last_heartbeat: Date;

  @ApiProperty({ description: 'Message describing the heartbeat result' })
  message: string;
}
