/**
 * CORS Middleware Configuration
 * Provides cross-origin resource sharing controls with environment-specific settings
 */

import { Request, Response, NextFunction } from 'express';
import { getEnvVar, getEnvVarString } from '../../lib/env-security';
import { log } from '../../lib/log';

export interface CORSConfig {
  // Allowed origins - array of strings or regex patterns
  origins: (string | RegExp)[];

  // Allowed methods
  methods?: string[];

  // Allowed headers
  allowedHeaders?: string[];

  // Exposed headers
  exposedHeaders?: string[];

  // Credentials support
  credentials?: boolean;

  // Max age for preflight cache
  maxAge?: number;

  // Options for success logging
  enableLogging?: boolean;
}

/**
 * Default CORS configuration
 */
const DEFAULT_CORS_CONFIG: CORSConfig = {
  origins: ['http://localhost:3000', 'http://localhost:5173'], // Development defaults
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'User-Agent',
    'DNT',
    'Cache-Control',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Rate-Limit-Remaining'],
  credentials: true,
  maxAge: 86400, // 24 hours
  enableLogging: false
};

/**
 * Environment-specific CORS configuration
 */
function getEnvironmentCORSConfig(): CORSConfig {
  const nodeEnv = getEnvVar('NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';

  // Load custom configuration from environment if available
  const customOrigins = getEnvVarString('CORS_ORIGINS');
  const customMethods = getEnvVarString('CORS_METHODS');
  const customHeaders = getEnvVarString('CORS_ALLOWED_HEADERS');
  const customCredentials = getEnvVarString('CORS_CREDENTIALS');

  let origins: (string | RegExp)[] = [...DEFAULT_CORS_CONFIG.origins];

  // Parse custom origins
  if (customOrigins) {
    try {
      const parsedOrigins = JSON.parse(customOrigins);
      if (Array.isArray(parsedOrigins)) {
        origins = parsedOrigins.map(origin => {
          // Support regex patterns (prefixed with 'regex:')
          if (typeof origin === 'string' && origin.startsWith('regex:')) {
            const pattern = origin.slice(6);
            return new RegExp(pattern);
          }
          return origin;
        });
      }
    } catch (error) {
      log('Failed to parse CORS_ORIGINS environment variable', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // In production, only allow explicitly configured origins
  if (isProduction && !customOrigins) {
    origins = []; // No origins allowed by default in production
    log('Warning: No CORS_ORIGINS configured for production - CORS will be disabled');
  }

  const config: CORSConfig = {
    ...DEFAULT_CORS_CONFIG,
    origins,
    enableLogging: !isProduction // Enable logging in development
  };

  // Override with custom values if provided
  if (customMethods) {
    try {
      config.methods = JSON.parse(customMethods);
    } catch (error) {
      log('Failed to parse CORS_METHODS environment variable');
    }
  }

  if (customHeaders) {
    try {
      config.allowedHeaders = JSON.parse(customHeaders);
    } catch (error) {
      log('Failed to parse CORS_ALLOWED_HEADERS environment variable');
    }
  }

  if (customCredentials !== undefined) {
    config.credentials = customCredentials === 'true';
  }

  return config;
}

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string, allowedOrigins: (string | RegExp)[]): boolean {
  if (!origin) return false;

  return allowedOrigins.some(allowedOrigin => {
    if (typeof allowedOrigin === 'string') {
      return allowedOrigin === origin;
    } else if (allowedOrigin instanceof RegExp) {
      return allowedOrigin.test(origin);
    }
    return false;
  });
}

/**
 * CORS middleware factory
 */
export function createCORSMiddleware(customConfig?: Partial<CORSConfig>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const config = customConfig ?
        { ...getEnvironmentCORSConfig(), ...customConfig } :
        getEnvironmentCORSConfig();

      const origin = req.headers.origin as string;
      const isPreflight = req.method === 'OPTIONS';

      // Handle preflight requests
      if (isPreflight) {
        // Check if origin is allowed
        if (origin && !isOriginAllowed(origin, config.origins)) {
          if (config.enableLogging) {
            log('CORS preflight blocked', { origin, method: req.method, path: req.path });
          }
          res.status(403).json({ message: 'CORS policy violation' });
          return;
        }

        // Set preflight headers
        if (config.origins.length > 0) {
          res.setHeader('Access-Control-Allow-Origin', origin || '*');
        }
        if (config.credentials) {
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        if (config.methods && config.methods.length > 0) {
          res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));
        }
        if (config.allowedHeaders && config.allowedHeaders.length > 0) {
          res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
        }
        if (config.maxAge !== undefined) {
          res.setHeader('Access-Control-Max-Age', config.maxAge.toString());
        }

        if (config.enableLogging) {
          log('CORS preflight allowed', { origin, method: req.method, path: req.path });
        }

        res.status(200).end();
        return;
      }

      // Handle actual requests
      if (origin && isOriginAllowed(origin, config.origins)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        if (config.credentials) {
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        if (config.exposedHeaders && config.exposedHeaders.length > 0) {
          res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
        }

        if (config.enableLogging) {
          log('CORS request allowed', { origin, method: req.method, path: req.path });
        }
      } else if (origin && config.origins.length === 0) {
        // No origins configured - block all cross-origin requests
        if (config.enableLogging) {
          log('CORS request blocked - no origins configured', { origin, method: req.method, path: req.path });
        }
        res.status(403).json({ message: 'CORS policy violation' });
        return;
      }

      next();
    } catch (error) {
      log('CORS middleware error', {
        error: error instanceof Error ? error.message : String(error),
        origin: req.headers.origin,
        method: req.method,
        path: req.path
      });

      // On error, deny the request
      res.status(403).json({ message: 'CORS policy violation' });
    }
  };
}

/**
 * Default CORS middleware with standard configuration
 */
export const cors = createCORSMiddleware();

/**
 * Strict CORS middleware for sensitive endpoints
 */
export const strictCORS = createCORSMiddleware({
  origins: [], // Only same-origin allowed
  credentials: false,
  enableLogging: true
});

/**
 * Utility function to validate CORS configuration
 */
export function validateCORSConfig(config: CORSConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate origins
  if (!Array.isArray(config.origins)) {
    errors.push('origins must be an array');
  } else {
    config.origins.forEach((origin, index) => {
      if (typeof origin !== 'string' && !(origin instanceof RegExp)) {
        errors.push(`origins[${index}] must be a string or RegExp`);
      }
    });
  }

  // Validate methods
  if (config.methods && !Array.isArray(config.methods)) {
    errors.push('methods must be an array of strings');
  }

  // Validate headers
  if (config.allowedHeaders && !Array.isArray(config.allowedHeaders)) {
    errors.push('allowedHeaders must be an array of strings');
  }

  if (config.exposedHeaders && !Array.isArray(config.exposedHeaders)) {
    errors.push('exposedHeaders must be an array of strings');
  }

  // Validate maxAge
  if (config.maxAge !== undefined && (typeof config.maxAge !== 'number' || config.maxAge < 0)) {
    errors.push('maxAge must be a non-negative number');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Export configuration types and utilities
 */
export { DEFAULT_CORS_CONFIG, getEnvironmentCORSConfig };
