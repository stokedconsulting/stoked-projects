import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'users',
})
export class User {
  @Prop({ required: true })
  github_id: string;

  @Prop({ required: true })
  github_login: string;

  @Prop()
  github_name?: string;

  @Prop()
  github_email?: string;

  @Prop()
  github_avatar_url?: string;

  @Prop({ required: true })
  access_token: string;

  @Prop()
  refresh_token?: string;

  @Prop()
  token_expires_at?: Date;

  @Prop({ default: Date.now })
  last_login: Date;
}

export type UserDocument = User & Document;
export const UserSchema = SchemaFactory.createForClass(User);

// Create indexes
UserSchema.index({ github_id: 1 });
UserSchema.index({ github_login: 1 });
