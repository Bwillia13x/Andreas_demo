/**
 * CSRF Protection Middleware
 * Provides Cross-Site Request Forgery protection using double-submit cookie pattern
 */

import { Request, Response, NextFunction } from 'express';
import { getEnvVar, getEnvVarString } from '../../lib/env-security';
import { log } from '../../lib/log';
import crypto from 'crypto';

export interface CSRFConfig {
  // CSRF token cookie name
  cookieName: string;

  // CSRF token header name
  headerName: string;

  // Token length in bytes
  tokenLength: number;

  // Cookie options
  cookieOptions: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    maxAge?: number;
    path?: string;
  };

  // Excluded paths (regex patterns)
  excludePatterns?: RegExp[];

  // Methods that require CSRF protection
  protectedMethods?: string[];

  // Enable logging
  enableLogging?: boolean;
}

/**
 * Default CSRF configuration
 */
const DEFAULT_CSRF_CONFIG: CSRFConfig = {
  cookieName: 'csrf-token',
  headerName: 'x-csrf-token',
  tokenLength: 32,
  cookieOptions: {
    httpOnly: false, // Must be accessible to client-side JavaScript
    secure: true,
    sameSite: 'strict',
    maxAge: 3600000, // 1 hour
    path: '/'
  },
  excludePatterns: [
    /^\/api\/health$/, // Health checks
    /^\/api\/performance/, // Performance endpoints
    /^\/$/, // Root path
    /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/, // Static assets
  ],
  protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  enableLogging: false
};

/**
 * Environment-specific CSRF configuration
 */
function getEnvironmentCSRFConfig(): CSRFConfig {
  const nodeEnv = getEnvVar('NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';

  // Load custom configuration from environment if available
  const customCookieName = getEnvVarString('CSRF_COOKIE_NAME');
  const customHeaderName = getEnvVarString('CSRF_HEADER_NAME');
  const customExcludePatterns = getEnvVarString('CSRF_EXCLUDE_PATTERNS');
  const customProtectedMethods = getEnvVarString('CSRF_PROTECTED_METHODS');

  const config: CSRFConfig = {
    ...DEFAULT_CSRF_CONFIG,
    cookieOptions: {
      ...DEFAULT_CSRF_CONFIG.cookieOptions,
      secure: isProduction // HTTPS only in production
    },
    enableLogging: !isProduction
  };

  // Override with custom values if provided
  if (customCookieName) {
    config.cookieName = customCookieName;
  }

  if (customHeaderName) {
    config.headerName = customHeaderName;
  }

  if (customExcludePatterns) {
    try {
      const patterns = JSON.parse(customExcludePatterns);
      if (Array.isArray(patterns)) {
        config.excludePatterns = patterns.map(p => new RegExp(p));
      }
    } catch (error) {
      log('Failed to parse CSRF_EXCLUDE_PATTERNS environment variable');
    }
  }

  if (customProtectedMethods) {
    try {
      config.protectedMethods = JSON.parse(customProtectedMethods);
    } catch (error) {
      log('Failed to parse CSRF_PROTECTED_METHODS environment variable');
    }
  }

  return config;
}

/**
 * Generate a random CSRF token
 */
function generateCSRFToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Check if path should be excluded from CSRF protection
 */
function isExcludedPath(path: string, excludePatterns: RegExp[]): boolean {
  return excludePatterns.some(pattern => pattern.test(path));
}

  /**
   * CSRF protection middleware factory
   */
  export function createCSRFMiddleware(customConfig?: Partial<CSRFConfig>) {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const config = customConfig ?
          { ...getEnvironmentCSRFConfig(), ...customConfig } :
          getEnvironmentCSRFConfig();

        const method = req.method.toUpperCase();
        const path = req.path;

        // Skip CSRF protection in smoke test mode
        if (process.env.SMOKE_MODE === '1') {
          if (config.enableLogging) {
            log('CSRF protection skipped for smoke test mode', { method, path });
          }
          return next();
        }

      // Skip CSRF protection for excluded paths
      if (isExcludedPath(path, config.excludePatterns || [])) {
        if (config.enableLogging) {
          log('CSRF protection skipped for excluded path', { method, path });
        }
        return next();
      }

      // Skip CSRF protection for unprotected methods
      if (!config.protectedMethods?.includes(method)) {
        if (config.enableLogging) {
          log('CSRF protection skipped for unprotected method', { method, path });
        }
        return next();
      }

      // For GET requests, set CSRF token cookie if not present
      if (method === 'GET') {
        if (!req.cookies[config.cookieName!]) {
          const token = generateCSRFToken(config.tokenLength);
          res.cookie(config.cookieName!, token, config.cookieOptions);

          if (config.enableLogging) {
            log('CSRF token set for GET request', { path, tokenSet: true });
          }
        }
        return next();
      }

      // For protected methods, verify CSRF token
      const cookieToken = req.cookies[config.cookieName!];
      const headerToken = req.headers[config.headerName!.toLowerCase()] as string;

      if (!cookieToken) {
        if (config.enableLogging) {
          log('CSRF protection failed: no cookie token', { method, path });
        }
        res.status(403).json({
          message: 'CSRF token missing',
          error: 'CSRF_TOKEN_MISSING'
        });
        return;
      }

      if (!headerToken) {
        if (config.enableLogging) {
          log('CSRF protection failed: no header token', { method, path });
        }
        res.status(403).json({
          message: 'CSRF token missing from headers',
          error: 'CSRF_TOKEN_MISSING'
        });
        return;
      }

      if (cookieToken !== headerToken) {
        if (config.enableLogging) {
          log('CSRF protection failed: token mismatch', { method, path });
        }
        res.status(403).json({
          message: 'CSRF token mismatch',
          error: 'CSRF_TOKEN_INVALID'
        });
        return;
      }

      // Generate new token for next request
      const newToken = generateCSRFToken(config.tokenLength);
      res.cookie(config.cookieName!, newToken, config.cookieOptions);

      if (config.enableLogging) {
        log('CSRF protection passed', { method, path });
      }

      next();
    } catch (error) {
      log('CSRF middleware error', {
        error: error instanceof Error ? error.message : String(error),
        method: req.method,
        path: req.path
      });

      res.status(500).json({
        message: 'CSRF protection error',
        error: 'CSRF_ERROR'
      });
    }
  };
}

/**
 * Default CSRF middleware with standard configuration
 */
export const csrf = createCSRFMiddleware();

/**
 * Strict CSRF middleware for sensitive endpoints
 */
export const strictCSRF = createCSRFMiddleware({
  cookieOptions: {
    httpOnly: true, // Stricter: prevent JavaScript access
    secure: true,
    sameSite: 'strict',
    maxAge: 1800000, // 30 minutes
    path: '/'
  },
  enableLogging: true
});

/**
 * Middleware to get CSRF token for client-side use
 */
export function getCSRFTokenMiddleware(customConfig?: Partial<CSRFConfig>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const config = customConfig ?
        { ...getEnvironmentCSRFConfig(), ...customConfig } :
        getEnvironmentCSRFConfig();

      const token = req.cookies[config.cookieName!];
      if (token) {
        res.locals.csrfToken = token;
      }
      next();
    } catch (error) {
      log('CSRF token retrieval error', {
        error: error instanceof Error ? error.message : String(error)
      });
      next();
    }
  };
}

/**
 * Utility function to validate CSRF configuration
 */
export function validateCSRFConfig(config: CSRFConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate cookie name
  if (!config.cookieName || typeof config.cookieName !== 'string') {
    errors.push('cookieName must be a non-empty string');
  }

  // Validate header name
  if (!config.headerName || typeof config.headerName !== 'string') {
    errors.push('headerName must be a non-empty string');
  }

  // Validate token length
  if (config.tokenLength !== undefined && (typeof config.tokenLength !== 'number' || config.tokenLength < 16)) {
    errors.push('tokenLength must be a number >= 16');
  }

  // Validate cookie options
  if (config.cookieOptions?.maxAge !== undefined && (typeof config.cookieOptions.maxAge !== 'number' || config.cookieOptions.maxAge < 0)) {
    errors.push('cookieOptions.maxAge must be a non-negative number');
  }

  // Validate exclude patterns
  if (config.excludePatterns && !Array.isArray(config.excludePatterns)) {
    errors.push('excludePatterns must be an array of RegExp objects');
  } else if (config.excludePatterns) {
    config.excludePatterns.forEach((pattern, index) => {
      if (!(pattern instanceof RegExp)) {
        errors.push(`excludePatterns[${index}] must be a RegExp object`);
      }
    });
  }

  // Validate protected methods
  if (config.protectedMethods && !Array.isArray(config.protectedMethods)) {
    errors.push('protectedMethods must be an array of strings');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Export configuration types and utilities
 */
export { DEFAULT_CSRF_CONFIG, getEnvironmentCSRFConfig };
