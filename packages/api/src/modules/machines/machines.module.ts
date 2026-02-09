import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MachinesController } from './machines.controller';
import { MachinesService } from './machines.service';
import { MachineHealthService } from './machine-health.service';
import { Machine, MachineSchema } from '../../schemas/machine.schema';
import { Session, SessionSchema } from '../../schemas/session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Machine.name, schema: MachineSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [MachinesController],
  providers: [MachinesService, MachineHealthService],
  exports: [MachinesService, MachineHealthService],
})
export class MachinesModule {}
