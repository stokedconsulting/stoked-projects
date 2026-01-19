import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiQuery, ApiParam, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SessionsService } from './sessions.service';
import { SessionHealthService } from './session-health.service';
import { SessionFailureService } from './session-failure.service';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionRecoveryService } from './session-recovery.service';
import { Session } from '../../schemas/session.schema';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { StaleSessionDto } from './dto/stale-session.dto';
import { ActiveSessionDto } from './dto/active-session.dto';
import { SessionHealthDto } from './dto/session-health.dto';
import { ProjectSessionsSummaryDto } from './dto/project-sessions-summary.dto';
import { HeartbeatResponseDto } from './dto/heartbeat-response.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { MarkFailedDto } from './dto/mark-failed.dto';
import { MarkStalledDto } from './dto/mark-stalled.dto';
import { FailureInfoDto } from './dto/failure-info.dto';
import { FailedSessionQueryDto } from './dto/failed-session-query.dto';
import { ArchiveSessionDto } from './dto/archive-session.dto';
import { PurgeSessionDto, PurgeSessionResponseDto } from './dto/purge-session.dto';
import { CleanupRequestDto, CleanupSummaryDto } from './dto/cleanup-request.dto';
import { PrepareRecoveryDto } from './dto/prepare-recovery.dto';
import { RecoverSessionDto } from './dto/recover-session.dto';
import { RecoveryHistoryDto } from './dto/recovery-history.dto';
import { RecoverableSessionDto } from './dto/recoverable-session.dto';
import { RecoverableSessionsQueryDto } from './dto/recoverable-sessions-query.dto';

@ApiTags('sessions')
@Controller('sessions')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly sessionHealthService: SessionHealthService,
    private readonly sessionFailureService: SessionFailureService,
    private readonly sessionCleanupService: SessionCleanupService,
    private readonly sessionRecoveryService: SessionRecoveryService,
  ) {}

  @Get('stale')
  @ApiOperation({
    summary: 'Find stale sessions',
    description: 'Returns sessions where last_heartbeat is older than the threshold. Default threshold is 300 seconds (5 minutes).'
  })
  @ApiQuery({ name: 'threshold', required: false, type: Number, description: 'Threshold in seconds (default: 300)' })
  @ApiResponse({ status: 200, description: 'Return stale sessions', type: [StaleSessionDto] })
  async findStaleSessions(
    @Query('threshold') threshold?: number,
  ): Promise<StaleSessionDto[]> {
    const thresholdSeconds = threshold ? Number(threshold) : undefined;
    return this.sessionHealthService.findStaleSessions(thresholdSeconds);
  }

  @Get('active')
  @ApiOperation({
    summary: 'Find active sessions',
    description: 'Returns all sessions with status="active". Supports filtering by project_id and machine_id.'
  })
  @ApiQuery({ name: 'project_id', required: false, type: String, description: 'Filter by project ID' })
  @ApiQuery({ name: 'machine_id', required: false, type: String, description: 'Filter by machine ID' })
  @ApiResponse({ status: 200, description: 'Return active sessions', type: [ActiveSessionDto] })
  async findActiveSessions(
    @Query('project_id') projectId?: string,
    @Query('machine_id') machineId?: string,
  ): Promise<ActiveSessionDto[]> {
    return this.sessionHealthService.findActiveSessions(projectId, machineId);
  }

  @Get('by-project/:projectId')
  @ApiOperation({
    summary: 'Get sessions by project',
    description: 'Returns all sessions for a GitHub Project, grouped by status with summary statistics.'
  })
  @ApiResponse({ status: 200, description: 'Return project sessions summary', type: ProjectSessionsSummaryDto })
  async findSessionsByProject(
    @Param('projectId') projectId: string,
  ): Promise<ProjectSessionsSummaryDto> {
    return this.sessionHealthService.findSessionsByProject(projectId);
  }

  @Get('by-machine/:machineId')
  @ApiOperation({
    summary: 'Get sessions by machine',
    description: 'Returns all sessions for a specific machine, including docker slot assignments.'
  })
  @ApiResponse({ status: 200, description: 'Return machine sessions', type: [Session] })
  async findSessionsByMachine(
    @Param('machineId') machineId: string,
  ): Promise<Session[]> {
    return this.sessionHealthService.findSessionsByMachine(machineId);
  }

  @Get(':id/health')
  @ApiOperation({
    summary: 'Get session health status',
    description: 'Returns comprehensive health information for a session, including staleness check and recommendations.'
  })
  @ApiQuery({ name: 'threshold', required: false, type: Number, description: 'Stale threshold in seconds (default: 300)' })
  @ApiResponse({ status: 200, description: 'Return session health', type: SessionHealthDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getSessionHealth(
    @Param('id') id: string,
    @Query('threshold') threshold?: number,
  ): Promise<SessionHealthDto> {
    const thresholdSeconds = threshold ? Number(threshold) : undefined;
    const health = await this.sessionHealthService.getSessionHealth(id, thresholdSeconds);
    if (!health) {
      throw new NotFoundException(`Session with ID ${id} not found`);
    }
    return health;
  }

  @Get()
  @ApiOperation({
    summary: 'List all sessions',
    description: 'Retrieve all sessions with optional filtering by status, project_id, machine_id, and pagination support.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved sessions',
    type: [Session],
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters',
  })
  async findAll(@Query() queryDto: SessionQueryDto): Promise<Session[]> {
    return this.sessionsService.findAll(queryDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get session by ID',
    description: 'Retrieve a single session by its unique session_id.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved session',
    type: Session,
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
  })
  async findOne(@Param('id') id: string): Promise<Session> {
    return this.sessionsService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create new session',
    description: 'Create a new session. Session ID (UUID v4) is auto-generated. Status defaults to "active", and timestamps are set automatically.',
  })
  @ApiBody({
    type: CreateSessionDto,
    examples: {
      'application/json': {
        value: {
          project_id: '123',
          machine_id: 'macbook-pro-m1',
          docker_slot: 1,
          metadata: {
            vscode_version: '1.85.0',
            extension_version: '0.1.0',
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 201,
    description: 'Session created successfully',
    type: Session,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
  })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createSessionDto: CreateSessionDto): Promise<Session> {
    return this.sessionsService.create(createSessionDto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update session',
    description: 'Update session fields. Immutable fields (session_id, project_id, machine_id, started_at) cannot be updated. Metadata is merged with existing values.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: UpdateSessionDto,
    examples: {
      'application/json': {
        value: {
          status: 'paused',
          current_task_id: 'task-uuid-456',
          metadata: {
            notes: 'Pausing for lunch break',
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Session updated successfully',
    type: Session,
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid update data',
  })
  async update(
    @Param('id') id: string,
    @Body() updateSessionDto: UpdateSessionDto,
  ): Promise<Session> {
    return this.sessionsService.update(id, updateSessionDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete session (soft delete)',
    description: 'Soft delete a session by setting status to "completed" and completed_at to current timestamp. Does not physically remove the document.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'Session deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.sessionsService.delete(id);
  }

  @Post(':id/heartbeat')
  @Throttle({ default: { limit: 120, ttl: 60000 } }) // Higher limit for heartbeat: 120 requests/minute
  @ApiOperation({
    summary: 'Update session heartbeat',
    description: 'Updates the last_heartbeat timestamp for a session. If the session is stalled, it will be changed back to active. Cannot update heartbeat for completed or failed sessions. Recommended heartbeat interval: 60 seconds.'
  })
  @ApiResponse({ status: 200, description: 'Heartbeat updated successfully', type: HeartbeatResponseDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 400, description: 'Cannot update heartbeat for completed/failed session' })
  @ApiResponse({ status: 429, description: 'Too many requests - rate limit exceeded' })
  @HttpCode(HttpStatus.OK)
  async updateHeartbeat(@Param('id') id: string): Promise<HeartbeatResponseDto> {
    const session = await this.sessionsService.updateHeartbeat(id);

    return {
      session_id: session.session_id,
      status: session.status,
      last_heartbeat: session.last_heartbeat,
      message: session.status === 'active'
        ? 'Heartbeat updated successfully'
        : `Heartbeat updated and session reactivated from stalled state`
    };
  }

  @Get('failed')
  @ApiOperation({
    summary: 'Query failed sessions',
    description: 'Returns all sessions with status="failed". Supports filtering by project_id and machine_id with pagination.'
  })
  @ApiQuery({ name: 'project_id', required: false, type: String, description: 'Filter by project ID' })
  @ApiQuery({ name: 'machine_id', required: false, type: String, description: 'Filter by machine ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of results (default: 20)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number to skip (default: 0)' })
  @ApiResponse({ status: 200, description: 'Return failed sessions', type: [Session] })
  async findFailedSessions(@Query() queryDto: FailedSessionQueryDto): Promise<Session[]> {
    return this.sessionFailureService.findFailedSessions(queryDto);
  }

  @Get(':id/failure-info')
  @ApiOperation({
    summary: 'Get comprehensive failure information',
    description: 'Returns detailed failure information including reason, error details, last successful task, and recovery recommendations. Only works for sessions with status="failed".'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Return failure information', type: FailureInfoDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 400, description: 'Session is not in failed state' })
  async getFailureInfo(@Param('id') id: string): Promise<FailureInfoDto> {
    return this.sessionFailureService.getFailureInfo(id);
  }

  @Post(':id/mark-failed')
  @ApiOperation({
    summary: 'Mark session as failed',
    description: 'Manually mark a session as failed with a reason and optional error details. Sets status="failed", completed_at timestamp, and stores failure information in metadata. Cannot mark completed sessions as failed.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: MarkFailedDto,
    examples: {
      'application/json': {
        value: {
          reason: 'Claude process crashed unexpectedly',
          error_details: {
            error_code: 'ERR_CLAUDE_CRASH',
            exit_code: 1,
            stack_trace: 'Error: Process exited with code 1'
          }
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Session marked as failed', type: Session })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 400, description: 'Cannot mark completed session as failed' })
  @HttpCode(HttpStatus.OK)
  async markSessionFailed(
    @Param('id') id: string,
    @Body() markFailedDto: MarkFailedDto,
  ): Promise<Session> {
    return this.sessionFailureService.markSessionFailed(id, markFailedDto);
  }

  @Post(':id/mark-stalled')
  @ApiOperation({
    summary: 'Mark session as stalled',
    description: 'Manually mark a session as stalled with a reason. Sets status="stalled" and stores reason in metadata. Cannot mark completed or failed sessions as stalled.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: MarkStalledDto,
    examples: {
      'application/json': {
        value: {
          reason: 'No heartbeat received for 15 minutes'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Session marked as stalled', type: Session })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 400, description: 'Cannot mark completed/failed session as stalled' })
  @HttpCode(HttpStatus.OK)
  async markSessionStalled(
    @Param('id') id: string,
    @Body() markStalledDto: MarkStalledDto,
  ): Promise<Session> {
    return this.sessionFailureService.markSessionStalled(id, markStalledDto);
  }

  @Post(':id/archive')
  @ApiOperation({
    summary: 'Archive a session',
    description: 'Archive a completed session. Archived sessions remain in the database but are excluded from normal queries. Can only archive completed, failed, or already archived sessions.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Session archived successfully',
    type: Session,
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot archive active/paused/stalled session',
  })
  @HttpCode(HttpStatus.OK)
  async archiveSession(@Param('id') id: string): Promise<Session> {
    return this.sessionCleanupService.archiveSession(id);
  }

  @Delete(':id/purge')
  @ApiOperation({
    summary: 'Permanently delete (purge) a session',
    description: 'Permanently delete a session and all associated tasks. This is a hard delete and cannot be undone. Requires confirmation. Only completed, failed, or archived sessions can be purged.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: PurgeSessionDto,
    examples: {
      'application/json': {
        value: {
          confirm: true,
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Session purged successfully',
    type: PurgeSessionResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot purge active/paused/stalled session or confirmation not provided',
  })
  @HttpCode(HttpStatus.OK)
  async purgeSession(
    @Param('id') id: string,
    @Body() purgeDto: PurgeSessionDto,
  ): Promise<PurgeSessionResponseDto> {
    const result = await this.sessionCleanupService.purgeSession(id, purgeDto.confirm);
    return {
      ...result,
      purged: true,
    };
  }

  @Post('cleanup')
  @ApiOperation({
    summary: 'Bulk cleanup old sessions',
    description: 'Archive or permanently delete sessions matching specified criteria (older than N days, specific statuses). Supports dry-run mode for testing.'
  })
  @ApiBody({
    type: CleanupRequestDto,
    examples: {
      'application/json': {
        value: {
          older_than_days: 30,
          statuses: ['completed', 'failed'],
          dry_run: true,
          archive: true,
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup operation completed',
    type: CleanupSummaryDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid cleanup request (e.g., older_than_days < 7)',
  })
  @HttpCode(HttpStatus.OK)
  async bulkCleanup(@Body() cleanupRequest: CleanupRequestDto): Promise<CleanupSummaryDto> {
    return this.sessionCleanupService.bulkCleanup(cleanupRequest);
  }

  @Get('archived')
  @ApiOperation({
    summary: 'Query archived sessions',
    description: 'Retrieve archived sessions with optional filtering by project_id and machine_id. Supports pagination.'
  })
  @ApiQuery({ name: 'project_id', required: false, type: String, description: 'Filter by project ID' })
  @ApiQuery({ name: 'machine_id', required: false, type: String, description: 'Filter by machine ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Pagination limit (default: 20)', example: 20 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset (default: 0)', example: 0 })
  @ApiResponse({
    status: 200,
    description: 'Archived sessions retrieved successfully',
    type: [Session],
  })
  @HttpCode(HttpStatus.OK)
  async getArchivedSessions(
    @Query('project_id') projectId?: string,
    @Query('machine_id') machineId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Session[]> {
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.sessionCleanupService.findArchivedSessions(projectId, machineId, limitNum, offsetNum);
  }

  @Get('recoverable')
  @ApiOperation({
    summary: 'Find recoverable sessions',
    description: 'Returns sessions in failed or stalled state that are eligible for recovery. Supports filtering by project, machine, and age. Ordered by age (oldest first).'
  })
  @ApiQuery({ name: 'project_id', required: false, type: String, description: 'Filter by project ID' })
  @ApiQuery({ name: 'machine_id', required: false, type: String, description: 'Filter by machine ID' })
  @ApiQuery({ name: 'max_age_minutes', required: false, type: Number, description: 'Maximum age in minutes (exclude older sessions)' })
  @ApiQuery({ name: 'min_age_minutes', required: false, type: Number, description: 'Minimum age in minutes (exclude newer sessions)' })
  @ApiResponse({ status: 200, description: 'Return recoverable sessions', type: [RecoverableSessionDto] })
  async findRecoverableSessions(
    @Query() queryDto: RecoverableSessionsQueryDto,
  ): Promise<RecoverableSessionDto[]> {
    return this.sessionRecoveryService.findRecoverableSessions(queryDto);
  }

  @Post(':id/prepare-recovery')
  @ApiOperation({
    summary: 'Prepare session for recovery',
    description: 'Creates a recovery checkpoint for a failed or stalled session. Stores current state including last task, machine assignment, and metadata. Session remains in current state. Used to snapshot state before attempting recovery.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Recovery preparation successful', type: PrepareRecoveryDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 400, description: 'Session cannot be recovered (completed or max attempts reached)' })
  @HttpCode(HttpStatus.OK)
  async prepareRecovery(@Param('id') id: string): Promise<PrepareRecoveryDto> {
    return this.sessionRecoveryService.prepareRecovery(id);
  }

  @Post(':id/recover')
  @ApiOperation({
    summary: 'Recover a failed or stalled session',
    description: 'Attempts to recover a session by resetting it to active status. Can optionally assign to a new machine, docker slot, and resume from a specific task. Increments recovery attempt counter and stores recovery history. Maximum 3 recovery attempts per session.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: RecoverSessionDto,
    required: false,
    examples: {
      'application/json': {
        value: {
          new_machine_id: 'macbook-air-m2',
          new_docker_slot: 2,
          resume_from_task_id: 'task-uuid-456'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Session recovered successfully', type: Session })
  @ApiResponse({ status: 404, description: 'Session or task not found' })
  @ApiResponse({ status: 400, description: 'Recovery not possible (completed, max attempts, or invalid task)' })
  @HttpCode(HttpStatus.OK)
  async recoverSession(
    @Param('id') id: string,
    @Body() recoverDto: RecoverSessionDto,
  ): Promise<Session> {
    return this.sessionRecoveryService.recoverSession(id, recoverDto);
  }

  @Get(':id/recovery-history')
  @ApiOperation({
    summary: 'Get session recovery history',
    description: 'Returns complete history of recovery attempts for a session, including success/failure status, timestamps, machine reassignments, and which tasks were resumed. Useful for debugging repeated failures.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique session identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Return recovery history', type: RecoveryHistoryDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getRecoveryHistory(@Param('id') id: string): Promise<RecoveryHistoryDto> {
    return this.sessionRecoveryService.getRecoveryHistory(id);
  }
}
