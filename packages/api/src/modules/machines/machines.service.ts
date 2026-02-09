import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument, MachineStatus } from '../../schemas/machine.schema';
import { Session, SessionDocument } from '../../schemas/session.schema';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { AssignSessionDto } from './dto/assign-session.dto';
import { ReleaseSessionDto } from './dto/release-session.dto';
import { MachineQueryDto } from './dto/machine-query.dto';

@Injectable()
export class MachinesService {
  constructor(
    @InjectModel(Machine.name) private machineModel: Model<MachineDocument>,
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  async findAll(query?: MachineQueryDto): Promise<Machine[]> {
    const filter: any = {};

    if (query?.status) {
      filter.status = query.status;
    }

    if (query?.hostname) {
      filter.hostname = query.hostname;
    }

    return this.machineModel.find(filter).exec();
  }

  async findOne(machineId: string): Promise<Machine> {
    const machine = await this.machineModel.findOne({ machine_id: machineId }).exec();

    if (!machine) {
      throw new NotFoundException(`Machine with ID ${machineId} not found`);
    }

    return machine;
  }

  async create(createMachineDto: CreateMachineDto): Promise<Machine> {
    // Check if machine already exists
    const existing = await this.machineModel.findOne({
      machine_id: createMachineDto.machine_id
    }).exec();

    if (existing) {
      throw new ConflictException(
        `Machine with ID ${createMachineDto.machine_id} already exists`
      );
    }

    // Validate docker_slots are unique positive integers
    const uniqueSlots = new Set(createMachineDto.docker_slots);
    if (uniqueSlots.size !== createMachineDto.docker_slots.length) {
      throw new BadRequestException('Docker slots must be unique');
    }

    for (const slot of createMachineDto.docker_slots) {
      if (slot < 1 || !Number.isInteger(slot)) {
        throw new BadRequestException('Docker slots must be positive integers');
      }
    }

    const machine = new this.machineModel({
      ...createMachineDto,
      status: MachineStatus.ONLINE,
      last_heartbeat: new Date(),
      active_sessions: [],
    });

    return machine.save();
  }

  async update(machineId: string, updateMachineDto: UpdateMachineDto): Promise<Machine> {
    const machine = await this.findOne(machineId);

    // Validate docker_slots if provided
    if (updateMachineDto.docker_slots) {
      const uniqueSlots = new Set(updateMachineDto.docker_slots);
      if (uniqueSlots.size !== updateMachineDto.docker_slots.length) {
        throw new BadRequestException('Docker slots must be unique');
      }

      for (const slot of updateMachineDto.docker_slots) {
        if (slot < 1 || !Number.isInteger(slot)) {
          throw new BadRequestException('Docker slots must be positive integers');
        }
      }

      // Check if any active sessions are using slots that would be removed
      if (machine.active_sessions.length > 0) {
        const sessions = await this.sessionModel.find({
          session_id: { $in: machine.active_sessions },
          docker_slot: { $exists: true, $ne: null }
        }).exec();

        for (const session of sessions) {
          if (session.docker_slot && !updateMachineDto.docker_slots.includes(session.docker_slot)) {
            throw new BadRequestException(
              `Cannot remove docker slot ${session.docker_slot} - currently in use by session ${session.session_id}`
            );
          }
        }
      }
    }

    const updated = await this.machineModel
      .findOneAndUpdate(
        { machine_id: machineId },
        {
          ...updateMachineDto,
          last_heartbeat: new Date(),
        },
        { new: true }
      )
      .exec();

    if (!updated) {
      throw new NotFoundException(`Machine with ID ${machineId} not found`);
    }

    return updated;
  }

  async delete(machineId: string): Promise<void> {
    const machine = await this.findOne(machineId);

    // Set status to offline instead of deleting
    await this.machineModel
      .findOneAndUpdate(
        { machine_id: machineId },
        { status: MachineStatus.OFFLINE }
      )
      .exec();
  }

  async assignSession(machineId: string, assignSessionDto: AssignSessionDto): Promise<Machine> {
    const machine = await this.findOne(machineId);

    // Validate machine is online
    if (machine.status !== MachineStatus.ONLINE) {
      throw new BadRequestException(
        `Cannot assign session to machine ${machineId} - machine status is ${machine.status}`
      );
    }

    // Check if session exists
    const session = await this.sessionModel.findOne({
      session_id: assignSessionDto.session_id
    }).exec();

    if (!session) {
      throw new NotFoundException(
        `Session with ID ${assignSessionDto.session_id} not found`
      );
    }

    // Check if session is already assigned to this machine
    if (machine.active_sessions.includes(assignSessionDto.session_id)) {
      throw new ConflictException(
        `Session ${assignSessionDto.session_id} is already assigned to machine ${machineId}`
      );
    }

    let assignedSlot: number | undefined = assignSessionDto.docker_slot;

    // If docker_slot is specified, validate it
    if (assignedSlot !== undefined) {
      if (!machine.docker_slots.includes(assignedSlot)) {
        throw new BadRequestException(
          `Docker slot ${assignedSlot} is not available on machine ${machineId}`
        );
      }

      // Check if slot is already occupied
      const slotInUse = await this.sessionModel.findOne({
        machine_id: machineId,
        docker_slot: assignedSlot,
        session_id: { $in: machine.active_sessions }
      }).exec();

      if (slotInUse) {
        throw new ConflictException(
          `Docker slot ${assignedSlot} is already occupied by session ${slotInUse.session_id}`
        );
      }
    } else {
      // Auto-assign first available slot
      assignedSlot = await this.findAvailableSlot(machineId, machine);
    }

    // Update machine with atomic operation to prevent race conditions
    const updated = await this.machineModel
      .findOneAndUpdate(
        {
          machine_id: machineId,
          active_sessions: { $ne: assignSessionDto.session_id } // Double-check not already assigned
        },
        {
          $push: { active_sessions: assignSessionDto.session_id },
          last_heartbeat: new Date(),
        },
        { new: true }
      )
      .exec();

    if (!updated) {
      throw new ConflictException(
        `Failed to assign session ${assignSessionDto.session_id} to machine ${machineId} - concurrent modification detected`
      );
    }

    // Update session with machine_id and docker_slot
    await this.sessionModel
      .findOneAndUpdate(
        { session_id: assignSessionDto.session_id },
        {
          machine_id: machineId,
          docker_slot: assignedSlot,
        }
      )
      .exec();

    return updated;
  }

  async releaseSession(machineId: string, releaseSessionDto: ReleaseSessionDto): Promise<Machine> {
    const machine = await this.findOne(machineId);

    // Check if session is assigned to this machine
    if (!machine.active_sessions.includes(releaseSessionDto.session_id)) {
      throw new BadRequestException(
        `Session ${releaseSessionDto.session_id} is not assigned to machine ${machineId}`
      );
    }

    // Update machine with atomic operation
    const updated = await this.machineModel
      .findOneAndUpdate(
        { machine_id: machineId },
        {
          $pull: { active_sessions: releaseSessionDto.session_id },
          last_heartbeat: new Date(),
        },
        { new: true }
      )
      .exec();

    if (!updated) {
      throw new NotFoundException(`Machine with ID ${machineId} not found`);
    }

    return updated;
  }

  /**
   * Update machine heartbeat timestamp and bring back online if offline
   * @param machineId - The machine ID to update
   * @returns Updated machine
   * @throws NotFoundException if machine not found
   */
  async updateHeartbeat(machineId: string): Promise<Machine> {
    const machine = await this.findOne(machineId);

    const now = new Date();
    const updateData: Partial<Machine> = {
      last_heartbeat: now,
    };

    // If machine is offline, change it back to online
    if (machine.status === MachineStatus.OFFLINE) {
      updateData.status = MachineStatus.ONLINE;
    }

    const updatedMachine = await this.machineModel
      .findOneAndUpdate(
        { machine_id: machineId },
        { $set: updateData },
        { new: true }
      )
      .exec();

    return updatedMachine!;
  }

  /**
   * Detect and mark machines as offline if heartbeat is older than threshold
   * @param thresholdMinutes - Minutes after which a machine is considered offline (default: 10)
   * @returns Array of offline machine IDs
   */
  async detectOfflineMachines(thresholdMinutes: number = 10): Promise<string[]> {
    const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    await this.machineModel
      .updateMany(
        {
          last_heartbeat: { $lt: thresholdTime },
          status: MachineStatus.ONLINE
        },
        {
          $set: { status: MachineStatus.OFFLINE }
        }
      )
      .exec();

    // Fetch the IDs of machines that were marked as offline
    const offlineMachines = await this.machineModel
      .find({
        last_heartbeat: { $lt: thresholdTime },
        status: MachineStatus.OFFLINE
      })
      .select('machine_id')
      .exec();

    return offlineMachines.map(m => m.machine_id);
  }

  /**
   * Find the first available docker slot on a machine
   */
  private async findAvailableSlot(machineId: string, machine: Machine): Promise<number | undefined> {
    if (machine.docker_slots.length === 0) {
      return undefined;
    }

    // Get all sessions with docker slots on this machine
    const sessions = await this.sessionModel.find({
      session_id: { $in: machine.active_sessions },
      docker_slot: { $exists: true, $ne: null }
    }).exec();

    const occupiedSlots = new Set(sessions.map(s => s.docker_slot).filter(Boolean) as number[]);

    // Find first available slot
    for (const slot of machine.docker_slots) {
      if (!occupiedSlots.has(slot)) {
        return slot;
      }
    }

    throw new ConflictException(
      `No available docker slots on machine ${machineId} - all ${machine.docker_slots.length} slots are occupied`
    );
  }
}
