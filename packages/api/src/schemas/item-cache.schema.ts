import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'item_cache',
})
export class ItemCache {
  @Prop({ required: true })
  item_id: string; // GitHub project item node ID

  @Prop({ required: true })
  project_id: string; // Parent project ID

  @Prop({ required: true })
  content_id: string; // Issue/PR node ID

  @Prop({ required: true })
  content_type: string; // 'Issue' or 'PullRequest'

  @Prop({ required: true })
  title: string;

  @Prop()
  body?: string;

  @Prop({ required: true })
  state: string; // 'OPEN', 'CLOSED', etc.

  @Prop({ required: true })
  number: number; // Issue/PR number

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  repository_owner: string;

  @Prop({ required: true })
  repository_name: string;

  @Prop({ type: Object })
  field_values: Record<string, any>; // Custom field values (Status, Phase, etc.)

  @Prop({ type: [String], default: [] })
  labels: string[];

  @Prop()
  assignee_login?: string;

  @Prop()
  author_login?: string;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at_github: Date; // Last updated on GitHub

  @Prop()
  closed_at?: Date;

  @Prop({ default: Date.now })
  last_fetched: Date;

  @Prop()
  cache_expires_at: Date; // TTL for cache
}

export type ItemCacheDocument = ItemCache & Document;
export const ItemCacheSchema = SchemaFactory.createForClass(ItemCache);

// Indexes
ItemCacheSchema.index({ item_id: 1 });
ItemCacheSchema.index({ project_id: 1 });
ItemCacheSchema.index({ content_id: 1 });
ItemCacheSchema.index({ project_id: 1, state: 1 });
ItemCacheSchema.index({ repository_owner: 1, repository_name: 1, number: 1 });
ItemCacheSchema.index({ last_fetched: 1 });

// TTL index - auto-delete cached items after 1 hour
ItemCacheSchema.index({ cache_expires_at: 1 }, { expireAfterSeconds: 0 });
