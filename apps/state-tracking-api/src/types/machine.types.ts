import { Document } from 'mongoose';

/**
 * Machine status enum
 */
export enum MachineStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}

/**
 * Docker slot information
 */
export interface DockerSlot {
  slot_number: number;
  status: 'available' | 'occupied';
  session_id?: string;
}

/**
 * Machine metadata interface
 */
export interface MachineMetadata {
  [key: string]: any;
}

/**
 * Machine document interface
 */
export interface IMachine {
  machine_id: string;
  hostname: string;
  docker_slots: DockerSlot[];
  active_sessions: string[];
  status: MachineStatus;
  last_heartbeat: Date;
  metadata?: MachineMetadata;
  created_at: Date;
  updated_at: Date;
}

/**
 * Machine Mongoose document type
 */
export type MachineDocument = IMachine & Document;
