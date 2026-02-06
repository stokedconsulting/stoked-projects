import { ApiProperty } from '@nestjs/swagger';
import { MachineStatus } from '../../../schemas/machine.schema';

export class MachineAvailabilityDto {
  @ApiProperty({ description: 'Unique machine identifier' })
  machine_id: string;

  @ApiProperty({ description: 'Machine hostname' })
  hostname: string;

  @ApiProperty({ enum: MachineStatus, description: 'Machine availability status' })
  status: MachineStatus;

  @ApiProperty({ description: 'Total number of docker slots', type: Number })
  total_slots: number;

  @ApiProperty({ description: 'Number of occupied docker slots', type: Number })
  occupied_slots: number;

  @ApiProperty({ description: 'Number of available docker slots', type: Number })
  available_slots: number;

  @ApiProperty({ description: 'List of available docker slot numbers', type: [Number] })
  available_slot_numbers: number[];

  @ApiProperty({ description: 'List of active session IDs on this machine', type: [String] })
  active_sessions: string[];

  @ApiProperty({ description: 'Last machine heartbeat timestamp' })
  last_heartbeat: Date;
}
