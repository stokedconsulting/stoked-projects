import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

export const REQUEST_ID_KEY = 'requestId';

/**
 * Interceptor that generates a unique request ID for each incoming request.
 * The request ID is:
 * - Generated as a UUID v4
 * - Stored in the request object for access throughout the request lifecycle
 * - Returned in the X-Request-Id response header
 * - Included in all log entries for request tracing
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Generate a unique request ID
    const requestId = uuidv4();

    // Store request ID in the request object for access in services/controllers
    request[REQUEST_ID_KEY] = requestId;

    // Return request ID in response header
    return next.handle().pipe(
      tap(() => {
        response.setHeader('X-Request-Id', requestId);
      }),
    );
  }
}
