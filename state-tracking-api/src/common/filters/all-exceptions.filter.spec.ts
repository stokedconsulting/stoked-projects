import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AllExceptionsFilter, ErrorCode } from './all-exceptions.filter';
import { AppLoggerService } from '../logging/app-logger.service';
import { ArgumentsHost } from '@nestjs/common';

// Mock uuid module
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    // Create mock logger
    mockLogger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: AppLoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    filter = new AllExceptionsFilter(mockLogger);
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('HTTP Exceptions', () => {
    it('should handle NotFoundException correctly', () => {
      const exception = new NotFoundException('Resource not found');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          error: ErrorCode.NOT_FOUND,
          message: 'Resource not found',
          request_id: expect.any(String),
          timestamp: expect.any(String),
          path: '/test',
        }),
      );
    });

    it('should handle UnauthorizedException correctly', () => {
      const exception = new UnauthorizedException('Unauthorized access');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.UNAUTHORIZED,
          error: ErrorCode.UNAUTHORIZED,
          message: 'Unauthorized access',
        }),
      );
    });

    it('should handle ForbiddenException correctly', () => {
      const exception = new ForbiddenException('Forbidden');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.FORBIDDEN,
          error: ErrorCode.FORBIDDEN,
        }),
      );
    });

    it('should handle ConflictException correctly', () => {
      const exception = new ConflictException('Duplicate entry');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.CONFLICT,
          error: ErrorCode.CONFLICT,
        }),
      );
    });

    it('should handle BadRequestException with validation errors', () => {
      const validationErrors = ['field1 is required', 'field2 must be a number'];
      const exception = new BadRequestException({
        message: validationErrors,
        error: 'Bad Request',
        statusCode: 400,
      });
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details: validationErrors,
        }),
      );
    });
  });

  describe('Database Errors', () => {
    it('should handle Mongoose ValidationError', () => {
      const mongooseError = {
        name: 'ValidationError',
        errors: {
          email: { message: 'Email is required' },
          age: { message: 'Age must be a positive number' },
        },
      };
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(mongooseError, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Database validation failed',
          details: {
            email: 'Email is required',
            age: 'Age must be a positive number',
          },
        }),
      );
    });

    it('should handle MongoDB duplicate key error', () => {
      const duplicateKeyError = {
        code: 11000,
        keyValue: { email: 'test@example.com' },
      };
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(duplicateKeyError, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.CONFLICT,
          error: ErrorCode.CONFLICT,
          message: 'Duplicate entry',
          details: { duplicateKey: { email: 'test@example.com' } },
        }),
      );
    });

    it('should handle Mongoose CastError', () => {
      const castError = {
        name: 'CastError',
        path: 'id',
        value: 'invalid-id',
      };
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(castError, host);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid id: invalid-id',
        }),
      );
    });

    it('should handle generic database errors', () => {
      const dbError = {
        name: 'MongoError',
        message: 'Connection failed',
      };
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(dbError, host);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: ErrorCode.DATABASE_ERROR,
          message: 'Database operation failed',
        }),
      );
    });
  });

  describe('Timeout Errors', () => {
    it('should handle timeout errors', () => {
      const timeoutError = new Error('Operation timed out');
      timeoutError.name = 'TimeoutError';
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(timeoutError, host);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.GATEWAY_TIMEOUT,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.GATEWAY_TIMEOUT,
          error: ErrorCode.TIMEOUT,
          message: 'Request timeout',
          details: ['The operation took too long to complete'],
        }),
      );
    });
  });

  describe('Generic Errors', () => {
    it('should handle generic Error instances', () => {
      const error = new Error('Something went wrong');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(error, host);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: ErrorCode.INTERNAL_ERROR,
          message: 'Something went wrong',
        }),
      );
    });

    it('should handle unknown errors', () => {
      const unknownError = 'Something bad happened';
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(unknownError, host);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: ErrorCode.INTERNAL_ERROR,
          message: 'Internal server error',
        }),
      );
    });
  });

  describe('Request ID', () => {
    it('should include request ID in response', () => {
      const exception = new NotFoundException('Not found');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      const jsonCall = mockResponse.json.mock.calls[0][0];
      expect(jsonCall.request_id).toBeDefined();
      expect(typeof jsonCall.request_id).toBe('string');
    });

    it('should use existing request ID from header', () => {
      const requestId = 'existing-request-id';
      const exception = new NotFoundException('Not found');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest({
        headers: { 'x-request-id': requestId },
      });
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      const jsonCall = mockResponse.json.mock.calls[0][0];
      expect(jsonCall.request_id).toBe(requestId);
    });
  });

  describe('Response Format', () => {
    it('should return correctly formatted error response', () => {
      const exception = new BadRequestException('Invalid input');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest();
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      const jsonCall = mockResponse.json.mock.calls[0][0];
      expect(jsonCall).toHaveProperty('statusCode');
      expect(jsonCall).toHaveProperty('error');
      expect(jsonCall).toHaveProperty('message');
      expect(jsonCall).toHaveProperty('request_id');
      expect(jsonCall).toHaveProperty('timestamp');
      expect(jsonCall).toHaveProperty('path');
    });

    it('should include path in response', () => {
      const exception = new NotFoundException('Not found');
      const mockResponse = createMockResponse();
      const mockRequest = createMockRequest({ url: '/api/sessions/123' });
      const host = createMockArgumentsHost(mockRequest, mockResponse);

      filter.catch(exception, host);

      const jsonCall = mockResponse.json.mock.calls[0][0];
      expect(jsonCall.path).toBe('/api/sessions/123');
    });
  });
});

// Helper functions to create mocks
function createMockResponse() {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  };
  return res;
}

function createMockRequest(overrides: any = {}) {
  return {
    url: '/test',
    method: 'GET',
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function createMockArgumentsHost(request: any, response: any): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getArgByIndex: jest.fn(),
    getArgs: jest.fn(),
    getType: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
  } as any;
}
