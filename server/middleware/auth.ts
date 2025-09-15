import { Request, Response, NextFunction } from 'express';
import { validateAdminToken } from '../../lib/auth';
import { log } from '../../lib/log';
import { getEnvVar } from '../../lib/env-security';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: 'admin';
  };
}



/**
 * Authentication middleware that validates admin tokens
 * Prevents authentication bypass vulnerabilities
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    // Extract token from Authorization header with enhanced validation
    const authHeader = req.headers.authorization;
    
    // Check for missing authorization header
    if (!authHeader || typeof authHeader !== 'string') {
      log('Authentication failed: No authorization header provided', { 
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      res.status(401).json({ 
        message: 'Authentication required',
        error: 'MISSING_AUTH_HEADER'
      });
      return;
    }

    // Prevent header injection attacks
    if (authHeader.includes('\r') || authHeader.includes('\n') || authHeader.includes('\0')) {
      log('Authentication failed: Header injection attempt detected', { 
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      res.status(401).json({ 
        message: 'Invalid authorization header',
        error: 'HEADER_INJECTION_DETECTED'
      });
      return;
    }

    // Validate header length to prevent buffer overflow attempts
    if (authHeader.length > 1024) {
      log('Authentication failed: Authorization header too long', { 
        path: req.path,
        method: req.method,
        headerLength: authHeader.length,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      res.status(401).json({ 
        message: 'Authorization header too long',
        error: 'HEADER_TOO_LONG'
      });
      return;
    }

    // Validate header format - must be "Bearer <token>"
    const headerParts = authHeader.trim().split(' ');
    if (headerParts.length !== 2 || headerParts[0] !== 'Bearer') {
      log('Authentication failed: Invalid authorization header format', { 
        path: req.path,
        method: req.method,
        headerFormat: authHeader.substring(0, 20) + '...',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      res.status(401).json({ 
        message: 'Invalid authorization header format',
        error: 'INVALID_AUTH_FORMAT'
      });
      return;
    }

    const token = headerParts[1].trim();

    // Validate token format - prevent injection attacks
    if (!isValidTokenFormat(token)) {
      log('Authentication failed: Invalid token format detected', { 
        path: req.path,
        method: req.method,
        tokenLength: token.length,
        ip: req.ip 
      });
      res.status(401).json({ 
        message: 'Invalid token format',
        error: 'INVALID_TOKEN_FORMAT'
      });
      return;
    }

    // Validate the token
    const isValid = validateAdminToken(token);
    
    if (!isValid) {
      log('Authentication failed: Invalid token provided', { 
        path: req.path,
        method: req.method,
        tokenHash: hashToken(token),
        ip: req.ip 
      });
      res.status(401).json({ 
        message: 'Invalid authentication token',
        error: 'INVALID_TOKEN'
      });
      return;
    }

    // Set user context for authenticated requests with session tracking
    req.user = {
      id: 'admin-1',
      username: 'admin',
      role: 'admin'
    };

    // Add session security headers
    res.setHeader('X-Session-ID', generateSessionId());
    res.setHeader('X-Auth-Time', new Date().toISOString());

    log('Authentication successful', { 
      path: req.path,
      method: req.method,
      userId: req.user.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    next();
  } catch (error) {
    log('Authentication middleware error', { 
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
      ip: req.ip 
    });
    res.status(500).json({ 
      message: 'Authentication service error',
      error: 'AUTH_SERVICE_ERROR'
    });
  }
}

/**
 * Optional authentication middleware for endpoints that can work with or without auth
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      // No auth provided, continue without user context
      next();
      return;
    }

    // If auth is provided, validate it
    const headerParts = authHeader.split(' ');
    if (headerParts.length === 2 && headerParts[0] === 'Bearer') {
      const token = headerParts[1];
      
      if (isValidTokenFormat(token) && validateAdminToken(token)) {
        req.user = {
          id: 'admin-1',
          username: 'admin',
          role: 'admin'
        };
        log('Optional authentication successful', { 
          path: req.path,
          method: req.method,
          userId: req.user.id,
          ip: req.ip 
        });
      }
    }

    next();
  } catch (error) {
    // For optional auth, continue on error but log it
    log('Optional authentication error', { 
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
      ip: req.ip 
    });
    next();
  }
}

/**
 * Validates token format to prevent injection attacks and bypass attempts
 */
function isValidTokenFormat(token: string): boolean {
  // Validate token type and basic requirements
  if (typeof token !== 'string' || token.length === 0) {
    return false;
  }

  // Token length validation - prevent buffer overflow and DoS
  if (token.length < 1 || token.length > 256) {
    return false;
  }

  // Check for null bytes and control characters that could cause bypass
  // eslint-disable-next-line no-control-regex
  if (token.includes('\0') || /[\x00-\x1f\x7f-\x9f]/.test(token)) {
    return false;
  }

  // Check for line breaks that could cause header injection
  if (token.includes('\r') || token.includes('\n')) {
    return false;
  }

  // Check for whitespace that could cause parsing issues
  if (token.trim() !== token || /\s/.test(token)) {
    return false;
  }

  // Token should be alphanumeric with limited special characters
  // Allow only safe characters commonly used in tokens
  const validTokenRegex = /^[a-zA-Z0-9\-_.=+/]+$/;
  if (!validTokenRegex.test(token)) {
    return false;
  }

  // Check for suspicious patterns that could indicate attacks
  const suspiciousPatterns = [
    /['"]/,                    // Quotes (SQL injection, JSON injection)
    /[<>]/,                    // HTML brackets (XSS)
    /[{}]/,                    // Braces (JSON injection)
    /[[\]]/,                   // Square brackets (array injection)
    /[\\]/,                    // Backslashes (escape sequences)
    /[;]/,                     // Semicolons (command injection)
    /[|&]/,                    // Pipe and ampersand (command injection)
    /[()]/,                    // Parentheses (function calls)
    /[%]/,                     // Percent (URL encoding)
    /\$\{/,                    // Template literals
    /\.\./,                    // Path traversal
    /\/\*/,                    // Comment injection
    /--/,                      // SQL comment
    /#/,                       // Hash/fragment
    /\?/,                      // Query parameter
    /:/,                       // Colon (protocol separator)
    /@@/,                      // SQL variables
    /union\s+select/i,         // SQL injection
    /script/i,                 // Script injection
    /javascript/i,             // JavaScript injection
    /vbscript/i,               // VBScript injection
    /onload/i,                 // Event handler injection
    /onerror/i,                // Event handler injection
    /eval/i,                   // Code evaluation
    /exec/i,                   // Code execution
  ];

  // Check for suspicious patterns
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(token)) {
      return false;
    }
  }

  // Additional entropy check - token should have reasonable complexity
  const uniqueChars = new Set(token).size;
  if (token.length > 10 && uniqueChars < 3) {
    return false; // Too repetitive, likely not a real token
  }

  return true;
}

/**
 * Creates a hash of the token for logging (security)
 */
function hashToken(token: string): string {
  // Simple hash for logging purposes - don't log actual tokens
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Generates a secure session ID for tracking
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2);
  return `sess_${timestamp}_${randomPart}`;
}

/**
 * Rate limiting for authentication attempts
 */
const authAttempts = new Map<string, { count: number; lastAttempt: number; blocked: boolean }>();

function checkRateLimit(ip: string): boolean {
  // Skip rate limiting in test environments to avoid interference with security tests
  const nodeEnv = getEnvVar('NODE_ENV');
  const skipRateLimit = getEnvVar('SKIP_RATE_LIMIT');
  
  if (nodeEnv === 'test' || skipRateLimit) {
    return true;
  }

  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 1000; // Max 1000 attempts per window (increased for load testing)
  const blockDuration = 60 * 60 * 1000; // Block for 1 hour after max attempts

  const attempts = authAttempts.get(ip);
  
  if (!attempts) {
    authAttempts.set(ip, { count: 1, lastAttempt: now, blocked: false });
    return true;
  }

  // Check if currently blocked
  if (attempts.blocked && (now - attempts.lastAttempt) < blockDuration) {
    return false;
  }

  // Reset if window has passed
  if ((now - attempts.lastAttempt) > windowMs) {
    authAttempts.set(ip, { count: 1, lastAttempt: now, blocked: false });
    return true;
  }

  // Increment attempts
  attempts.count++;
  attempts.lastAttempt = now;

  // Block if too many attempts
  if (attempts.count > maxAttempts) {
    attempts.blocked = true;
    log('IP blocked due to too many authentication attempts', {
      ip,
      attempts: attempts.count,
      timestamp: new Date().toISOString()
    });
    return false;
  }

  return true;
}

/**
 * Enhanced authentication middleware with rate limiting and error handling
 */
export function rateLimitedAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    
    // Check rate limit first
    if (!checkRateLimit(clientIp)) {
      log('Authentication blocked: Rate limit exceeded', {
        ip: clientIp,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent')
      });
      res.status(429).json({
        message: 'Too many authentication attempts. Please try again later.',
        error: 'RATE_LIMIT_EXCEEDED'
      });
      return;
    }

    // Proceed with normal authentication
    requireAuth(req, res, next);
  } catch (error) {
    // Handle any unexpected errors in rate limiting
    log('Rate limited auth middleware error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
      ip: req.ip
    });
    
    // Fail securely - deny access on error
    res.status(500).json({
      message: 'Authentication service temporarily unavailable',
      error: 'AUTH_SERVICE_ERROR'
    });
  }
}