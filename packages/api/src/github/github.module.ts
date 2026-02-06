import { Module } from '@nestjs/common';
import { GitHubAuthModule } from './auth/github-auth.module';
import { ProjectsModule } from './projects/projects.module';
import { IssuesModule } from './issues/issues.module';

@Module({
  imports: [GitHubAuthModule, ProjectsModule, IssuesModule],
  exports: [GitHubAuthModule, ProjectsModule, IssuesModule],
})
export class GitHubModule {}
