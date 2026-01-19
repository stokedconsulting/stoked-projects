import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Claude Projects State Tracking API')
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

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation available at: http://localhost:${port}/api/docs`);
}

bootstrap();
