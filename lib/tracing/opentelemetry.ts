/**
 * OpenTelemetry Tracing Configuration
 * Provides distributed tracing for HTTP requests and database operations
 */

import crypto from 'crypto';
import { getEnvVar, getEnvVarString } from '../env-security';
import { log } from '../log';

// Basic OpenTelemetry setup - in production you'd use @opentelemetry packages
export interface TraceSpan {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  parentId?: string;
  kind: 'server' | 'client' | 'internal';
  status?: 'ok' | 'error';
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  spans: TraceSpan[];
}

/**
 * Simple in-memory trace store (in production, use Jaeger, Zipkin, etc.)
 */
class TraceStore {
  private traces = new Map<string, TraceContext>();
  private maxTraces = 1000;

  createTrace(traceId: string): TraceContext {
    const context: TraceContext = {
      traceId,
      spanId: generateSpanId(),
      spans: []
    };

    if (this.traces.size >= this.maxTraces) {
      // Remove oldest trace
      const firstKey = this.traces.keys().next().value;
      if (firstKey) {
        this.traces.delete(firstKey);
      }
    }

    this.traces.set(traceId, context);
    return context;
  }

  getTrace(traceId: string): TraceContext | undefined {
    return this.traces.get(traceId);
  }

  addSpan(traceId: string, span: TraceSpan): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.spans.push(span);
    }
  }

  getAllTraces(): TraceContext[] {
    return Array.from(this.traces.values());
  }

  clear(): void {
    this.traces.clear();
  }
}

const traceStore = new TraceStore();

/**
 * Generate a random trace ID
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a random span ID
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create a new span
 */
export function createSpan(name: string, attributes: Record<string, any> = {}): TraceSpan {
  const span: TraceSpan = {
    id: generateSpanId(),
    name,
    startTime: Date.now(),
    attributes: {},
    kind: 'internal'
  };

  // Convert attribute values to strings/numbers/booleans
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      span.attributes[key] = value;
    } else {
      span.attributes[key] = String(value);
    }
  }

  return span;
}

/**
 * End a span
 */
export function endSpan(span: TraceSpan, status: 'ok' | 'error' = 'ok'): void {
  span.endTime = Date.now();
  span.status = status;

  // Add duration
  span.attributes['duration_ms'] = span.endTime - span.startTime;

  // Store span in current trace context
  const currentTraceId = getCurrentTraceId();
  if (currentTraceId) {
    traceStore.addSpan(currentTraceId, span);
  }

  // Log span completion
  if (status === 'error' || span.attributes['duration_ms'] > 1000) {
    log('Trace span completed', {
      spanId: span.id,
      name: span.name,
      duration: span.attributes['duration_ms'],
      status
    });
  }
}

/**
 * Set current trace context
 */
let currentTraceId: string | undefined;
let currentSpanId: string | undefined;

export function setTraceContext(traceId: string, spanId?: string): void {
  currentTraceId = traceId;
  currentSpanId = spanId;
}

export function getCurrentTraceId(): string | undefined {
  return currentTraceId;
}

export function getCurrentSpanId(): string | undefined {
  return currentSpanId;
}

/**
 * Clear trace context
 */
export function clearTraceContext(): void {
  currentTraceId = undefined;
  currentSpanId = undefined;
}

/**
 * Create a child span
 */
export function createChildSpan(name: string, attributes: Record<string, any> = {}): TraceSpan {
  const span = createSpan(name, attributes);
  span.parentId = currentSpanId;
  return span;
}

/**
 * HTTP request tracing middleware
 */
export function tracingMiddleware() {
  return (req: any, res: any, next: Function) => {
    // Generate or use existing trace ID from headers
    const traceId = req.headers['x-trace-id'] ||
                   req.headers['x-request-id'] ||
                   generateTraceId();

    const spanId = generateSpanId();

    setTraceContext(traceId, spanId);

    // Create request span
    const requestSpan = createSpan('http_request', {
      'http.method': req.method,
      'http.url': req.url,
      'http.path': req.path,
      'http.user_agent': req.get('User-Agent'),
      'http.remote_addr': req.ip
    });
    requestSpan.kind = 'server';

    // Store span in request for later completion
    req._traceSpan = requestSpan;
    req._traceId = traceId;

    // Set trace headers for downstream services
    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-span-id', spanId);

    // Complete span when response finishes
    res.on('finish', () => {
      if (req._traceSpan) {
        req._traceSpan.attributes['http.status_code'] = res.statusCode;
        endSpan(req._traceSpan, res.statusCode >= 400 ? 'error' : 'ok');
      }
      clearTraceContext();
    });

    next();
  };
}

/**
 * Database operation tracing
 */
export async function traceDatabaseOperation<T>(
  operation: string,
  query: string,
  params: any[],
  fn: () => Promise<T>
): Promise<T> {
  const span = createChildSpan('db_operation', {
    'db.operation': operation,
    'db.statement': query.substring(0, 100), // Limit query length
    'db.params_count': params.length
  });
  span.kind = 'client';

  try {
    const result = await fn();
    endSpan(span, 'ok');
    return result;
  } catch (error) {
    span.attributes['error'] = error instanceof Error ? error.message : String(error);
    endSpan(span, 'error');
    throw error;
  }
}

/**
 * External API call tracing
 */
export async function traceExternalCall<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const span = createChildSpan('external_call', {
    'external.service': service,
    'external.operation': operation
  });
  span.kind = 'client';

  try {
    const result = await fn();
    endSpan(span, 'ok');
    return result;
  } catch (error) {
    span.attributes['error'] = error instanceof Error ? error.message : String(error);
    endSpan(span, 'error');
    throw error;
  }
}

/**
 * Get trace data for debugging
 */
export function getTraceData(traceId: string): TraceContext | undefined {
  return traceStore.getTrace(traceId);
}

/**
 * Get all traces (for debugging)
 */
export function getAllTraces(): TraceContext[] {
  return traceStore.getAllTraces();
}

/**
 * Export traces in Jaeger/Zipkin format (simplified)
 */
export function exportTraces(): any[] {
  const traces = traceStore.getAllTraces();
  return traces.map(trace => ({
    traceId: trace.traceId,
    spans: trace.spans.map(span => ({
      spanId: span.id,
      parentSpanId: span.parentId,
      operationName: span.name,
      startTime: span.startTime * 1000, // Convert to microseconds
      duration: span.endTime ? (span.endTime - span.startTime) * 1000 : 0,
      tags: span.attributes,
      logs: [],
      references: span.parentId ? [{ refType: 'CHILD_OF', traceId: trace.traceId, spanId: span.parentId }] : []
    }))
  }));
}

/**
 * Clear all trace data
 */
export function clearTraces(): void {
  traceStore.clear();
}

/**
 * Initialize tracing based on environment
 */
export function initializeTracing(): void {
  const isProduction = getEnvVar('NODE_ENV') === 'production';
  const enableTracing = getEnvVarString('ENABLE_TRACING') === 'true' || isProduction;

  if (enableTracing) {
    log('OpenTelemetry tracing initialized', {
      mode: 'in-memory',
      maxTraces: 1000
    });
  } else {
    log('Tracing disabled (set ENABLE_TRACING=true to enable)');
  }
}

// Initialize tracing
initializeTracing();
