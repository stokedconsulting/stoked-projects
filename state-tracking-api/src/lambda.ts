import { configure as serverlessExpress } from '@codegenie/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLoggerService } from './common/logging/app-logger.service';

let cachedServer: any;

/**
 * Lambda handler for NestJS application
 * Uses serverless-express to adapt NestJS/Express for Lambda
 */
export const handler = async (event: any, context: any) => {
  // Cache the server instance for reuse across Lambda invocations
  if (!cachedServer) {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log'],
    });

    const logger = app.get(AppLoggerService);

    // Enable CORS
    app.enableCors({
      origin: '*', // TODO: Restrict in production
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Requested-With'],
      credentials: true,
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    // Global exception filter with logger
    app.useGlobalFilters(new AllExceptionsFilter(logger));

    // Swagger documentation
    const config = new DocumentBuilder()
      .setTitle('Claude Projects State Tracking API')
      .setDescription('Runtime state tracking API for Claude AI project orchestration sessions')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .addTag('sessions', 'Session state management endpoints')
      .addTag('tasks', 'Task monitoring endpoints')
      .addTag('machines', 'Machine/docker slot tracking endpoints')
      .addTag('health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    // Initialize the app
    await app.init();

    // Create serverless express handler
    const expressApp = app.getHttpAdapter().getInstance();
    cachedServer = serverlessExpress({ app: expressApp });
  }

  return cachedServer(event, context);
};
