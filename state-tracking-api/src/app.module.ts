import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { MachinesModule } from './modules/machines/machines.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LoggingModule } from './common/logging/logging.module';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { GitHubModule } from './modules/github/github.module';
import { GitHubLoggingModule } from './github/logging/github-logging.module';
import { GitHubErrorHandlerModule } from './github/errors/github-error-handler.module';
import { GitHubIssuesModule } from './modules/github-issues/github-issues.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Rate limiting - Global limit: 100 requests/minute per IP
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 seconds
        limit: 100, // 100 requests per minute
      },
    ]),

    // Database with timeout configuration
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('mongodb.uri'),
        dbName: 'claude-projects',
        serverSelectionTimeoutMS: 10000, // 10 second timeout for server selection
        socketTimeoutMS: 10000, // 10 second timeout for socket operations
      }),
      inject: [ConfigService],
    }),

    // Feature modules
    LoggingModule,
    SessionsModule,
    TasksModule,
    MachinesModule,
    AuthModule,
    HealthModule,

    // GitHub modules
    GitHubLoggingModule,
    GitHubErrorHandlerModule,
    GitHubModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('github.token', ''),
        maxConnections: 10,
        retryAttempts: 3,
        retryDelays: [1000, 2000, 4000],
        timeout: 30000,
      }),
      inject: [ConfigService],
    }),
    GitHubIssuesModule,
  ],
  providers: [
    // Global interceptors - order matters: RequestId first, then Logging
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },

    // Apply throttler guard globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
