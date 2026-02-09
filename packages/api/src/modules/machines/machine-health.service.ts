import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument, MachineStatus } from '../../schemas/machine.schema';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { MachineAvailabilityDto } from './dto/machine-availability.dto';

@Injectable()
export class MachineHealthService {
  constructor(
    @InjectModel(Machine.name) private machineModel: Model<MachineDocument>,
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  /**
   * Find all available machines with slot information
   */
  async findAvailableMachines(): Promise<MachineAvailabilityDto[]> {
    const machines = await this.machineModel
      .find({ status: MachineStatus.ONLINE })
      .sort({ machine_id: 1 })
      .exec();

    const availabilityPromises = machines.map(async (machine) => {
      // Get active sessions for this machine
      const activeSessions = await this.sessionModel
        .find({
          machine_id: machine.machine_id,
          status: SessionStatus.ACTIVE,
        })
        .exec();

      const totalSlots = machine.docker_slots.length;
      const occupiedSessions = activeSessions.filter((s) => s.docker_slot !== undefined);
      const occupiedSlots = occupiedSessions.length;

      // Find which slots are occupied
      const occupiedSlotNumbers = new Set(
        occupiedSessions
          .map((s) => s.docker_slot)
          .filter((slot): slot is number => slot !== undefined)
      );

      // Calculate available slots
      const availableSlotNumbers = machine.docker_slots.filter(
        (slot) => !occupiedSlotNumbers.has(slot)
      );

      return {
        machine_id: machine.machine_id,
        hostname: machine.hostname,
        status: machine.status,
        total_slots: totalSlots,
        occupied_slots: occupiedSlots,
        available_slots: availableSlotNumbers.length,
        available_slot_numbers: availableSlotNumbers,
        active_sessions: machine.active_sessions,
        last_heartbeat: machine.last_heartbeat,
      };
    });

    const availability = await Promise.all(availabilityPromises);

    // Sort by most available slots first
    return availability.sort((a, b) => b.available_slots - a.available_slots);
  }

  /**
   * Get availability info for a specific machine
   */
  async getMachineAvailability(machineId: string): Promise<MachineAvailabilityDto | null> {
    const machine = await this.machineModel
      .findOne({ machine_id: machineId })
      .exec();

    if (!machine) {
      return null;
    }

    // Get active sessions for this machine
    const activeSessions = await this.sessionModel
      .find({
        machine_id: machine.machine_id,
        status: SessionStatus.ACTIVE,
      })
      .exec();

    const totalSlots = machine.docker_slots.length;
    const occupiedSessions = activeSessions.filter((s) => s.docker_slot !== undefined);
    const occupiedSlots = occupiedSessions.length;

    // Find which slots are occupied
    const occupiedSlotNumbers = new Set(
      occupiedSessions
        .map((s) => s.docker_slot)
        .filter((slot): slot is number => slot !== undefined)
    );

    // Calculate available slots
    const availableSlotNumbers = machine.docker_slots.filter(
      (slot) => !occupiedSlotNumbers.has(slot)
    );

    return {
      machine_id: machine.machine_id,
      hostname: machine.hostname,
      status: machine.status,
      total_slots: totalSlots,
      occupied_slots: occupiedSlots,
      available_slots: availableSlotNumbers.length,
      available_slot_numbers: availableSlotNumbers,
      active_sessions: machine.active_sessions,
      last_heartbeat: machine.last_heartbeat,
    };
  }
}
