/**
 * Enhanced Error Handling Middleware
 * Provides comprehensive error handling, retry mechanisms, and circuit breaker patterns
 */

import { Request, Response, NextFunction } from 'express';
import { log } from '../../lib/log';
import { captureException } from '../../lib/error-reporting/sentry';

export interface ErrorHandlingConfig {
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  enableRetry: boolean;
  maxRetries: number;
  retryDelay: number;
}

// Circuit breaker state management
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

/**
 * Default error handling configuration
 */
const defaultConfig: ErrorHandlingConfig = {
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5, // Open circuit after 5 failures
  circuitBreakerTimeout: 30000, // 30 seconds
  enableRetry: true,
  maxRetries: 3,
  retryDelay: 1000 // 1 second
};

/**
 * Circuit breaker middleware for protecting against cascading failures
 */
export function circuitBreakerMiddleware(
  serviceName: string,
  config: Partial<ErrorHandlingConfig> = {}
) {
  const finalConfig = { ...defaultConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    const circuitState = getCircuitBreakerState(serviceName);
    
    // Check if circuit is open
    if (circuitState.state === 'open') {
      const now = Date.now();
      if (now - circuitState.lastFailureTime < finalConfig.circuitBreakerTimeout) {
        // Circuit is still open, reject request
        log(`Circuit breaker open for ${serviceName}, rejecting request`, {
          path: req.path,
          method: req.method,
          failures: circuitState.failures
        });
        
        res.status(503).json({
          message: 'Service temporarily unavailable',
          error: 'CIRCUIT_BREAKER_OPEN',
          retryAfter: Math.ceil((finalConfig.circuitBreakerTimeout - (now - circuitState.lastFailureTime)) / 1000)
        });
        return;
      } else {
        // Timeout expired, move to half-open state
        circuitState.state = 'half-open';
        log(`Circuit breaker moving to half-open state for ${serviceName}`);
      }
    }
    
    // Wrap response to monitor for failures
    const originalSend = res.send;
    const originalJson = res.json;
    
    res.send = function(body) {
      monitorResponse(serviceName, res.statusCode, finalConfig);
      return originalSend.call(this, body);
    };
    
    res.json = function(body) {
      monitorResponse(serviceName, res.statusCode, finalConfig);
      return originalJson.call(this, body);
    };
    
    next();
  };
}

/**
 * Get or create circuit breaker state for a service
 */
function getCircuitBreakerState(serviceName: string): CircuitBreakerState {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed'
    });
  }
  return circuitBreakers.get(serviceName)!;
}

/**
 * Monitor response and update circuit breaker state
 */
function monitorResponse(serviceName: string, statusCode: number, config: ErrorHandlingConfig) {
  const circuitState = getCircuitBreakerState(serviceName);
  
  if (statusCode >= 500) {
    // Server error, increment failure count
    circuitState.failures++;
    circuitState.lastFailureTime = Date.now();
    
    if (circuitState.failures >= config.circuitBreakerThreshold) {
      circuitState.state = 'open';
      log(`Circuit breaker opened for ${serviceName}`, {
        failures: circuitState.failures,
        threshold: config.circuitBreakerThreshold
      });
    }
  } else if (statusCode < 400) {
    // Success, reset failure count
    if (circuitState.state === 'half-open') {
      circuitState.state = 'closed';
      log(`Circuit breaker closed for ${serviceName}`);
    }
    circuitState.failures = 0;
  }
}

/**
 * Retry middleware for handling transient failures
 */
export function retryMiddleware(config: Partial<ErrorHandlingConfig> = {}) {
  const finalConfig = { ...defaultConfig, ...config };
  
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!finalConfig.enableRetry) {
      return next();
    }
    
    let attempt = 0;
    const maxAttempts = finalConfig.maxRetries + 1;
    
    const executeWithRetry = async (): Promise<void> => {
      attempt++;
      
      try {
        // Store original response methods
        const originalSend = res.send;
        const originalJson = res.json;
        let responseIntercepted = false;
        
        // Intercept response to check for retry conditions
        res.send = function(body) {
          if (responseIntercepted) return originalSend.call(this, body);
          responseIntercepted = true;
          
          if (shouldRetry(res.statusCode) && attempt < maxAttempts) {
            // Reset response for retry
            res.status(200); // Reset status
            setTimeout(() => executeWithRetry(), finalConfig.retryDelay * attempt);
            return this;
          }
          
          return originalSend.call(this, body);
        };
        
        res.json = function(body) {
          if (responseIntercepted) return originalJson.call(this, body);
          responseIntercepted = true;
          
          if (shouldRetry(res.statusCode) && attempt < maxAttempts) {
            // Reset response for retry
            res.status(200); // Reset status
            setTimeout(() => executeWithRetry(), finalConfig.retryDelay * attempt);
            return this;
          }
          
          return originalJson.call(this, body);
        };
        
        next();
      } catch (error) {
        if (attempt < maxAttempts) {
          log(`Retry attempt ${attempt}/${maxAttempts} for ${req.path}`, {
            error: error instanceof Error ? error.message : String(error)
          });
          setTimeout(() => executeWithRetry(), finalConfig.retryDelay * attempt);
        } else {
          throw error;
        }
      }
    };
    
    await executeWithRetry();
  };
}

/**
 * Determine if a response should be retried based on status code
 */
function shouldRetry(statusCode: number): boolean {
  // Retry on server errors and specific client errors
  return statusCode >= 500 || statusCode === 429 || statusCode === 408;
}

/**
 * Enhanced error handling middleware with comprehensive logging and response formatting
 */
export function enhancedErrorHandler(req: Request, res: Response, next: NextFunction, error?: any) {
  if (!error) {
    return next();
  }
  
  const errorId = generateErrorId();
  const timestamp = new Date().toISOString();
  
  // Determine error type and appropriate response
  let statusCode = 500;
  let errorType = 'INTERNAL_SERVER_ERROR';
  let message = 'Internal server error';
  let shouldLog = true;
  
  if (error.status || error.statusCode) {
    statusCode = error.status || error.statusCode;
  }
  
  // Categorize errors
  if (statusCode === 400) {
    errorType = 'BAD_REQUEST';
    message = 'Bad request';
    shouldLog = false; // Don't log client errors as server errors
  } else if (statusCode === 401) {
    errorType = 'UNAUTHORIZED';
    message = 'Authentication required';
    shouldLog = false;
  } else if (statusCode === 403) {
    errorType = 'FORBIDDEN';
    message = 'Access denied';
    shouldLog = false;
  } else if (statusCode === 404) {
    errorType = 'NOT_FOUND';
    message = 'Resource not found';
    shouldLog = false;
  } else if (statusCode === 429) {
    errorType = 'RATE_LIMIT_EXCEEDED';
    message = 'Too many requests';
    shouldLog = false;
  } else if (statusCode >= 500) {
    errorType = 'INTERNAL_SERVER_ERROR';
    message = 'Internal server error';
  }
  
  // Capture error with Sentry if it's a server error
  if (shouldLog && error instanceof Error) {
    captureException(error, {
      errorId,
      errorType,
      statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp
    });
  }

  // Log error if appropriate
  if (shouldLog) {
    log(`Error ${errorId}: ${error.message || message}`, {
      errorId,
      errorType,
      statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      stack: error.stack,
      timestamp
    });
  }
  
  // Send error response
  const errorResponse: {
    message: string;
    error: string;
    errorId: string;
    timestamp: string;
    details?: string;
    stack?: string;
  } = {
    message,
    error: errorType,
    errorId,
    timestamp
  };
  
  // Add additional details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.details = error.message;
    if (error.stack) {
      errorResponse.stack = error.stack;
    }
  }
  
  res.status(statusCode).json(errorResponse);
}

/**
 * Generate unique error ID for tracking
 */
function generateErrorId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `err_${timestamp}_${randomPart}`;
}

/**
 * Request timeout middleware to prevent hanging requests
 */
export function requestTimeoutMiddleware(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        log(`Request timeout after ${timeoutMs}ms`, {
          path: req.path,
          method: req.method,
          ip: req.ip
        });
        
        res.status(408).json({
          message: 'Request timeout',
          error: 'REQUEST_TIMEOUT',
          timeout: timeoutMs
        });
      }
    }, timeoutMs);
    
    // Clear timeout when response is sent
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));
    
    next();
  };
}

/**
 * Connection monitoring middleware
 */
export function connectionMonitoringMiddleware() {
  let activeConnections = 0;
  let totalConnections = 0;
  
  return (req: Request, res: Response, next: NextFunction) => {
    activeConnections++;
    totalConnections++;
    
    const startTime = Date.now();
    
    // Log connection metrics periodically
    if (totalConnections % 100 === 0) {
      log(`Connection metrics`, {
        activeConnections,
        totalConnections,
        timestamp: new Date().toISOString()
      });
    }
    
    res.on('finish', () => {
      activeConnections--;
      const duration = Date.now() - startTime;
      
      // Log slow requests
      if (duration > 5000) {
        log(`Slow request detected`, {
          path: req.path,
          method: req.method,
          duration,
          statusCode: res.statusCode
        });
      }
    });
    
    res.on('close', () => {
      activeConnections--;
    });
    
    next();
  };
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
  const status: Record<string, CircuitBreakerState> = {};
  for (const [serviceName, state] of circuitBreakers.entries()) {
    status[serviceName] = { ...state };
  }
  return status;
}