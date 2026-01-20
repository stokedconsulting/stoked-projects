import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type MachineDocument = Machine & Document;

export enum MachineStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'machines'
})
export class Machine {
  @ApiProperty({ description: 'Unique machine identifier' })
  @Prop({ required: true, unique: true, index: true })
  machine_id: string;

  @ApiProperty({ description: 'Machine hostname' })
  @Prop({ required: true })
  hostname: string;

  @ApiProperty({ description: 'List of available docker slot numbers', type: [Number] })
  @Prop({ type: [Number], default: [] })
  docker_slots: number[];

  @ApiProperty({ description: 'List of active session IDs on this machine', type: [String] })
  @Prop({ type: [String], default: [] })
  active_sessions: string[];

  @ApiProperty({ enum: MachineStatus, description: 'Machine availability status' })
  @Prop({ required: true, enum: Object.values(MachineStatus), index: true })
  status: MachineStatus;

  @ApiProperty({ description: 'Last machine heartbeat timestamp' })
  @Prop({ required: true, index: true })
  last_heartbeat: Date;

  @ApiProperty({ description: 'Machine specifications and OS information' })
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @ApiProperty({ description: 'Document creation timestamp' })
  created_at?: Date;

  @ApiProperty({ description: 'Document last update timestamp' })
  updated_at?: Date;
}

export const MachineSchema = SchemaFactory.createForClass(Machine);

// No TTL for machines - they should persist
