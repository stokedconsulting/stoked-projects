import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Orchestration,
  OrchestrationSchema,
} from '../../schemas/orchestration.schema';
import { OrchestrationService } from './orchestration.service';
import { OrchestrationController } from './orchestration.controller';
import { OrchestrationGateway } from './orchestration.gateway';
import { LoggingModule } from '../../common/logging/logging.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Orchestration.name, schema: OrchestrationSchema },
    ]),
    LoggingModule,
    AuthModule,
  ],
  controllers: [OrchestrationController],
  providers: [OrchestrationService, OrchestrationGateway],
  exports: [OrchestrationService, OrchestrationGateway],
})
export class OrchestrationModule {}
