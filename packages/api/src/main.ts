import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLoggerService } from './common/logging/app-logger.service';
import { TimeoutMiddleware } from './common/middleware/timeout.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Use console.log for bootstrap since AppLoggerService is scoped
  console.log('Starting Stoked Projects State Tracking API...');
  console.log(`Environment: ${configService.get('app.environment')}`);
  console.log(`Version: ${configService.get('app.version')}`);

  // Enable CORS
  app.enableCors();

  // Global validation pipe with detailed error messages
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        // Format validation errors for structured response
        const messages = errors.map((error) => {
          const constraints = error.constraints
            ? Object.values(error.constraints)
            : ['Validation failed'];
          return constraints.join(', ');
        });
        return new ValidationPipe().createExceptionFactory()(errors);
      },
    }),
  );

  // Global exception filter is registered as APP_FILTER in app.module.ts

  // Apply timeout middleware globally (30 second timeout)
  app.use(new TimeoutMiddleware(30000).use.bind(new TimeoutMiddleware(30000)));

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Stoked Projects State Tracking API')
    .setDescription(
      'Runtime state tracking API for Claude AI project orchestration sessions.\n\n' +
      '## Authentication\n\n' +
      'This API uses API key authentication. Include your API key in one of two ways:\n\n' +
      '1. **Bearer Token (recommended)**: `Authorization: Bearer YOUR_API_KEY`\n' +
      '2. **X-API-Key Header**: `X-API-Key: YOUR_API_KEY`\n\n' +
      'All endpoints except `/health` and `/health/ready` require authentication.'
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description: 'Enter your API key',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'API key for authentication',
      },
      'api-key',
    )
    .addTag('sessions', 'Session state management endpoints (requires authentication)')
    .addTag('tasks', 'Task monitoring endpoints (requires authentication)')
    .addTag('machines', 'Machine/docker slot tracking endpoints (requires authentication)')
    .addTag('health', 'Health check endpoints (public, no authentication required)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);

  console.log('Application started successfully');
  console.log(`Port: ${port}`);
  console.log(`URL: http://localhost:${port}`);
  console.log(`Docs: http://localhost:${port}/api/docs`);
}

bootstrap();
