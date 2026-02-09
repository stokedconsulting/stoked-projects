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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { MachinesService } from './machines.service';
import { MachineHealthService } from './machine-health.service';
import { Machine } from '../../schemas/machine.schema';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  CreateMachineDto,
  UpdateMachineDto,
  AssignSessionDto,
  ReleaseSessionDto,
  MachineQueryDto,
} from './dto';
import { MachineAvailabilityDto } from './dto/machine-availability.dto';
import { MachineHeartbeatResponseDto } from './dto/heartbeat-response.dto';

@ApiTags('machines')
@Controller('machines')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
export class MachinesController {
  constructor(
    private readonly machinesService: MachinesService,
    private readonly machineHealthService: MachineHealthService,
  ) {}

  @Get('available')
  @ApiOperation({
    summary: 'Find available machines',
    description: 'Returns machines with status="online", including available docker slot count. Sorted by most available slots.'
  })
  @ApiResponse({ status: 200, description: 'Return available machines', type: [MachineAvailabilityDto] })
  async findAvailableMachines(): Promise<MachineAvailabilityDto[]> {
    return this.machineHealthService.findAvailableMachines();
  }

  @Get()
  @ApiOperation({
    summary: 'List all machines',
    description: 'Get all registered machines with optional filtering by status and hostname'
  })
  @ApiQuery({ name: 'status', required: false, enum: ['online', 'offline', 'maintenance'] })
  @ApiQuery({ name: 'hostname', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Return all machines', type: [Machine] })
  async findAll(@Query() query: MachineQueryDto): Promise<Machine[]> {
    return this.machinesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get machine by ID',
    description: 'Retrieve a single machine by its machine_id'
  })
  @ApiResponse({ status: 200, description: 'Return machine', type: Machine })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  async findOne(@Param('id') id: string): Promise<Machine> {
    return this.machinesService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register new machine',
    description: 'Register a new machine with docker slots. Sets status=online and initializes last_heartbeat'
  })
  @ApiResponse({ status: 201, description: 'Machine created', type: Machine })
  @ApiResponse({ status: 400, description: 'Invalid input - docker slots must be unique positive integers' })
  @ApiResponse({ status: 409, description: 'Machine with this ID already exists' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createMachineDto: CreateMachineDto): Promise<Machine> {
    return this.machinesService.create(createMachineDto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update machine',
    description: 'Update machine properties (docker_slots, status, metadata). Updates last_heartbeat automatically'
  })
  @ApiResponse({ status: 200, description: 'Machine updated', type: Machine })
  @ApiResponse({ status: 400, description: 'Invalid input or cannot remove slots in use' })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  async update(
    @Param('id') id: string,
    @Body() updateMachineDto: UpdateMachineDto,
  ): Promise<Machine> {
    return this.machinesService.update(id, updateMachineDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete/deregister machine',
    description: 'Sets machine status to offline (soft delete)'
  })
  @ApiResponse({ status: 204, description: 'Machine deregistered' })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.machinesService.delete(id);
  }

  @Post(':id/assign-session')
  @ApiOperation({
    summary: 'Assign session to machine slot',
    description: 'Assigns a session to this machine, allocating a docker slot. Auto-assigns slot if not specified. Updates session with machine_id and docker_slot'
  })
  @ApiResponse({ status: 200, description: 'Session assigned to machine', type: Machine })
  @ApiResponse({ status: 400, description: 'Machine is offline or slot validation failed' })
  @ApiResponse({ status: 404, description: 'Machine or session not found' })
  @ApiResponse({ status: 409, description: 'Session already assigned or slot occupied or no available slots' })
  async assignSession(
    @Param('id') id: string,
    @Body() assignSessionDto: AssignSessionDto,
  ): Promise<Machine> {
    return this.machinesService.assignSession(id, assignSessionDto);
  }

  @Post(':id/release-session')
  @ApiOperation({
    summary: 'Release session from machine slot',
    description: 'Removes a session from this machine, freeing up its docker slot'
  })
  @ApiResponse({ status: 200, description: 'Session released from machine', type: Machine })
  @ApiResponse({ status: 400, description: 'Session is not assigned to this machine' })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  async releaseSession(
    @Param('id') id: string,
    @Body() releaseSessionDto: ReleaseSessionDto,
  ): Promise<Machine> {
    return this.machinesService.releaseSession(id, releaseSessionDto);
  }

  @Post(':id/heartbeat')
  @ApiOperation({
    summary: 'Update machine heartbeat',
    description: 'Updates the last_heartbeat timestamp for a machine. If the machine is offline, it will be changed back to online. Recommended heartbeat interval: 60 seconds.'
  })
  @ApiResponse({ status: 200, description: 'Heartbeat updated successfully', type: MachineHeartbeatResponseDto })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  @HttpCode(HttpStatus.OK)
  async updateHeartbeat(@Param('id') id: string): Promise<MachineHeartbeatResponseDto> {
    const machine = await this.machinesService.updateHeartbeat(id);

    return {
      machine_id: machine.machine_id,
      status: machine.status,
      last_heartbeat: machine.last_heartbeat,
      message: machine.status === 'online'
        ? 'Heartbeat updated successfully'
        : `Heartbeat updated and machine brought back online`
    };
  }
}
