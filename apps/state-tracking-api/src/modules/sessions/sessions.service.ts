import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument } from '../../schemas/session.schema';

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  async findAll(): Promise<Session[]> {
    return this.sessionModel.find().exec();
  }

  async findOne(sessionId: string): Promise<Session | null> {
    return this.sessionModel.findOne({ session_id: sessionId }).exec();
  }

  async create(session: Partial<Session>): Promise<Session> {
    const createdSession = new this.sessionModel(session);
    return createdSession.save();
  }

  async update(sessionId: string, update: Partial<Session>): Promise<Session | null> {
    return this.sessionModel
      .findOneAndUpdate({ session_id: sessionId }, update, { new: true })
      .exec();
  }

  async delete(sessionId: string): Promise<Session | null> {
    return this.sessionModel.findOneAndDelete({ session_id: sessionId }).exec();
  }
}
