import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { Session } from '../../schemas/session.schema';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('sessions')
@Controller('sessions')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all sessions' })
  @ApiResponse({ status: 200, description: 'Return all sessions', type: [Session] })
  async findAll(): Promise<Session[]> {
    return this.sessionsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session by ID' })
  @ApiResponse({ status: 200, description: 'Return session', type: Session })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async findOne(@Param('id') id: string): Promise<Session | null> {
    return this.sessionsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new session' })
  @ApiResponse({ status: 201, description: 'Session created', type: Session })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() session: Partial<Session>): Promise<Session> {
    return this.sessionsService.create(session);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update session' })
  @ApiResponse({ status: 200, description: 'Session updated', type: Session })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async update(
    @Param('id') id: string,
    @Body() update: Partial<Session>,
  ): Promise<Session | null> {
    return this.sessionsService.update(id, update);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete session' })
  @ApiResponse({ status: 200, description: 'Session deleted', type: Session })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async delete(@Param('id') id: string): Promise<Session | null> {
    return this.sessionsService.delete(id);
  }
}
