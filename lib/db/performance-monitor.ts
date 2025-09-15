/**
 * Database Performance Monitor
 * Provides query performance monitoring, slow query detection, and alerting
 */

import { log } from '../log';
import { getEnvVar, getEnvVarString } from '../env-security';
import { connectionPool } from './connection-pool';

// Check if database is configured
const hasDatabase = Boolean(getEnvVar('POSTGRES_URL') || getEnvVar('DATABASE_URL'));

export interface QueryPerformanceMetrics {
  query: string;
  executionTime: number;
  timestamp: Date;
  slow: boolean;
  parameters?: any[];
}

export interface PerformanceAlert {
  type: 'slow_query' | 'high_error_rate' | 'connection_pool_pressure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: Record<string, any>;
  timestamp: Date;
}

export interface PerformanceConfig {
  slowQueryThreshold: number; // milliseconds
  alertCooldown: number; // milliseconds between similar alerts
  enableDetailedLogging: boolean;
  performanceBudget: {
    p95QueryTime: number;
    maxErrorRate: number;
    maxPoolUtilization: number;
  };
}

/**
 * Default performance configuration
 */
const DEFAULT_CONFIG: PerformanceConfig = {
  slowQueryThreshold: 1000, // 1 second
  alertCooldown: 300000, // 5 minutes
  enableDetailedLogging: false,
  performanceBudget: {
    p95QueryTime: 500, // 500ms p95
    maxErrorRate: 5, // 5%
    maxPoolUtilization: 80 // 80%
  }
};

/**
 * Database Performance Monitor Class
 */
export class DatabasePerformanceMonitor {
  private config: PerformanceConfig;
  private queryMetrics: QueryPerformanceMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private lastAlertTimes = new Map<string, number>();
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startMonitoring();
  }

  /**
   * Record a query execution for performance monitoring
   */
  recordQuery(query: string, executionTime: number, parameters?: any[]): void {
    const metrics: QueryPerformanceMetrics = {
      query: query.substring(0, 500), // Limit query length for logging
      executionTime,
      timestamp: new Date(),
      slow: executionTime > this.config.slowQueryThreshold,
      parameters: this.config.enableDetailedLogging ? parameters : undefined
    };

    this.queryMetrics.push(metrics);

    // Keep only recent metrics (last 1000 queries)
    if (this.queryMetrics.length > 1000) {
      this.queryMetrics = this.queryMetrics.slice(-1000);
    }

    // Log slow queries immediately
    if (metrics.slow) {
      this.logSlowQuery(metrics);
    }
  }

  /**
   * Log slow query with appropriate severity
   */
  private logSlowQuery(metrics: QueryPerformanceMetrics): void {
    const severity = metrics.executionTime > 5000 ? 'error' : 'warn';
    const context = {
      query: metrics.query,
      executionTime: metrics.executionTime,
      threshold: this.config.slowQueryThreshold,
      timestamp: metrics.timestamp.toISOString()
    };

    if (severity === 'error') {
      log('CRITICAL: Extremely slow database query detected', context);
    } else {
      log('Slow database query detected', context);
    }
  }

  /**
   * Check performance against budgets and generate alerts
   */
  private checkPerformanceBudgets(): void {
    const now = Date.now();

    // Calculate current metrics
    const recentQueries = this.queryMetrics.filter(
      m => now - m.timestamp.getTime() < 300000 // Last 5 minutes
    );

    if (recentQueries.length === 0) return;

    // Calculate p95 query time
    const sortedTimes = recentQueries
      .map(m => m.executionTime)
      .sort((a, b) => a - b);

    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p95QueryTime = sortedTimes[p95Index] || 0;

    // Check p95 budget
    if (p95QueryTime > this.config.performanceBudget.p95QueryTime) {
      this.generateAlert({
        type: 'slow_query',
        severity: p95QueryTime > this.config.performanceBudget.p95QueryTime * 2 ? 'high' : 'medium',
        message: `P95 query time (${p95QueryTime}ms) exceeds budget (${this.config.performanceBudget.p95QueryTime}ms)`,
        details: {
          p95QueryTime,
          budget: this.config.performanceBudget.p95QueryTime,
          sampleSize: recentQueries.length
        },
        timestamp: new Date()
      });
    }

    // Check pool utilization (only if database is configured)
    if (hasDatabase) {
      const poolMetrics = connectionPool.getMetrics();
      if (poolMetrics.poolUtilization > this.config.performanceBudget.maxPoolUtilization) {
        this.generateAlert({
          type: 'connection_pool_pressure',
          severity: poolMetrics.poolUtilization > 95 ? 'critical' : 'medium',
          message: `Database connection pool utilization (${poolMetrics.poolUtilization.toFixed(1)}%) exceeds threshold`,
          details: {
            utilization: poolMetrics.poolUtilization,
            activeConnections: poolMetrics.activeConnections,
            totalConnections: poolMetrics.totalConnections,
            waitingClients: poolMetrics.waitingClients
          },
          timestamp: new Date()
        });
      }
    }

    // Check error rate
    const errorQueries = recentQueries.filter(m => false); // TODO: Track errors properly
    const errorRate = recentQueries.length > 0 ? (errorQueries.length / recentQueries.length) * 100 : 0;

    if (errorRate > this.config.performanceBudget.maxErrorRate) {
      this.generateAlert({
        type: 'high_error_rate',
        severity: errorRate > 10 ? 'high' : 'medium',
        message: `Database error rate (${errorRate.toFixed(1)}%) exceeds threshold`,
        details: {
          errorRate,
          errorCount: errorQueries.length,
          totalQueries: recentQueries.length
        },
        timestamp: new Date()
      });
    }
  }

  /**
   * Generate and emit performance alert
   */
  private generateAlert(alert: PerformanceAlert): void {
    const alertKey = `${alert.type}-${alert.severity}`;
    const lastAlertTime = this.lastAlertTimes.get(alertKey) || 0;
    const now = Date.now();

    // Check cooldown period
    if (now - lastAlertTime < this.config.alertCooldown) {
      return; // Skip alert due to cooldown
    }

    this.lastAlertTimes.set(alertKey, now);
    this.alerts.push(alert);

    // Keep only recent alerts (last 100)
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    // Log alert with appropriate level
    const logLevel = alert.severity === 'critical' ? 'error' :
                    alert.severity === 'high' ? 'error' :
                    alert.severity === 'medium' ? 'warn' : 'info';

    log(`Database Performance Alert [${alert.severity.toUpperCase()}]: ${alert.message}`, {
      type: alert.type,
      severity: alert.severity,
      details: alert.details,
      timestamp: alert.timestamp.toISOString()
    });
  }

  /**
   * Start performance monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.checkPerformanceBudgets();
    }, 60000); // Check every minute
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): {
    queryCount: number;
    slowQueryCount: number;
    averageQueryTime: number;
    p95QueryTime: number;
    activeAlerts: number;
    recentAlerts: PerformanceAlert[];
  } {
    const recentQueries = this.queryMetrics.filter(
      m => Date.now() - m.timestamp.getTime() < 300000 // Last 5 minutes
    );

    const slowQueryCount = recentQueries.filter(m => m.slow).length;
    const totalTime = recentQueries.reduce((sum, m) => sum + m.executionTime, 0);
    const averageQueryTime = recentQueries.length > 0 ? totalTime / recentQueries.length : 0;

    // Calculate p95
    const sortedTimes = recentQueries
      .map(m => m.executionTime)
      .sort((a, b) => a - b);

    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p95QueryTime = sortedTimes[p95Index] || 0;

    const recentAlerts = this.alerts.filter(
      a => Date.now() - a.timestamp.getTime() < 3600000 // Last hour
    );

    return {
      queryCount: recentQueries.length,
      slowQueryCount,
      averageQueryTime,
      p95QueryTime,
      activeAlerts: recentAlerts.length,
      recentAlerts
    };
  }

  /**
   * Get query performance statistics
   */
  getQueryStats(): {
    totalQueries: number;
    slowQueries: number;
    averageExecutionTime: number;
    topSlowQueries: Array<{ query: string; count: number; avgTime: number }>;
  } {
    const stats = {
      totalQueries: this.queryMetrics.length,
      slowQueries: this.queryMetrics.filter(m => m.slow).length,
      averageExecutionTime: 0,
      topSlowQueries: [] as Array<{ query: string; count: number; avgTime: number }>
    };

    if (this.queryMetrics.length > 0) {
      const totalTime = this.queryMetrics.reduce((sum, m) => sum + m.executionTime, 0);
      stats.averageExecutionTime = totalTime / this.queryMetrics.length;
    }

    // Group slow queries by pattern
    const slowQueryGroups = new Map<string, { count: number; totalTime: number }>();

    this.queryMetrics
      .filter(m => m.slow)
      .forEach(m => {
        // Simple query pattern extraction (first few words)
        const pattern = m.query.split(' ').slice(0, 3).join(' ');
        const existing = slowQueryGroups.get(pattern) || { count: 0, totalTime: 0 };
        existing.count++;
        existing.totalTime += m.executionTime;
        slowQueryGroups.set(pattern, existing);
      });

    stats.topSlowQueries = Array.from(slowQueryGroups.entries())
      .map(([query, stats]) => ({
        query,
        count: stats.count,
        avgTime: stats.totalTime / stats.count
      }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, 10);

    return stats;
  }

  /**
   * Shutdown the performance monitor
   */
  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}

/**
 * Environment-specific configuration
 */
function getPerformanceConfig(): PerformanceConfig {
  const isProduction = getEnvVar('NODE_ENV') === 'production';

  return {
    ...DEFAULT_CONFIG,
    slowQueryThreshold: parseInt(getEnvVarString('DB_SLOW_QUERY_THRESHOLD') || String(DEFAULT_CONFIG.slowQueryThreshold)),
    enableDetailedLogging: isProduction ? false : (getEnvVarString('DB_DETAILED_LOGGING') === 'true'),
    performanceBudget: {
      p95QueryTime: parseInt(getEnvVarString('DB_P95_BUDGET_MS') || String(DEFAULT_CONFIG.performanceBudget.p95QueryTime)),
      maxErrorRate: parseInt(getEnvVarString('DB_MAX_ERROR_RATE') || String(DEFAULT_CONFIG.performanceBudget.maxErrorRate)),
      maxPoolUtilization: parseInt(getEnvVarString('DB_MAX_POOL_UTILIZATION') || String(DEFAULT_CONFIG.performanceBudget.maxPoolUtilization))
    }
  };
}

// Create and export the performance monitor (only if database is configured)
export const performanceMonitor = hasDatabase ? new DatabasePerformanceMonitor(getPerformanceConfig()) : {
  recordQuery: () => {},
  getMetrics: () => ({
    queryCount: 0,
    slowQueryCount: 0,
    averageQueryTime: 0,
    p95QueryTime: 0,
    activeAlerts: 0
  }),
  getMetricsHistory: () => [],
  getActiveAlerts: () => [],
  getAllAlerts: () => [],
  resolveAlert: () => {},
  getPerformanceSummary: () => ({
    overall: 'unknown',
    metrics: {},
    alerts: [],
    recommendations: []
  }),
  updateConfig: () => {},
  shutdown: () => {}
} as any;

// Graceful shutdown
process.on('SIGTERM', () => {
  performanceMonitor.shutdown();
});

process.on('SIGINT', () => {
  performanceMonitor.shutdown();
});
