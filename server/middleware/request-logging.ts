/**
 * Request Logging Middleware
 * Adds request IDs and enhanced logging with PII redaction
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { log, logError, setRequestId } from '../../lib/log';
import { getEnvVar, getEnvVarString } from '../../lib/env-security';

export interface RequestLoggingConfig {
  // Request ID header name
  requestIdHeader?: string;

  // Generate request IDs for all requests
  enableRequestId?: boolean;

  // Log request bodies (with redaction)
  logRequestBodies?: boolean;

  // Log response bodies (with redaction)
  logResponseBodies?: boolean;

  // Redact these fields from logs
  redactFields?: string[];

  // Log level for requests
  logLevel?: 'info' | 'debug';

  // Exclude paths from detailed logging
  excludePaths?: string[];

  // Include query parameters in logs
  includeQueryParams?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RequestLoggingConfig = {
  requestIdHeader: 'x-request-id',
  enableRequestId: true,
  logRequestBodies: false,
  logResponseBodies: false,
  redactFields: [
    'password', 'token', 'secret', 'key', 'authorization',
    'email', 'phone', 'ssn', 'credit_card', 'cvv',
    'api_key', 'access_token', 'refresh_token'
  ],
  logLevel: 'info',
  excludePaths: ['/api/health', '/api/performance/health', '/favicon.ico'],
  includeQueryParams: false
};

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Redact sensitive information from objects
 */
function redactSensitiveData(obj: any, redactFields: string[]): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, redactFields));
  }

  const redacted = { ...obj };

  for (const field of redactFields) {
    if (redacted[field] !== undefined) {
      redacted[field] = '[REDACTED]';
    }
  }

  // Also check nested objects
  for (const key in redacted) {
    if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key], redactFields);
    }
  }

  return redacted;
}

/**
 * Check if path should be excluded from detailed logging
 */
function shouldExcludePath(path: string, excludePaths: string[]): boolean {
  return excludePaths.some(excludePath => {
    if (excludePath.endsWith('*')) {
      return path.startsWith(excludePath.slice(0, -1));
    }
    return path === excludePath;
  });
}

/**
 * Request logging middleware factory
 */
export function createRequestLoggingMiddleware(customConfig?: Partial<RequestLoggingConfig>) {
  const config = { ...DEFAULT_CONFIG, ...customConfig };
  const isDevelopment = getEnvVar('NODE_ENV') === 'development';

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Generate or use existing request ID
      const requestId = req.headers[config.requestIdHeader!.toLowerCase()] as string ||
                       (config.enableRequestId ? generateRequestId() : 'unknown');

      // Add request ID to request object for use in other middleware
      (req as any).requestId = requestId;

      // Set request ID in logging context
      setRequestId(requestId);

      // Add request ID to response headers
      res.setHeader(config.requestIdHeader!, requestId);

      const startTime = Date.now();
      const path = req.path;
      const method = req.method;

      // Skip detailed logging for excluded paths
      if (shouldExcludePath(path, config.excludePaths || [])) {
        return next();
      }

      // Log request start
      const requestLog: {
        requestId: string;
        method: string;
        path: string;
        userAgent: string | undefined;
        ip: string | undefined;
        timestamp: string;
        query?: any;
        body?: any;
      } = {
        requestId,
        method,
        path,
        userAgent: req.get('User-Agent')?.substring(0, 100), // Limit length
        ip: req.ip,
        timestamp: new Date().toISOString()
      };

      if (config.includeQueryParams && Object.keys(req.query).length > 0) {
        requestLog.query = redactSensitiveData(req.query, config.redactFields || []);
      }

      if (config.logRequestBodies && req.body && Object.keys(req.body).length > 0) {
        requestLog.body = redactSensitiveData(req.body, config.redactFields || []);
      }

      log('Request started', requestLog);

      // Capture response details
      const originalSend = res.send;
      const originalJson = res.json;

      let responseBody: any = null;
      let responseStatusCode: number = 200;

      // Intercept response to capture body and status
      res.send = function(body) {
        responseBody = body;
        responseStatusCode = res.statusCode;
        return originalSend.call(this, body);
      };

      res.json = function(body) {
        responseBody = body;
        responseStatusCode = res.statusCode;
        return originalJson.call(this, body);
      };

      // Log response when finished
      res.on('finish', () => {
        const duration = Date.now() - startTime;

        const responseLog: {
          requestId: string;
          method: string;
          path: string;
          statusCode: number;
          duration: number;
          timestamp: string;
          contentLength: string | undefined;
          contentType: string | undefined;
          body?: any;
        } = {
          requestId,
          method,
          path,
          statusCode: responseStatusCode,
          duration,
          timestamp: new Date().toISOString(),
          contentLength: res.get('Content-Length'),
          contentType: res.get('Content-Type')
        };

        if (config.logResponseBodies && responseBody) {
          try {
            // Try to parse JSON response for logging
            const parsedBody = typeof responseBody === 'string' ?
              JSON.parse(responseBody) : responseBody;
            responseLog.body = redactSensitiveData(parsedBody, config.redactFields || []);
          } catch (e) {
            // If not JSON or parsing fails, log as string (truncated)
            responseLog.body = typeof responseBody === 'string' ?
              responseBody.substring(0, 200) : String(responseBody).substring(0, 200);
          }
        }

        // Log warnings for slow responses
        if (duration > 5000) {
          log('Slow response detected', { ...responseLog, severity: 'warning' });
        } else if (responseStatusCode >= 400) {
          log('Request completed with error', responseLog);
        } else if (isDevelopment || duration > 1000) {
          log('Request completed', responseLog);
        }
      });

      next();
    } catch (error) {
      logError('Request logging middleware error', error as Error, {
        path: req.path,
        method: req.method
      });
      next();
    }
  };
}

/**
 * Default request logging middleware
 */
export const requestLogging = createRequestLoggingMiddleware();

/**
 * Strict request logging middleware for sensitive endpoints
 */
export const strictRequestLogging = createRequestLoggingMiddleware({
  logRequestBodies: true,
  logResponseBodies: false, // Don't log sensitive response data
  includeQueryParams: true,
  redactFields: [
    ...DEFAULT_CONFIG.redactFields!,
    'session', 'cookie', 'auth', 'bearer'
  ]
});

/**
 * Export configuration types and utilities
 */
export { DEFAULT_CONFIG };
export { generateRequestId, redactSensitiveData };
