import { getEnvVar } from './env-security';

// PII fields that should be redacted from logs
const PII_FIELDS = [
  'password', 'token', 'secret', 'key', 'authorization', 'bearer',
  'email', 'phone', 'ssn', 'credit_card', 'cvv', 'social_security',
  'api_key', 'access_token', 'refresh_token', 'session_id',
  'ip_address', 'user_agent', 'personal_info', 'sensitive_data'
];

interface LogContext {
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  requestId?: string
  context?: LogContext
}

// Store current request ID in async local storage or similar
let currentRequestId: string | undefined;

/**
 * Set the current request ID for this context
 */
export function setRequestId(requestId: string): void {
  currentRequestId = requestId;
}

/**
 * Get the current request ID
 */
export function getRequestId(): string | undefined {
  return currentRequestId;
}

/**
 * Redact PII from log context
 */
function redactPII(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactPII(item));
  }

  const redacted = { ...obj };

  // Redact known PII fields
  for (const field of PII_FIELDS) {
    if (redacted[field] !== undefined) {
      redacted[field] = '[REDACTED]';
    }
  }

  // Also redact any field containing sensitive keywords
  for (const key in redacted) {
    if (PII_FIELDS.some(pii => key.toLowerCase().includes(pii))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactPII(redacted[key]);
    }
  }

  return redacted;
}

export function log(message: string, context?: LogContext): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    message,
    requestId: currentRequestId,
    context: context ? redactPII(context) : undefined
  }

  // In development, also log to console
  if (getEnvVar('NODE_ENV') === 'development') {
    const logPrefix = entry.requestId ? `[${entry.timestamp}] [${entry.requestId}]` : `[${entry.timestamp}]`;
    console.log(`${logPrefix} ${entry.message}`, entry.context ? entry.context : '');
  }

  // In production, you might want to send to a logging service
  // For now, we'll just use console.log with structured format
  console.log(JSON.stringify(entry))
}

export function logError(message: string, error: Error, context?: LogContext): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    message,
    requestId: currentRequestId,
    context: {
      ...redactPII(context || {}),
      error: error.message,
      stack: error.stack
    }
  }

  console.error(JSON.stringify(entry))
}

export function logWarn(message: string, context?: LogContext): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    message,
    requestId: currentRequestId,
    context: context ? redactPII(context) : undefined
  }

  console.warn(JSON.stringify(entry))
}

/**
 * Clear the current request ID (call at end of request)
 */
export function clearRequestId(): void {
  currentRequestId = undefined;
}
