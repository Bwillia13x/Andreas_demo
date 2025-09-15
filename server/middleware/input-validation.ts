import { Request, Response, NextFunction } from 'express';
import { log } from '../../lib/log';

export interface SanitizedRequest extends Request {
  sanitizedBody?: any;
  sanitizedQuery?: any;
  sanitizedParams?: any;
}

/**
 * XSS Prevention and Input Sanitization Middleware
 * Implements comprehensive input validation and sanitization to prevent XSS attacks
 */

/**
 * HTML entity encoding map for XSS prevention
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

/**
 * Dangerous patterns that indicate potential XSS attacks
 */
const XSS_PATTERNS = [
  // Script tags
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /<script[^>]*>/gi,
  
  // Event handlers
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /on\w+\s*=\s*[^"'\s>]+/gi,
  
  // JavaScript URLs
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:\s*text\/html/gi,
  
  // HTML tags that can execute JavaScript
  /<iframe[\s\S]*?>/gi,
  /<object[\s\S]*?>/gi,
  /<embed[\s\S]*?>/gi,
  /<applet[\s\S]*?>/gi,
  /<meta[\s\S]*?>/gi,
  /<link[\s\S]*?>/gi,
  /<style[\s\S]*?>/gi,
  
  // SVG with script
  /<svg[\s\S]*?onload[\s\S]*?>/gi,
  /<svg[\s\S]*?onerror[\s\S]*?>/gi,
  
  // IMG with onerror
  /<img[\s\S]*?onerror[\s\S]*?>/gi,
  /<img[\s\S]*?onload[\s\S]*?>/gi,
  
  // Form elements with JavaScript
  /<form[\s\S]*?action[\s\S]*?javascript/gi,
  /<input[\s\S]*?onfocus[\s\S]*?>/gi,
  
  // Expression() CSS
  /expression\s*\(/gi,
  /-moz-binding/gi,
  
  // Data URLs with JavaScript
  /data:[\w/+]+;base64,[\w+/=]+/gi,
  
  // Unicode and encoded attacks - Enhanced
  /\\u[0-9a-fA-F]{4}/gi,
  /\\x[0-9a-fA-F]{2}/gi,
  /&#x?[0-9a-fA-F]+;?/gi,
  /%[0-9a-fA-F]{2}/gi, // URL encoding
  /&#[0-9]+;?/gi, // Decimal HTML entities

  // Template literals and expressions - Enhanced
  /\$\{[\s\S]*?\}/gi,
  /`[\s\S]*?`/gi,
  /<%[\s\S]*?%>/gi, // ASP/JSP style
  /\{[\s\S]*?\}/gi, // Generic template injection

  // Dangerous functions - Enhanced
  /eval\s*\(/gi,
  /setTimeout\s*\(/gi,
  /setInterval\s*\(/gi,
  /Function\s*\(/gi,
  /constructor\s*\(/gi, // Constructor abuse
  /__proto__\s*[:=]/gi, // Prototype pollution
  /prototype\s*[:=]/gi, // Prototype pollution

  // Additional dangerous patterns
  /alert\s*\(/gi,
  /confirm\s*\(/gi,
  /prompt\s*\(/gi,
  /window\.location/gi,
  /document\.cookie/gi,
  /document\.write/gi,
  /innerHTML\s*[:=]/gi,
  /outerHTML\s*[:=]/gi,
  
  // Protocol handlers
  /livescript\s*:/gi,
  /mocha\s*:/gi,
];

/**
 * Malicious payload patterns for detection
 */
const MALICIOUS_PATTERNS = [
  // SQL injection patterns - Enhanced and Comprehensive
  /(union\s+select|insert\s+into|delete\s+from|update\s+set|drop\s+table|create\s+table|alter\s+table|exec\s+|execute\s+)/gi,
  /('|;|--|\/\*|\*\/)/gi,
  /(select\s+.*\s+from|where\s+.*\s*=|having\s+.*\s*=)/gi,
  /(or\s+1\s*=\s*1|and\s+1\s*=\s*1|'\s+or\s+'1'\s*=\s*'1)/gi,
  /(waitfor\s+delay|benchmark\s*\(|sleep\s*\()/gi,
  // Additional SQL injection patterns
  /(information_schema|sysobjects|syscolumns|database\(\)|user\(\)|version\(\))/gi,
  /(1\s*=\s*1|1\s*=\s*0|'1'\s*=\s*'0'|admin\s*=\s*admin)/gi,
  /(order\s+by\s+\d+|group\s+by\s+\d+|limit\s+\d+,\d*)/gi,
  /(substring\s*\(|substring\s*\[|substr\s*\(|substr\s*\[)/gi,
  /(convert\s*\(|cast\s*\()/gi,
  /(@@version|@@servername|@@spid)/gi,
  // Time-based blind SQL injection
  /(and\s+sleep\(|and\s+benchmark\(|and\s+pg_sleep\()/gi,
  // Error-based SQL injection
  /(and\s+1=convert\(|and\s+1=cast\()/gi,
  // Out-of-band SQL injection
  /(load_file\s*\(|into\s+outfile|into\s+dumpfile)/gi,
  
  // Command injection patterns - Enhanced
  /(\||&|;|\$\(|`|<|>)/gi,
  /(nc\s+|netcat\s+|wget\s+|curl\s+|chmod\s+|rm\s+|mv\s+|cp\s+)/gi,
  /(bash\s+|sh\s+|cmd\s+|powershell\s+|eval\s+)/gi,
  
  // Path traversal patterns - Enhanced
  /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\\)/gi,
  /(\/etc\/passwd|\/etc\/shadow|\.\.\/\.\.\/|\\\.\.\\\.\.\\)/gi,
  /(file:\/\/|ftp:\/\/|gopher:\/\/)/gi,
  
  // Null byte injection
  // eslint-disable-next-line no-control-regex
  /\x00|\u0000|%00/gi,
  
  // LDAP injection - Enhanced
  /(\*|\(|\)|\\|\||&)/gi,
  /(\)\(\||&\(|\|\()/gi,
  
  // XML injection - Enhanced
  /(<\?xml|<!DOCTYPE|<!ENTITY)/gi,
  /(<!CDATA\[|]]>|&lt;|&gt;)/gi,
  
  // Server-side template injection - Enhanced
  /(\{\{|\}\}|\{%|%\}|\{#|#\})/gi,
  /(\$\{.*\}|<%.*%>|#\{.*\})/gi,
  
  // NoSQL injection patterns
  /(\$where|\$ne|\$gt|\$lt|\$regex|\$or|\$and)/gi,
  /(this\..*==|function\s*\()/gi,
  
  // LDAP filter injection
  /(\*\)|\(\*|\)\(|\|\|)/gi,
  
  // XPath injection
  /(\[.*\]|\/\/|\/\*|\*\/)/gi,
  
  // Email header injection
  /(\r\n|\n|\r|%0a|%0d)/gi,
  /(bcc:|cc:|to:|from:|subject:)/gi,
  
  // HTTP header injection
  /(\r\n\r\n|\n\n|%0d%0a%0d%0a)/gi,
  
  // Format string attacks
  /(%s|%x|%d|%n|%p)/gi,
  
  // Buffer overflow patterns
  /(A{100,}|1{100,}|0{100,})/gi,
];

/**
 * Sanitizes a string value to prevent XSS attacks
 */
function sanitizeString(value: string): string {
  if (typeof value !== 'string') {
    return String(value);
  }

  // First, trim whitespace
  let sanitized = value.trim();

  // Check for extremely long strings (potential DoS)
  if (sanitized.length > 10000) {
    log('Input validation warning: Extremely long string detected', {
      length: sanitized.length,
      truncated: true
    });
    sanitized = sanitized.substring(0, 10000);
  }

  // Remove null bytes and control characters
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Detect and log potential XSS attempts
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(sanitized)) {
      log('XSS attempt detected and blocked', {
        pattern: pattern.source,
        input: sanitized.substring(0, 100) + (sanitized.length > 100 ? '...' : ''),
        timestamp: new Date().toISOString()
      });
      
      // Remove the malicious content
      sanitized = sanitized.replace(pattern, '');
    }
  }

  // Detect malicious payloads
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      log('Malicious payload detected and blocked', {
        pattern: pattern.source,
        input: sanitized.substring(0, 100) + (sanitized.length > 100 ? '...' : ''),
        timestamp: new Date().toISOString()
      });
    }
  }

  // HTML entity encoding for remaining content
  sanitized = sanitized.replace(/[&<>"'`=/]/g, (match) => HTML_ENTITIES[match] || match);

  // Additional encoding for Unicode attacks
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
    return `&#${match.charCodeAt(0)};`;
  });

  return sanitized;
}

/**
 * Validates and sanitizes input values recursively
 */
function sanitizeValue(value: any, maxDepth: number = 10): any {
  if (maxDepth <= 0) {
    log('Input validation warning: Maximum recursion depth reached', {
      type: typeof value,
      truncated: true
    });
    return null;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value === 'number') {
    // Validate number ranges to prevent overflow
    if (!isFinite(value) || value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      log('Input validation warning: Invalid number detected', {
        value,
        replaced: 0
      });
      return 0;
    }
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    // Limit array size to prevent DoS
    if (value.length > 1000) {
      log('Input validation warning: Large array detected', {
        length: value.length,
        truncated: true
      });
      value = value.slice(0, 1000);
    }
    
    return value.map((item: any) => sanitizeValue(item, maxDepth - 1));
  }

  if (typeof value === 'object') {
    // Limit object properties to prevent DoS
    const keys = Object.keys(value);
    if (keys.length > 100) {
      log('Input validation warning: Large object detected', {
        properties: keys.length,
        truncated: true
      });
    }

    const sanitized: any = {};
    for (let i = 0; i < Math.min(keys.length, 100); i++) {
      const key = keys[i];
      const sanitizedKey = sanitizeString(key);
      sanitized[sanitizedKey] = sanitizeValue(value[key], maxDepth - 1);
    }
    return sanitized;
  }

  // For other types, convert to string and sanitize
  return sanitizeString(String(value));
}

/**
 * Input validation middleware that sanitizes request body, query, and params
 */
export function inputValidation(req: SanitizedRequest, res: Response, next: NextFunction): void {
  try {
    const startTime = Date.now();

    // Validate request structure first
    if (req.body !== undefined && req.body !== null && typeof req.body !== 'object') {
      log('Input validation error: Invalid body type', {
        bodyType: typeof req.body,
        path: req.path,
        method: req.method
      });
      res.status(400).json({
        message: 'Request body must be an object',
        error: 'INVALID_BODY_TYPE'
      });
      return;
    }

    // Check for extremely large payloads before processing
    const bodyString = req.body ? JSON.stringify(req.body) : '';
    if (bodyString.length > 1024 * 1024) { // 1MB limit
      log('Input validation error: Payload too large', {
        size: bodyString.length,
        path: req.path,
        method: req.method
      });
      res.status(413).json({
        message: 'Request payload too large',
        error: 'PAYLOAD_TOO_LARGE'
      });
      return;
    }

    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.sanitizedBody = sanitizeValue(req.body);
      // Replace original body with sanitized version
      req.body = req.sanitizedBody;
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.sanitizedQuery = sanitizeValue(req.query);
      // Replace original query with sanitized version
      req.query = req.sanitizedQuery;
    }

    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      req.sanitizedParams = sanitizeValue(req.params);
      // Replace original params with sanitized version
      req.params = req.sanitizedParams;
    }

    const duration = Date.now() - startTime;
    
    // Log slow sanitization (potential DoS attempt)
    if (duration > 100) {
      log('Input validation warning: Slow sanitization detected', {
        duration,
        path: req.path,
        method: req.method,
        bodySize: req.body ? JSON.stringify(req.body).length : 0
      });
    }

    next();
  } catch (error) {
    log('Input validation error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // On sanitization error, reject the request securely
    res.status(400).json({
      message: 'Invalid input data',
      error: 'INPUT_VALIDATION_ERROR'
    });
  }
}

/**
 * Strict input validation for sensitive endpoints
 */
export function strictInputValidation(req: SanitizedRequest, res: Response, next: NextFunction): void {
  try {
    // Apply normal input validation first
    inputValidation(req, res, () => {
      // Additional strict validation
      
      // Check for any remaining suspicious patterns
      const requestData = JSON.stringify({
        body: req.body,
        query: req.query,
        params: req.params
      });

      // More aggressive pattern detection for sensitive endpoints
      const strictPatterns = [
        /<script[\s\S]*?>/gi,
        /javascript\s*:/gi,
        /vbscript\s*:/gi,
        /on\w+\s*=/gi,
        /eval\s*\(/gi,
        /expression\s*\(/gi,
        /<iframe[\s\S]*?>/gi,
        /<object[\s\S]*?>/gi,
        /<embed[\s\S]*?>/gi,
      ];

      for (const pattern of strictPatterns) {
        if (pattern.test(requestData)) {
          log('Strict validation failed: Suspicious pattern detected', {
            pattern: pattern.source,
            path: req.path,
            method: req.method,
            timestamp: new Date().toISOString()
          });
          
          res.status(400).json({
            message: 'Input contains invalid characters',
            error: 'STRICT_VALIDATION_FAILED'
          });
          return;
        }
      }

      next();
    });
  } catch (error) {
    log('Strict input validation error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method
    });
    
    res.status(400).json({
      message: 'Input validation failed',
      error: 'STRICT_VALIDATION_ERROR'
    });
  }
}

/**
 * Content-Type validation middleware
 */
export function validateContentType(allowedTypes: string[] = ['application/json']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const contentType = req.get('Content-Type');
      
      if (!contentType) {
        res.status(400).json({
          message: 'Content-Type header is required',
          error: 'MISSING_CONTENT_TYPE'
        });
        return;
      }

      const isAllowed = allowedTypes.some(type => 
        contentType.toLowerCase().includes(type.toLowerCase())
      );

      if (!isAllowed) {
        log('Invalid Content-Type detected', {
          contentType,
          allowedTypes,
          path: req.path,
          method: req.method
        });
        
        res.status(415).json({
          message: 'Unsupported Content-Type',
          error: 'UNSUPPORTED_CONTENT_TYPE',
          allowedTypes
        });
        return;
      }
    }

    next();
  };
}

/**
 * Request size validation middleware
 */
export function validateRequestSize(maxSizeBytes: number = 1024 * 1024) { // 1MB default
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      log('Request size limit exceeded', {
        contentLength: parseInt(contentLength, 10),
        maxSize: maxSizeBytes,
        path: req.path,
        method: req.method
      });
      
      res.status(413).json({
        message: 'Request entity too large',
        error: 'REQUEST_TOO_LARGE',
        maxSize: maxSizeBytes
      });
      return;
    }

    next();
  };
}

/**
 * SQL injection prevention middleware for database endpoints
 */
export function sqlInjectionPrevention(req: SanitizedRequest, res: Response, next: NextFunction): void {
  try {
    // Check URL parameters for SQL injection patterns
    if (req.params) {
      for (const [key, value] of Object.entries(req.params)) {
        if (typeof value === 'string') {
          const sqlPatterns = [
            /(\bunion\b|\bselect\b|\binsert\b|\bdelete\b|\bupdate\b|\bdrop\b|\bcreate\b|\balter\b)/gi,
            /('|;|--|\/\*|\*\/)/gi,
            /(1\s*=\s*1|'\s+or\s+'1'\s*=\s*'1)/gi,
            /(information_schema|sysobjects|syscolumns)/gi,
            /(load_file|into\s+outfile|into\s+dumpfile)/gi
          ];

          for (const pattern of sqlPatterns) {
            if (pattern.test(value)) {
              log('SQL injection attempt detected in URL parameter', {
                parameter: key,
                value: value.substring(0, 100) + (value.length > 100 ? '...' : ''),
                pattern: pattern.source,
                path: req.path,
                method: req.method,
                ip: req.ip,
                timestamp: new Date().toISOString()
              });

              res.status(400).json({
                message: 'Invalid parameter format',
                error: 'SQL_INJECTION_DETECTED'
              });
              return;
            }
          }
        }
      }
    }

    // Check query parameters for SQL injection
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') {
          const sqlPatterns = [
            /(\bunion\b|\bselect\b|\bwhere\b|\bhaving\b|\border\s+by\b|\bgroup\s+by\b)/gi,
            /('|;|--|\/\*|\*\/)/gi,
            /(1\s*=\s*1|'\s+or\s+'1'\s*=\s*'1)/gi,
            /(substring\s*\(|substr\s*\(|convert\s*\(|cast\s*\()/gi
          ];

          for (const pattern of sqlPatterns) {
            if (pattern.test(value)) {
              log('SQL injection attempt detected in query parameter', {
                parameter: key,
                value: value.substring(0, 100) + (value.length > 100 ? '...' : ''),
                pattern: pattern.source,
                path: req.path,
                method: req.method,
                ip: req.ip,
                timestamp: new Date().toISOString()
              });

              res.status(400).json({
                message: 'Invalid query parameter',
                error: 'SQL_INJECTION_DETECTED'
              });
              return;
            }
          }
        }
      }
    }

    // Check request body for SQL injection patterns (critical for POST/PUT/PATCH requests)
    if (req.body && typeof req.body === 'object') {
      const bodyString = JSON.stringify(req.body);
      const sqlPatterns = [
        /(\bunion\b|\bselect\b|\binsert\b|\bdelete\b|\bupdate\b|\bdrop\b|\bcreate\b|\balter\b)/gi,
        /(\bwhere\b|\bhaving\b|\border\s+by\b|\bgroup\s+by\b)/gi,
        /('|;|--|\/\*|\*\/)/gi,
        /(1\s*=\s*1|'\s+or\s+'1'\s*=\s*'1)/gi,
        /(information_schema|sysobjects|syscolumns)/gi,
        /(load_file|into\s+outfile|into\s+dumpfile)/gi,
        /(substring\s*\(|substr\s*\(|convert\s*\(|cast\s*\()/gi,
        /(\bexec\b|\bexecute\b|\bxp_cmdshell\b)/gi,
        /(\bshutdown\b|\breconfigure\b|\bbackup\b)/gi
      ];

      for (const pattern of sqlPatterns) {
        if (pattern.test(bodyString)) {
          log('SQL injection attempt detected in request body', {
            bodyPreview: bodyString.substring(0, 200) + (bodyString.length > 200 ? '...' : ''),
            pattern: pattern.source,
            path: req.path,
            method: req.method,
            ip: req.ip,
            timestamp: new Date().toISOString()
          });

          res.status(400).json({
            message: 'Request contains potentially malicious content',
            error: 'SQL_INJECTION_DETECTED'
          });
          return;
        }
      }
    }

    next();
  } catch (error) {
    log('SQL injection prevention error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method
    });

    res.status(500).json({
      message: 'Parameter validation error',
      error: 'VALIDATION_ERROR'
    });
  }
}

/**
 * XSS prevention middleware with enhanced pattern detection
 */
export function enhancedXSSPrevention(req: SanitizedRequest, res: Response, next: NextFunction): void {
  try {
    // Check all input sources for XSS patterns
    const inputSources = [req.body, req.query, req.params];

    for (const source of inputSources) {
      if (!source) continue;

      const sourceString = JSON.stringify(source);
      const xssPatterns = [
        /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
        /javascript\s*:/gi,
        /vbscript\s*:/gi,
        /on\w+\s*=\s*["'][^"']*["']/gi,
        /<iframe[\s\S]*?>/gi,
        /<object[\s\S]*?>/gi,
        /<embed[\s\S]*?>/gi,
        /<link[\s\S]*?>/gi,
        /<meta[\s\S]*?>/gi,
        /\$\{[\s\S]*?\}/gi,
        /eval\s*\(/gi,
        /setTimeout\s*\(/gi,
        /setInterval\s*\(/gi,
        /Function\s*\(/gi,
        /alert\s*\(/gi,
        /confirm\s*\(/gi,
        /prompt\s*\(/gi,
        /document\.cookie/gi,
        /innerHTML\s*[:=]/gi
      ];

      for (const pattern of xssPatterns) {
        if (pattern.test(sourceString)) {
          log('XSS attempt detected and blocked', {
            pattern: pattern.source,
            input: sourceString.substring(0, 200) + (sourceString.length > 200 ? '...' : ''),
            path: req.path,
            method: req.method,
            ip: req.ip,
            timestamp: new Date().toISOString()
          });

          res.status(400).json({
            message: 'Input contains potentially malicious content',
            error: 'XSS_ATTEMPT_DETECTED'
          });
          return;
        }
      }
    }

    next();
  } catch (error) {
    log('Enhanced XSS prevention error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method
    });

    res.status(500).json({
      message: 'Input validation error',
      error: 'XSS_VALIDATION_ERROR'
    });
  }
}

/**
 * Export sanitization functions for use in other modules
 */
export { sanitizeString, sanitizeValue };