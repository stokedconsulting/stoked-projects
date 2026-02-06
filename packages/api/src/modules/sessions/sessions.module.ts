import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionHealthService } from './session-health.service';
import { SessionFailureService } from './session-failure.service';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionCleanupSchedulerService } from './session-cleanup-scheduler.service';
import { SessionRecoveryService } from './session-recovery.service';
import { Session, SessionSchema } from '../../schemas/session.schema';
import { Task, TaskSchema } from '../../schemas/task.schema';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
    forwardRef(() => TasksModule),
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionHealthService,
    SessionFailureService,
    SessionCleanupService,
    SessionCleanupSchedulerService,
    SessionRecoveryService,
  ],
  exports: [
    SessionsService,
    SessionHealthService,
    SessionFailureService,
    SessionCleanupService,
    SessionRecoveryService,
  ],
})
export class SessionsModule {}
