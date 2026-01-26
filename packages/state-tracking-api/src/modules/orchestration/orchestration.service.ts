import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Orchestration,
  OrchestrationDocument,
} from '../../schemas/orchestration.schema';
import { AppLoggerService } from '../../common/logging/app-logger.service';

export interface WorkspaceOrchestration {
  workspace_id: string;
  running: number;
  desired: number;
}

export interface GlobalOrchestration {
  running: number;
  desired: number;
}

export interface OrchestrationUpdate {
  workspace: WorkspaceOrchestration;
  global: GlobalOrchestration;
}

@Injectable()
export class OrchestrationService {
  constructor(
    @InjectModel(Orchestration.name)
    private orchestrationModel: Model<OrchestrationDocument>,
    private logger: AppLoggerService,
  ) {
    this.logger.setContext('OrchestrationService');
  }

  /**
   * Get orchestration data for a specific workspace
   */
  async getWorkspaceOrchestration(
    workspaceId: string,
  ): Promise<OrchestrationUpdate> {
    // Get or create workspace data
    const workspace = await this.orchestrationModel
      .findOneAndUpdate(
        { workspace_id: workspaceId },
        {
          $setOnInsert: {
            workspace_id: workspaceId,
            running: 0,
            desired: 0,
            last_updated: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
        },
      )
      .lean()
      .exec();

    // Calculate global totals
    const global = await this.calculateGlobalTotals();

    return {
      workspace: {
        workspace_id: workspace.workspace_id,
        running: workspace.running,
        desired: workspace.desired,
      },
      global,
    };
  }

  /**
   * Update workspace desired count
   */
  async updateWorkspaceDesired(
    workspaceId: string,
    desired: number,
  ): Promise<OrchestrationUpdate> {
    // Validate desired count
    if (desired < 0 || desired > 20) {
      throw new Error('Desired count must be between 0 and 20');
    }

    // Update or create workspace
    const workspace = await this.orchestrationModel.findOneAndUpdate(
      { workspace_id: workspaceId },
      {
        $set: {
          desired,
          last_updated: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
      },
    );

    this.logger.log('Workspace desired updated', {
      workspace_id: workspaceId,
      desired,
      event: 'orchestration.workspace.desired.updated',
    });

    // Calculate global totals
    const global = await this.calculateGlobalTotals();

    return {
      workspace: {
        workspace_id: workspace.workspace_id,
        running: workspace.running,
        desired: workspace.desired,
      },
      global,
    };
  }

  /**
   * Update workspace running count
   */
  async updateWorkspaceRunning(
    workspaceId: string,
    running: number,
  ): Promise<OrchestrationUpdate> {
    // Validate running count
    if (running < 0) {
      throw new Error('Running count must be >= 0');
    }

    // Update or create workspace
    const workspace = await this.orchestrationModel.findOneAndUpdate(
      { workspace_id: workspaceId },
      {
        $set: {
          running,
          last_updated: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
      },
    );

    this.logger.log('Workspace running updated', {
      workspace_id: workspaceId,
      running,
      event: 'orchestration.workspace.running.updated',
    });

    // Calculate global totals
    const global = await this.calculateGlobalTotals();

    return {
      workspace: {
        workspace_id: workspace.workspace_id,
        running: workspace.running,
        desired: workspace.desired,
      },
      global,
    };
  }

  /**
   * Calculate global orchestration totals from all workspaces
   */
  async calculateGlobalTotals(): Promise<GlobalOrchestration> {
    const result = await this.orchestrationModel.aggregate([
      {
        $group: {
          _id: null,
          total_running: { $sum: '$running' },
          total_desired: { $sum: '$desired' },
        },
      },
    ]);

    if (result.length === 0) {
      return { running: 0, desired: 0 };
    }

    return {
      running: result[0].total_running,
      desired: result[0].total_desired,
    };
  }

  /**
   * Get all active workspaces
   */
  async getAllWorkspaces(): Promise<WorkspaceOrchestration[]> {
    const workspaces = await this.orchestrationModel.find().lean().exec();

    return workspaces.map((w) => ({
      workspace_id: w.workspace_id,
      running: w.running,
      desired: w.desired,
    }));
  }

  /**
   * Clean up stale workspaces (not updated in 7 days)
   * This is handled automatically by the TTL index, but this method
   * can be called manually if needed
   */
  async cleanupStaleWorkspaces(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.orchestrationModel.deleteMany({
      last_updated: { $lt: sevenDaysAgo },
    });

    this.logger.log('Cleaned up stale workspaces', {
      count: result.deletedCount,
      event: 'orchestration.cleanup',
    });

    return result.deletedCount;
  }
}
