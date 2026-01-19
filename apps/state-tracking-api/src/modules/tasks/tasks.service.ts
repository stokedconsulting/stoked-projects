import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../../schemas/task.schema';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
  ) {}

  async findAll(): Promise<Task[]> {
    return this.taskModel.find().exec();
  }

  async findBySession(sessionId: string): Promise<Task[]> {
    return this.taskModel.find({ session_id: sessionId }).exec();
  }

  async findOne(taskId: string): Promise<Task | null> {
    return this.taskModel.findOne({ task_id: taskId }).exec();
  }

  async create(task: Partial<Task>): Promise<Task> {
    const createdTask = new this.taskModel(task);
    return createdTask.save();
  }

  async update(taskId: string, update: Partial<Task>): Promise<Task | null> {
    return this.taskModel
      .findOneAndUpdate({ task_id: taskId }, update, { new: true })
      .exec();
  }

  async delete(taskId: string): Promise<Task | null> {
    return this.taskModel.findOneAndDelete({ task_id: taskId }).exec();
  }
}
