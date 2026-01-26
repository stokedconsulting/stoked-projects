import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './guards/api-key.guard';
import { GitHubOAuthService } from './oauth/github-oauth.service';
import { GitHubOAuthController } from './oauth/github-oauth.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [GitHubOAuthController],
  providers: [ApiKeyGuard, GitHubOAuthService],
  exports: [ApiKeyGuard, GitHubOAuthService],
})
export class AuthModule {}
