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
import { MachinesService } from './machines.service';
import { Machine } from '../../schemas/machine.schema';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('machines')
@Controller('machines')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class MachinesController {
  constructor(private readonly machinesService: MachinesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all machines' })
  @ApiResponse({ status: 200, description: 'Return all machines', type: [Machine] })
  async findAll(): Promise<Machine[]> {
    return this.machinesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get machine by ID' })
  @ApiResponse({ status: 200, description: 'Return machine', type: Machine })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  async findOne(@Param('id') id: string): Promise<Machine | null> {
    return this.machinesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new machine' })
  @ApiResponse({ status: 201, description: 'Machine created', type: Machine })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() machine: Partial<Machine>): Promise<Machine> {
    return this.machinesService.create(machine);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update machine' })
  @ApiResponse({ status: 200, description: 'Machine updated', type: Machine })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  async update(
    @Param('id') id: string,
    @Body() update: Partial<Machine>,
  ): Promise<Machine | null> {
    return this.machinesService.update(id, update);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete machine' })
  @ApiResponse({ status: 200, description: 'Machine deleted', type: Machine })
  @ApiResponse({ status: 404, description: 'Machine not found' })
  async delete(@Param('id') id: string): Promise<Machine | null> {
    return this.machinesService.delete(id);
  }
}
