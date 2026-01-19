import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { MachinesModule } from './modules/machines/machines.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    
    // Database
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('mongodb.uri'),
        dbName: 'claude-projects',
      }),
      inject: [ConfigService],
    }),

    // Feature modules
    SessionsModule,
    TasksModule,
    MachinesModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
