import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module';
import { GitHubIssuesController } from './github-issues.controller';
import { GitHubIssuesService } from './github-issues.service';
import { GitHubIssuesCacheService } from './github-issues-cache.service';

/**
 * GitHub Issues Module
 *
 * Provides REST API endpoints for GitHub Issues operations
 */
@Module({
  imports: [GitHubModule],
  controllers: [GitHubIssuesController],
  providers: [GitHubIssuesService, GitHubIssuesCacheService],
  exports: [GitHubIssuesService, GitHubIssuesCacheService],
})
export class GitHubIssuesModule {}
