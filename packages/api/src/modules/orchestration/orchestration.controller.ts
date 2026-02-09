import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsNumber, Min, Max } from 'class-validator';
import { OrchestrationService } from './orchestration.service';
import { OrchestrationGateway } from './orchestration.gateway';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { SkipThrottle } from '../../common/decorators/skip-throttle.decorator';

class UpdateDesiredDto {
  @IsNumber()
  @Min(0)
  @Max(20)
  desired: number;
}

class UpdateRunningDto {
  @IsNumber()
  @Min(0)
  running: number;
}

@Controller('api/orchestration')
@UseGuards(ApiKeyGuard)
export class OrchestrationController {
  constructor(
    private orchestrationService: OrchestrationService,
    private orchestrationGateway: OrchestrationGateway,
  ) {}

  /**
   * Get orchestration data for a workspace
   * GET /api/orchestration/workspace/:workspaceId
   */
  @Get('workspace/:workspaceId')
  @SkipThrottle()
  async getWorkspaceOrchestration(@Param('workspaceId') workspaceId: string) {
    const decoded = decodeURIComponent(workspaceId);
    return this.orchestrationService.getWorkspaceOrchestration(decoded);
  }

  /**
   * Update workspace desired count
   * PUT /api/orchestration/workspace/:workspaceId/desired
   */
  @Put('workspace/:workspaceId/desired')
  @HttpCode(HttpStatus.OK)
  async updateWorkspaceDesired(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateDesiredDto,
  ) {
    const decoded = decodeURIComponent(workspaceId);
    const result = await this.orchestrationService.updateWorkspaceDesired(
      decoded,
      dto.desired,
    );

    // Broadcast global update to all clients
    this.orchestrationGateway.broadcastGlobalUpdate(result.global);

    // Notify specific workspace clients
    this.orchestrationGateway.broadcastWorkspaceUpdate(
      decoded,
      result.workspace,
    );

    return result;
  }

  /**
   * Update workspace running count (internal use)
   * PUT /api/orchestration/workspace/:workspaceId/running
   */
  @Put('workspace/:workspaceId/running')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async updateWorkspaceRunning(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateRunningDto,
  ) {
    const decoded = decodeURIComponent(workspaceId);
    const result = await this.orchestrationService.updateWorkspaceRunning(
      decoded,
      dto.running,
    );

    // Broadcast global update to all clients
    this.orchestrationGateway.broadcastGlobalUpdate(result.global);

    // Notify specific workspace clients
    this.orchestrationGateway.broadcastWorkspaceUpdate(
      decoded,
      result.workspace,
    );

    return result;
  }

  /**
   * Get global orchestration totals
   * GET /api/orchestration/global
   */
  @Get('global')
  @SkipThrottle()
  async getGlobalOrchestration() {
    return this.orchestrationService.calculateGlobalTotals();
  }

  /**
   * Get all workspaces
   * GET /api/orchestration/workspaces
   */
  @Get('workspaces')
  async getAllWorkspaces() {
    return this.orchestrationService.getAllWorkspaces();
  }
}
