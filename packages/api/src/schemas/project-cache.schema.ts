import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'project_cache',
})
export class ProjectCache {
  @Prop({ required: true })
  project_id: string; // GitHub project node ID

  @Prop({ required: true })
  project_number: number;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  owner_login: string; // Organization or user login

  @Prop()
  repository_id?: string; // If linked to a repo

  @Prop()
  repository_name?: string;

  @Prop({ default: false })
  is_closed: boolean;

  @Prop({ type: Object })
  fields: Record<string, any>; // Project field definitions

  @Prop()
  cached_by_user_id: string; // User who triggered the cache

  @Prop({ type: Object })
  worktree_status?: {
    has_worktree: boolean;
    worktree_path: string;
    branch: string;
    has_uncommitted_changes: boolean;
    has_unpushed_commits: boolean;
    has_pr: boolean;
    pr_number: number | null;
    pr_merged: boolean;
    updated_at: Date;
    updated_by_workspace?: string; // workspace path that reported this
  };

  @Prop({ default: Date.now })
  last_fetched: Date;

  @Prop()
  cache_expires_at: Date; // TTL for cache
}

export type ProjectCacheDocument = ProjectCache & Document;
export const ProjectCacheSchema = SchemaFactory.createForClass(ProjectCache);

// Indexes
ProjectCacheSchema.index({ project_id: 1 });
ProjectCacheSchema.index({ owner_login: 1 });
ProjectCacheSchema.index({ repository_id: 1 });
ProjectCacheSchema.index({ project_number: 1, owner_login: 1 });
ProjectCacheSchema.index({ last_fetched: 1 });

// TTL index - auto-delete cached projects after 1 hour
ProjectCacheSchema.index({ cache_expires_at: 1 }, { expireAfterSeconds: 0 });
