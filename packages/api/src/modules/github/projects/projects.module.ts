import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsCacheService } from './projects-cache.service';
import { GitHubLoggingModule } from '../../../github/logging/github-logging.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [
    GitHubLoggingModule,
    AuthModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsCacheService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
