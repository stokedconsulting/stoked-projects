import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrchestrationDocument = Orchestration & Document;

/**
 * Workspace orchestration tracking
 * Tracks running and desired LLM counts per workspace
 */
@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'orchestration',
})
export class Orchestration {
  @Prop({ required: true, unique: true, index: true })
  workspace_id: string; // Absolute path to workspace directory

  @Prop({ required: true, default: 0 })
  running: number; // Currently running LLMs in this workspace

  @Prop({ required: true, default: 0 })
  desired: number; // Desired number of LLMs for this workspace

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>; // Additional workspace info

  @Prop()
  last_updated: Date; // Last time this workspace was updated

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const OrchestrationSchema = SchemaFactory.createForClass(Orchestration);

// Indexes
// Note: workspace_id unique index is created automatically from @Prop({ unique: true })
// TTL index - remove stale workspace entries after 7 days of inactivity
OrchestrationSchema.index({ last_updated: 1 }, { expireAfterSeconds: 604800 }); // 7 days
