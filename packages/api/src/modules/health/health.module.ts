import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatSchedulerService } from './heartbeat-scheduler.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SessionsModule } from '../sessions/sessions.module';
import { MachinesModule } from '../machines/machines.module';
import { Session, SessionSchema } from '../../schemas/session.schema';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    SessionsModule,
    MachinesModule,
  ],
  controllers: [HealthController],
  providers: [HealthService, HeartbeatService, HeartbeatSchedulerService, MetricsService],
  exports: [HeartbeatService, MetricsService],
})
export class HealthModule {}
