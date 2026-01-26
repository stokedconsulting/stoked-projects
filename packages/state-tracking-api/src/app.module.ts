import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import configuration from './config/configuration';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { MachinesModule } from './modules/machines/machines.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LoggingModule } from './common/logging/logging.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CacheHeadersInterceptor } from './common/interceptors/cache-headers.interceptor';
import { PrometheusMiddleware } from './common/middleware/prometheus.middleware';
import { GitHubModule } from './github/github.module';
import { OrchestrationModule } from './modules/orchestration/orchestration.module';
import { UsersModule } from './modules/users/users.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

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
    MetricsModule,
    SessionsModule,
    TasksModule,
    MachinesModule,
    UsersModule,
    AuthModule,
    HealthModule,
    GitHubModule,
    OrchestrationModule,
  ],
  providers: [
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },

    // Global interceptors - order matters: RequestId first, then Logging, then CacheHeaders
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheHeadersInterceptor,
    },

    // Apply throttler guard globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply Prometheus middleware to all routes except metrics
    // DISABLED: Prometheus middleware causing issues
    // consumer
    //   .apply(PrometheusMiddleware)
    //   .forRoutes('*');
  }
}
