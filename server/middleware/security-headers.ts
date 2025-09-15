import { Request, Response, NextFunction } from 'express';
import { getEnvVar } from '../../lib/env-security';
import { log } from '../../lib/log';
import crypto from 'crypto';

/**
 * Security Headers Configuration Interface
 */
export interface SecurityHeadersConfig {
  // X-Content-Type-Options
  contentTypeOptions?: boolean;

  // X-Frame-Options
  frameOptions?: 'DENY' | 'SAMEORIGIN' | string;

  // Strict-Transport-Security
  hsts?: {
    enabled: boolean;
    maxAge?: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };

  // Content Security Policy
  csp?: {
    enabled: boolean;
    directives?: {
      defaultSrc?: string[];
      scriptSrc?: string[];
      styleSrc?: string[];
      imgSrc?: string[];
      fontSrc?: string[];
      connectSrc?: string[];
      frameAncestors?: string[];
      objectSrc?: string[];
      mediaSrc?: string[];
      childSrc?: string[];
      formAction?: string[];
      baseUri?: string[];
      upgradeInsecureRequests?: boolean;
    };
  };

  // Additional security headers
  xssProtection?: boolean;
  referrerPolicy?: string;
  permissionsPolicy?: string;

  // Environment-specific settings
  productionOnly?: string[];
  developmentOnly?: string[];
}

/**
 * Default security headers configuration
 */
const DEFAULT_CONFIG: SecurityHeadersConfig = {
  contentTypeOptions: true,
  frameOptions: 'DENY',
  hsts: {
    enabled: true,
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  csp: {
    enabled: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // Removed 'unsafe-inline' and 'unsafe-eval' for security
      styleSrc: ["'self'"], // Removed 'unsafe-inline' for security
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      childSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: true
    }
  },
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=()',
  productionOnly: ['Strict-Transport-Security'],
  developmentOnly: []
};

/**
 * Environment-specific configuration
 */
function getEnvironmentConfig(): SecurityHeadersConfig {
  const nodeEnv = getEnvVar('NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';

  // Load custom configuration from environment if available
  const customConfig = getEnvVar('SECURITY_HEADERS_CONFIG');
  let envConfig: Partial<SecurityHeadersConfig> = {};

  if (customConfig) {
    try {
      envConfig = JSON.parse(customConfig);
      log('Loaded custom security headers configuration from environment');
    } catch (error) {
      log('Failed to parse SECURITY_HEADERS_CONFIG environment variable', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Merge with defaults
  const config: SecurityHeadersConfig = {
    ...DEFAULT_CONFIG,
    ...envConfig,
    hsts: {
      ...DEFAULT_CONFIG.hsts,
      ...envConfig.hsts,
      enabled: isProduction && (envConfig.hsts?.enabled !== false)
    },
    csp: {
      enabled: envConfig.csp?.enabled ?? DEFAULT_CONFIG.csp?.enabled ?? true,
      directives: {
        ...DEFAULT_CONFIG.csp?.directives,
        ...envConfig.csp?.directives
      }
    }
  };

  return config;
}

/**
 * Generate a CSP nonce
 */
function generateCSPNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Build Content Security Policy header value
 */
function buildCSPHeader(csp: SecurityHeadersConfig['csp'], nonce?: string): string {
  if (!csp || !csp.directives) return '';

  const cspParts: string[] = [];
  const directives = csp.directives;
  const nodeEnv = getEnvVar('NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';

  // Map directive names to CSP names
  const directiveMap: Record<string, string> = {
    defaultSrc: 'default-src',
    scriptSrc: 'script-src',
    styleSrc: 'style-src',
    imgSrc: 'img-src',
    fontSrc: 'font-src',
    connectSrc: 'connect-src',
    frameAncestors: 'frame-ancestors',
    objectSrc: 'object-src',
    mediaSrc: 'media-src',
    childSrc: 'child-src',
    formAction: 'form-action',
    baseUri: 'base-uri'
  };

  // Build directive strings
  Object.entries(directiveMap).forEach(([key, cspName]) => {
    const values = directives[key as keyof typeof directives];
    if (Array.isArray(values) && values.length > 0) {
      let directiveValues = [...values];

      // In production, use nonces instead of unsafe-inline for script and style
      if (isProduction && nonce) {
        if (key === 'scriptSrc') {
          directiveValues = directiveValues.filter(v => v !== "'unsafe-inline'" && v !== "'unsafe-eval'");
          directiveValues.push(`'nonce-${nonce}'`);
        } else if (key === 'styleSrc') {
          directiveValues = directiveValues.filter(v => v !== "'unsafe-inline'");
          directiveValues.push(`'nonce-${nonce}'`);
        }
      }

      cspParts.push(`${cspName} ${directiveValues.join(' ')}`);
    }
  });

  // Add upgrade-insecure-requests if enabled
  if (directives.upgradeInsecureRequests) {
    cspParts.push('upgrade-insecure-requests');
  }

  return cspParts.join('; ');
}

/**
 * Security headers middleware factory
 */
export function createSecurityHeadersMiddleware(customConfig?: Partial<SecurityHeadersConfig>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const config = customConfig ?
        { ...getEnvironmentConfig(), ...customConfig } :
        getEnvironmentConfig();

      const nodeEnv = getEnvVar('NODE_ENV') || 'development';
      const isProduction = nodeEnv === 'production';

      // Generate CSP nonce for production (makes it available to templates/client)
      const cspNonce = isProduction ? generateCSPNonce() : undefined;
      if (cspNonce) {
        // Make nonce available to response locals for use in templates
        res.locals.cspNonce = cspNonce;
      }

      // X-Content-Type-Options: nosniff
      if (config.contentTypeOptions) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }

      // X-Frame-Options
      if (config.frameOptions) {
        res.setHeader('X-Frame-Options', config.frameOptions);
      }

      // Strict-Transport-Security (HSTS) - production only by default
      if (config.hsts?.enabled && (isProduction || !config.productionOnly?.includes('Strict-Transport-Security'))) {
        let hstsValue = `max-age=${config.hsts.maxAge || 31536000}`;
        if (config.hsts.includeSubDomains) {
          hstsValue += '; includeSubDomains';
        }
        if (config.hsts.preload) {
          hstsValue += '; preload';
        }
        res.setHeader('Strict-Transport-Security', hstsValue);
      }

      // Content Security Policy
      if (config.csp?.enabled && config.csp.directives) {
        const cspHeader = buildCSPHeader(config.csp, cspNonce);
        if (cspHeader) {
          res.setHeader('Content-Security-Policy', cspHeader);
        }
      }

      // X-XSS-Protection (legacy but still useful for older browsers)
      if (config.xssProtection) {
        res.setHeader('X-XSS-Protection', '1; mode=block');
      }

      // Referrer-Policy
      if (config.referrerPolicy) {
        res.setHeader('Referrer-Policy', config.referrerPolicy);
      }

      // Permissions-Policy (formerly Feature-Policy)
      if (config.permissionsPolicy) {
        res.setHeader('Permissions-Policy', config.permissionsPolicy);
      }

      // Remove server information headers
      res.removeHeader('X-Powered-By');
      res.removeHeader('Server');

      // Cache control for sensitive API endpoints
      if (req.path.includes('/api/') && req.path !== '/api/health') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      // Log security headers application in development
      if (nodeEnv === 'development') {
        log('Security headers applied', {
          path: req.path,
          method: req.method,
          headers: {
            'X-Content-Type-Options': res.getHeader('X-Content-Type-Options'),
            'X-Frame-Options': res.getHeader('X-Frame-Options'),
            'Strict-Transport-Security': res.getHeader('Strict-Transport-Security'),
            'Content-Security-Policy': res.getHeader('Content-Security-Policy') ? 'set' : 'not set',
            'X-XSS-Protection': res.getHeader('X-XSS-Protection'),
            'Referrer-Policy': res.getHeader('Referrer-Policy'),
            'Permissions-Policy': res.getHeader('Permissions-Policy')
          }
        });
      }

      next();
    } catch (error) {
      log('Security headers middleware error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method
      });

      // Apply minimal security headers on error
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.removeHeader('X-Powered-By');

      next();
    }
  };
}

/**
 * Default security headers middleware with standard configuration
 */
export const securityHeaders = createSecurityHeadersMiddleware();

/**
 * Strict security headers middleware for sensitive endpoints
 */
export const strictSecurityHeaders = createSecurityHeadersMiddleware({
  frameOptions: 'DENY',
  csp: {
    enabled: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      childSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: true
    }
  },
  referrerPolicy: 'no-referrer',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()'
});

/**
 * Utility function to validate security headers configuration
 */
export function validateSecurityConfig(config: SecurityHeadersConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate frame options
  if (config.frameOptions && !['DENY', 'SAMEORIGIN'].includes(config.frameOptions) && !config.frameOptions.startsWith('ALLOW-FROM ')) {
    errors.push('Invalid frameOptions value. Must be DENY, SAMEORIGIN, or ALLOW-FROM uri');
  }

  // Validate HSTS max-age
  if (config.hsts?.enabled && config.hsts.maxAge !== undefined) {
    if (typeof config.hsts.maxAge !== 'number' || config.hsts.maxAge < 0) {
      errors.push('HSTS maxAge must be a non-negative number');
    }
  }

  // Validate CSP directives
  if (config.csp?.enabled && config.csp.directives) {
    const validDirectives = [
      'defaultSrc', 'scriptSrc', 'styleSrc', 'imgSrc', 'fontSrc', 'connectSrc',
      'frameAncestors', 'objectSrc', 'mediaSrc', 'childSrc', 'formAction', 'baseUri'
    ];

    Object.keys(config.csp.directives).forEach(directive => {
      if (!validDirectives.includes(directive) && directive !== 'upgradeInsecureRequests') {
        errors.push(`Unknown CSP directive: ${directive}`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Export configuration types and utilities
 */
export { DEFAULT_CONFIG, getEnvironmentConfig };