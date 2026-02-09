import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectEventsController } from './project-events.controller';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { LoggingModule } from '../../common/logging/logging.module';
import { AuthModule } from '../auth/auth.module';
import {
  ProjectCache,
  ProjectCacheSchema,
} from '../../schemas/project-cache.schema';

@Module({
  imports: [
    OrchestrationModule,
    LoggingModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: ProjectCache.name, schema: ProjectCacheSchema },
    ]),
  ],
  controllers: [ProjectEventsController],
})
export class ProjectEventsModule {}
