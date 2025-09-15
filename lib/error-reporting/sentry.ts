/**
 * Sentry Error Reporting Configuration
 * Provides comprehensive error tracking and monitoring
 */

import crypto from 'crypto';
import { getEnvVar, getEnvVarString } from '../env-security';
import { log } from '../log';

// Mock Sentry implementation - in production you'd use @sentry/node and @sentry/react
interface SentryConfig {
  dsn: string;
  environment: string;
  release?: string;
  sampleRate: number;
  enableTracing: boolean;
  tracesSampleRate: number;
  beforeSend?: (event: any) => any;
}

interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  logger: string;
  message: string;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace: {
        frames: Array<{
          filename: string;
          function: string;
          lineno: number;
          colno: number;
        }>;
      };
    }>;
  };
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    data?: any;
  };
  user?: {
    id?: string;
    email?: string;
    ip_address?: string;
  };
  tags?: Record<string, string>;
  extra?: Record<string, any>;
}

/**
 * In-memory event store (in production, events are sent to Sentry)
 */
class SentryEventStore {
  private events: SentryEvent[] = [];
  private maxEvents = 100;

  addEvent(event: SentryEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift(); // Remove oldest event
    }
  }

  getEvents(): SentryEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }

  getEventsByLevel(level: string): SentryEvent[] {
    return this.events.filter(event => event.level === level);
  }
}

const eventStore = new SentryEventStore();

/**
 * Initialize Sentry
 */
export function initSentry(): void {
  const dsn = getEnvVarString('SENTRY_DSN');
  const environment = getEnvVarString('NODE_ENV') || 'development';
  const enableSentry = !!dsn && getEnvVarString('ENABLE_SENTRY') !== 'false';

  if (!enableSentry) {
    log('Sentry disabled (set SENTRY_DSN and ENABLE_SENTRY=true to enable)');
    return;
  }

  const config: SentryConfig = {
    dsn,
    environment,
    sampleRate: parseFloat(getEnvVarString('SENTRY_SAMPLE_RATE') || '1.0'),
    enableTracing: getEnvVarString('SENTRY_ENABLE_TRACING') === 'true',
    tracesSampleRate: parseFloat(getEnvVarString('SENTRY_TRACES_SAMPLE_RATE') || '0.1'),
    beforeSend: (event) => {
      // Redact sensitive data
      if (event.request?.headers) {
        const headers = { ...event.request.headers };
        ['authorization', 'cookie', 'x-api-key'].forEach(header => {
          if (headers[header]) {
            headers[header] = '[REDACTED]';
          }
        });
        event.request.headers = headers;
      }
      return event;
    }
  };

  log('Sentry initialized', {
    environment: config.environment,
    sampleRate: config.sampleRate,
    enableTracing: config.enableTracing
  });
}

/**
 * Capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>): void {
  const dsn = getEnvVarString('SENTRY_DSN');
  if (!dsn) return;

  const event: SentryEvent = {
    event_id: generateEventId(),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    logger: 'exception',
    message: error.message,
    exception: {
      values: [{
        type: error.name,
        value: error.message,
        stacktrace: {
          frames: parseStackTrace(error.stack)
        }
      }]
    },
    extra: context,
    tags: {
      environment: getEnvVar('NODE_ENV') || 'development'
    }
  };

  eventStore.addEvent(event);

  log('Exception captured by Sentry', {
    eventId: event.event_id,
    error: error.message,
    context
  });
}

/**
 * Capture a message
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: Record<string, any>
): void {
  const dsn = getEnvVarString('SENTRY_DSN');
  if (!dsn) return;

  const event: SentryEvent = {
    event_id: generateEventId(),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level,
    logger: 'message',
    message,
    extra: context,
    tags: {
      environment: getEnvVar('NODE_ENV') || 'development'
    }
  };

  eventStore.addEvent(event);

  log(`Message captured by Sentry [${level}]`, {
    eventId: event.event_id,
    message,
    context
  });
}

/**
 * Set user context
 */
export function setUser(user: { id?: string; email?: string; ip_address?: string }): void {
  // In a real implementation, this would set context for the current scope
  log('Sentry user context set', { userId: user.id, hasEmail: !!user.email });
}

/**
 * Set extra context
 */
export function setExtra(key: string, value: any): void {
  // In a real implementation, this would set extra context for the current scope
  log('Sentry extra context set', { key, value: typeof value });
}

/**
 * Set tag
 */
export function setTag(key: string, value: string): void {
  // In a real implementation, this would set a tag for the current scope
  log('Sentry tag set', { key, value });
}

/**
 * Add breadcrumb
 */
export function addBreadcrumb(breadcrumb: {
  message: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  category?: string;
  data?: Record<string, any>;
}): void {
  log('Sentry breadcrumb added', {
    message: breadcrumb.message,
    level: breadcrumb.level,
    category: breadcrumb.category
  });
}

/**
 * Flush pending events
 */
export async function flush(timeout: number = 2000): Promise<boolean> {
  // In a real implementation, this would wait for events to be sent
  log('Sentry flush called', { timeout });
  return true;
}

/**
 * Close Sentry
 */
export async function close(timeout: number = 2000): Promise<boolean> {
  log('Sentry close called', { timeout });
  return true;
}

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Parse stack trace into frames
 */
function parseStackTrace(stack?: string): Array<{
  filename: string;
  function: string;
  lineno: number;
  colno: number;
}> {
  if (!stack) return [];

  const lines = stack.split('\n').slice(1); // Skip error message
  const frames: Array<{
    filename: string;
    function: string;
    lineno: number;
    colno: number;
  }> = [];

  for (const line of lines) {
    const match = line.match(/at (.+) \((.+):(\d+):(\d+)\)/) ||
                  line.match(/at (.+):(\d+):(\d+)/);

    if (match) {
      frames.push({
        function: match[1].split(' ')[0], // Extract function name
        filename: match[match.length - 3],
        lineno: parseInt(match[match.length - 2]),
        colno: parseInt(match[match.length - 1])
      });
    }
  }

  return frames.reverse(); // Sentry expects frames in reverse order
}

/**
 * Get stored events (for debugging)
 */
export function getStoredEvents(): SentryEvent[] {
  return eventStore.getEvents();
}

/**
 * Get events by level
 */
export function getEventsByLevel(level: string): SentryEvent[] {
  return eventStore.getEventsByLevel(level);
}

/**
 * Clear stored events
 */
export function clearStoredEvents(): void {
  eventStore.clear();
}

/**
 * Express error handling middleware
 */
export function sentryErrorHandler() {
  return (error: Error, req: any, res: any, next: Function) => {
    // Capture the error
    captureException(error, {
      url: req.url,
      method: req.method,
      headers: req.headers,
      user: req.user,
      body: req.body,
      params: req.params,
      query: req.query,
      requestId: req.requestId
    });

    // Continue with normal error handling
    next(error);
  };
}

/**
 * Performance monitoring integration
 */
export function capturePerformanceIssue(
  issue: string,
  duration: number,
  context: Record<string, any>
): void {
  captureMessage(`Performance Issue: ${issue}`, 'warning', {
    ...context,
    duration,
    type: 'performance'
  });
}

/**
 * Business logic error capture
 */
export function captureBusinessError(
  operation: string,
  error: Error,
  context: Record<string, any>
): void {
  captureException(error, {
    ...context,
    operation,
    type: 'business_logic'
  });
}

// Initialize Sentry on module load
initSentry();
