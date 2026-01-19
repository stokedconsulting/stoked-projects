import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument } from '../../schemas/machine.schema';

@Injectable()
export class MachinesService {
  constructor(
    @InjectModel(Machine.name) private machineModel: Model<MachineDocument>,
  ) {}

  async findAll(): Promise<Machine[]> {
    return this.machineModel.find().exec();
  }

  async findOne(machineId: string): Promise<Machine | null> {
    return this.machineModel.findOne({ machine_id: machineId }).exec();
  }

  async create(machine: Partial<Machine>): Promise<Machine> {
    const createdMachine = new this.machineModel(machine);
    return createdMachine.save();
  }

  async update(machineId: string, update: Partial<Machine>): Promise<Machine | null> {
    return this.machineModel
      .findOneAndUpdate({ machine_id: machineId }, update, { new: true })
      .exec();
  }

  async delete(machineId: string): Promise<Machine | null> {
    return this.machineModel.findOneAndDelete({ machine_id: machineId }).exec();
  }
}
