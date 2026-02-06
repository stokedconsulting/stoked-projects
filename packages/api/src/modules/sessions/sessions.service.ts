import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SessionsService');
  }

  /**
   * Find all sessions with optional filtering and pagination
   * @param queryDto - Query parameters for filtering
   * @returns Array of sessions matching the query
   */
  async findAll(queryDto?: SessionQueryDto): Promise<Session[]> {
    const filter: FilterQuery<SessionDocument> = {};

    if (queryDto?.status) {
      filter.status = queryDto.status;
    }
    if (queryDto?.project_id) {
      filter.project_id = queryDto.project_id;
    }
    if (queryDto?.machine_id) {
      filter.machine_id = queryDto.machine_id;
    }

    const limit = queryDto?.limit || 20;
    const offset = queryDto?.offset || 0;

    return this.sessionModel
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .skip(offset)
      .exec();
  }

  /**
   * Find a single session by ID
   * @param sessionId - The session ID to find
   * @returns Session if found
   * @throws NotFoundException if session not found
   */
  async findOne(sessionId: string): Promise<Session> {
    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    return session;
  }

  /**
   * Create a new session
   * @param createSessionDto - The session data to create
   * @returns Created session
   */
  async create(createSessionDto: CreateSessionDto): Promise<Session> {
    const now = new Date();
    const sessionData = {
      session_id: randomUUID(),
      ...createSessionDto,
      status: SessionStatus.ACTIVE,
      started_at: now,
      last_heartbeat: now,
      metadata: createSessionDto.metadata || {},
    };

    const createdSession = new this.sessionModel(sessionData);
    const saved = await createdSession.save();

    // Log session creation
    this.logger.logSessionCreated(saved.session_id, saved.project_id, {
      machine_id: saved.machine_id,
    });

    return saved;
  }

  /**
   * Update a session
   * @param sessionId - The session ID to update
   * @param updateSessionDto - The fields to update
   * @returns Updated session
   * @throws NotFoundException if session not found
   * @throws BadRequestException if trying to update immutable fields
   */
  async update(sessionId: string, updateSessionDto: UpdateSessionDto): Promise<Session> {
    // Verify session exists
    await this.findOne(sessionId);

    // Prepare update data
    const updateData: any = {
      ...updateSessionDto,
    };

    // If metadata is being updated, merge with existing
    if (updateSessionDto.metadata) {
      const session = await this.sessionModel
        .findOne({ session_id: sessionId })
        .exec();

      if (session) {
        updateData.metadata = {
          ...(session.metadata || {}),
          ...updateSessionDto.metadata,
        };
      }
    }

    const updatedSession = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        { $set: updateData },
        { new: true, runValidators: true }
      )
      .exec();

    if (!updatedSession) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Log session update
    this.logger.logSessionUpdated(sessionId, updateData, {
      project_id: updatedSession.project_id,
      status: updatedSession.status,
    });

    return updatedSession;
  }

  /**
   * Soft delete a session by marking it as completed
   * @param sessionId - The session ID to delete
   * @throws NotFoundException if session not found
   */
  async delete(sessionId: string): Promise<void> {
    // Verify session exists
    const session = await this.findOne(sessionId);

    const now = new Date();
    const result = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        {
          $set: {
            status: SessionStatus.COMPLETED,
            completed_at: now,
          }
        },
        { new: true }
      )
      .exec();

    if (!result) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Log session completion
    this.logger.logSessionCompleted(sessionId, {
      project_id: session.project_id,
      duration_ms: now.getTime() - session.started_at.getTime(),
    });
  }

  /**
   * Clear the current_task_id from a session
   * @param sessionId - The session ID to update
   * @throws NotFoundException if session not found
   */
  async clearCurrentTaskId(sessionId: string): Promise<void> {
    // Verify session exists
    await this.findOne(sessionId);

    await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        { $unset: { current_task_id: 1 } },
        { new: true }
      )
      .exec();
  }

  /**
   * Update session heartbeat timestamp and reactivate if stalled
   * @param sessionId - The session ID to update
   * @returns Updated session
   * @throws NotFoundException if session not found
   * @throws BadRequestException if session is completed or failed
   */
  async updateHeartbeat(sessionId: string): Promise<Session> {
    const session = await this.findOne(sessionId);

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Don't allow heartbeat updates for completed/failed sessions
    if (session.status === SessionStatus.COMPLETED || session.status === SessionStatus.FAILED) {
      this.logger.logHeartbeatFailure(
        sessionId,
        `Cannot update heartbeat for ${session.status} session`,
        { project_id: session.project_id, status: session.status },
      );
      throw new BadRequestException(
        `Cannot update heartbeat for ${session.status} session`
      );
    }

    const now = new Date();
    const updateData: Partial<Session> = {
      last_heartbeat: now,
    };

    // If session is stalled, change it back to active
    const wasStalled = session.status === SessionStatus.STALLED;
    if (wasStalled) {
      updateData.status = SessionStatus.ACTIVE;
    }

    const updatedSession = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        { $set: updateData },
        { new: true }
      )
      .exec();

    // Log heartbeat (sampled in production)
    this.logger.logHeartbeat(sessionId, {
      project_id: session.project_id,
      was_stalled: wasStalled,
    });

    return updatedSession!;
  }

  /**
   * Detect and mark sessions as stalled if heartbeat is older than threshold
   * @param thresholdMinutes - Minutes after which a session is considered stalled (default: 5)
   * @returns Array of stalled session IDs
   */
  async detectStaleSessions(thresholdMinutes: number = 5): Promise<string[]> {
    const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const result = await this.sessionModel
      .updateMany(
        {
          last_heartbeat: { $lt: thresholdTime },
          status: { $in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] }
        },
        {
          $set: { status: SessionStatus.STALLED }
        }
      )
      .exec();

    // Fetch the IDs of sessions that were marked as stalled
    const stalledSessions = await this.sessionModel
      .find({
        last_heartbeat: { $lt: thresholdTime },
        status: SessionStatus.STALLED
      })
      .select('session_id project_id last_heartbeat')
      .exec();

    // Log each stalled session
    for (const session of stalledSessions) {
      const minutesSinceHeartbeat = Math.floor(
        (Date.now() - session.last_heartbeat.getTime()) / 60000
      );
      this.logger.logStalledSession(session.session_id, minutesSinceHeartbeat, {
        project_id: session.project_id,
      });
    }

    return stalledSessions.map(s => s.session_id);
  }
}
