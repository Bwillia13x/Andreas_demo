/**
 * Prometheus Metrics Exporter
 * Exports application metrics in Prometheus format for APM integration
 */

import { Request, Response } from 'express';
import { getEnvVar } from '../env-security';
import { log } from '../log';
import { performanceMonitor } from '../db/performance-monitor';
import { connectionPool } from '../db/connection-pool';

interface PrometheusMetric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  value: number;
  labels?: Record<string, string>;
}

/**
 * Format a Prometheus metric
 */
function formatPrometheusMetric(metric: PrometheusMetric): string {
  let output = '';

  // Help text
  output += `# HELP ${metric.name} ${metric.help}\n`;

  // Type
  output += `# TYPE ${metric.name} ${metric.type}\n`;

  // Value with labels
  const labels = metric.labels ?
    '{' + Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}' :
    '';

  output += `${metric.name}${labels} ${metric.value}\n`;

  return output;
}

/**
 * Get application metrics in Prometheus format
 */
export function getPrometheusMetrics(): string {
  const metrics: PrometheusMetric[] = [];
  const now = Date.now();

  // Application info
  metrics.push({
    name: 'mgmt_vibe_info',
    help: 'Application information',
    type: 'gauge',
    value: 1,
    labels: {
      version: '1.0.0',
      environment: getEnvVar('NODE_ENV') || 'development'
    }
  });

  // Uptime
  const uptime = process.uptime();
  metrics.push({
    name: 'mgmt_vibe_uptime_seconds',
    help: 'Application uptime in seconds',
    type: 'gauge',
    value: uptime
  });

  // Memory usage
  const memUsage = process.memoryUsage();
  metrics.push({
    name: 'mgmt_vibe_memory_heap_used_bytes',
    help: 'Heap memory used in bytes',
    type: 'gauge',
    value: memUsage.heapUsed
  });

  metrics.push({
    name: 'mgmt_vibe_memory_heap_total_bytes',
    help: 'Heap memory total in bytes',
    type: 'gauge',
    value: memUsage.heapTotal
  });

  metrics.push({
    name: 'mgmt_vibe_memory_rss_bytes',
    help: 'Resident set size memory in bytes',
    type: 'gauge',
    value: memUsage.rss
  });

// Database connection pool metrics (only if database is configured)
let poolMetrics: any = {
  totalConnections: 0,
  idleConnections: 0,
  activeConnections: 0,
  waitingClients: 0,
  poolUtilization: 0
};

try {
  poolMetrics = connectionPool.getMetrics();
} catch (error) {
  // Database not configured, use defaults
}
  metrics.push({
    name: 'mgmt_vibe_db_pool_total_connections',
    help: 'Total database connections in pool',
    type: 'gauge',
    value: poolMetrics.totalConnections
  });

  metrics.push({
    name: 'mgmt_vibe_db_pool_idle_connections',
    help: 'Idle database connections in pool',
    type: 'gauge',
    value: poolMetrics.idleConnections
  });

  metrics.push({
    name: 'mgmt_vibe_db_pool_active_connections',
    help: 'Active database connections in pool',
    type: 'gauge',
    value: poolMetrics.activeConnections
  });

  metrics.push({
    name: 'mgmt_vibe_db_pool_waiting_clients',
    help: 'Clients waiting for database connections',
    type: 'gauge',
    value: poolMetrics.waitingClients
  });

  metrics.push({
    name: 'mgmt_vibe_db_pool_utilization_percent',
    help: 'Database connection pool utilization percentage',
    type: 'gauge',
    value: poolMetrics.poolUtilization
  });

  // Database query metrics
  const perfMetrics = performanceMonitor.getMetrics();
  metrics.push({
    name: 'mgmt_vibe_db_queries_total',
    help: 'Total number of database queries executed',
    type: 'counter',
    value: perfMetrics.queryCount
  });

  metrics.push({
    name: 'mgmt_vibe_db_slow_queries_total',
    help: 'Total number of slow database queries',
    type: 'counter',
    value: perfMetrics.slowQueryCount
  });

  metrics.push({
    name: 'mgmt_vibe_db_average_query_time_seconds',
    help: 'Average database query execution time',
    type: 'gauge',
    value: perfMetrics.averageQueryTime / 1000 // Convert to seconds
  });

  metrics.push({
    name: 'mgmt_vibe_db_p95_query_time_seconds',
    help: '95th percentile database query execution time',
    type: 'gauge',
    value: perfMetrics.p95QueryTime / 1000 // Convert to seconds
  });

  // Error metrics
  const poolStatus = connectionPool.getStatus();
  metrics.push({
    name: 'mgmt_vibe_db_errors_total',
    help: 'Total database errors',
    type: 'counter',
    value: poolMetrics.totalErrors
  });

  // Application performance alerts
  const activeAlerts = perfMetrics.activeAlerts;
  metrics.push({
    name: 'mgmt_vibe_alerts_active_total',
    help: 'Number of active performance alerts',
    type: 'gauge',
    value: activeAlerts
  });

  // HTTP request metrics (would need to be collected separately)
  // For now, we'll add placeholders
  metrics.push({
    name: 'mgmt_vibe_http_requests_total',
    help: 'Total HTTP requests',
    type: 'counter',
    value: 0, // Would need request counter
    labels: { method: 'GET', status: '200' }
  });

  metrics.push({
    name: 'mgmt_vibe_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    type: 'histogram',
    value: 0, // Would need histogram buckets
    labels: { method: 'GET', status: '200' }
  });

  // Business metrics (placeholders for actual business metrics)
  metrics.push({
    name: 'mgmt_vibe_business_services_total',
    help: 'Total number of services offered',
    type: 'gauge',
    value: 0 // Would need to query actual count
  });

  metrics.push({
    name: 'mgmt_vibe_business_appointments_total',
    help: 'Total appointments booked',
    type: 'counter',
    value: 0 // Would need appointment counter
  });

  // Format all metrics
  let output = '# Prometheus metrics for mgmt_vibe\n';
  output += `# Generated at ${new Date().toISOString()}\n\n`;

  for (const metric of metrics) {
    output += formatPrometheusMetric(metric) + '\n';
  }

  return output;
}

/**
 * Express middleware to serve Prometheus metrics
 */
export function prometheusMetricsMiddleware(req: Request, res: Response): void {
  try {
    const metrics = getPrometheusMetrics();

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(metrics);

    log('Prometheus metrics exported', {
      contentLength: metrics.length,
      endpoint: '/metrics'
    });
  } catch (error) {
    log('Failed to export Prometheus metrics', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).send('# Error generating metrics\n');
  }
}

/**
 * Validate Prometheus metrics format
 */
export function validatePrometheusMetrics(metrics: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = metrics.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Basic validation - metric lines should have format: name{labels} value
    const metricMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)({[^}]*})?\s+([0-9.+-eE]+)$/);
    if (!metricMatch) {
      errors.push(`Invalid metric format at line ${i + 1}: ${line}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
