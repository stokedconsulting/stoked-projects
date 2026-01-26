import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findByGithubId(githubId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ github_id: githubId });
  }

  async createOrUpdate(userData: {
    github_id: string;
    github_login: string;
    github_name?: string;
    github_email?: string;
    github_avatar_url?: string;
    access_token: string;
    refresh_token?: string;
    token_expires_at?: Date;
  }): Promise<UserDocument> {
    const existingUser = await this.findByGithubId(userData.github_id);

    if (existingUser) {
      // Update existing user
      existingUser.github_login = userData.github_login;
      existingUser.github_name = userData.github_name;
      existingUser.github_email = userData.github_email;
      existingUser.github_avatar_url = userData.github_avatar_url;
      existingUser.access_token = userData.access_token;
      existingUser.refresh_token = userData.refresh_token;
      existingUser.token_expires_at = userData.token_expires_at;
      existingUser.last_login = new Date();
      return existingUser.save();
    }

    // Create new user
    const user = new this.userModel({
      ...userData,
      last_login: new Date(),
    });

    return user.save();
  }

  async updateLastLogin(githubId: string): Promise<void> {
    await this.userModel.updateOne(
      { github_id: githubId },
      { last_login: new Date() },
    );
  }
}
