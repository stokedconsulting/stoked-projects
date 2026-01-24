import { Module } from '@nestjs/common';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';
import { ReposCacheService } from './repos-cache.service';
import { LoggingModule } from '../../../common/logging/logging.module';
import { AuthModule } from '../../auth/auth.module';

/**
 * Module for repository and organization metadata queries
 */
@Module({
  imports: [LoggingModule, AuthModule],
  controllers: [ReposController],
  providers: [ReposService, ReposCacheService],
  exports: [ReposService, ReposCacheService],
})
export class ReposModule {}
