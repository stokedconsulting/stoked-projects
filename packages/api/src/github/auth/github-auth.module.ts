import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitHubAuthService } from './github-auth.service';
import { VSCodeTokenStrategy } from './strategies/vscode-token.strategy';
import { ConfigTokenStrategy } from './strategies/config-token.strategy';
import { EnvTokenStrategy } from './strategies/env-token.strategy';

/**
 * Module providing GitHub authentication services
 * Supports multiple token sources with automatic caching and refresh
 */
@Module({
  imports: [ConfigModule],
  providers: [
    GitHubAuthService,
    VSCodeTokenStrategy,
    ConfigTokenStrategy,
    EnvTokenStrategy,
  ],
  exports: [GitHubAuthService, VSCodeTokenStrategy],
})
export class GitHubAuthModule {}
