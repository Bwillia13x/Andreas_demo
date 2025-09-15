/**
 * Enhanced Database Connection Pool Manager
 * Provides optimized connection pooling, monitoring, and resource management
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { log } from '../log';
import { getEnvVar, getEnvVarString } from '../env-security';
import { performanceMonitor } from './performance-monitor';
import { traceDatabaseOperation } from '../tracing/opentelemetry';

export interface ConnectionPoolConfig extends PoolConfig {
  // Pool size configuration
  min?: number;
  max?: number;
  
  // Timeout configuration
  acquireTimeoutMillis?: number;
  createTimeoutMillis?: number;
  destroyTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  reapIntervalMillis?: number;
  createRetryIntervalMillis?: number;
  
  // Health check configuration
  healthCheckInterval?: number;
  maxConnectionAge?: number;
  
  // Monitoring configuration
  enableMonitoring?: boolean;
  monitoringInterval?: number;
}

export interface ConnectionPoolMetrics {
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingClients: number;
  totalQueries: number;
  totalErrors: number;
  averageQueryTime: number;
  poolUtilization: number;
  uptime: number;
  [key: string]: unknown;
}

export class EnhancedConnectionPool {
  private pool: Pool;
  private config: ConnectionPoolConfig;
  private metrics: ConnectionPoolMetrics;
  private startTime: number;
  private queryTimes: number[] = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private monitoringInterval?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(config: ConnectionPoolConfig) {
    this.config = {
      // Default configuration optimized for concurrent load
      min: 5,
      max: 25,
      acquireTimeoutMillis: 10000, // 10 seconds
      createTimeoutMillis: 5000,   // 5 seconds
      destroyTimeoutMillis: 5000,  // 5 seconds
      idleTimeoutMillis: 30000,    // 30 seconds
      reapIntervalMillis: 1000,    // 1 second
      createRetryIntervalMillis: 200, // 200ms
      healthCheckInterval: 30000,   // 30 seconds
      maxConnectionAge: 3600000,    // 1 hour
      enableMonitoring: true,
      monitoringInterval: 10000,    // 10 seconds
      ...config
    };

    this.pool = new Pool(this.config);
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();

    this.setupEventListeners();
    this.startHealthChecks();
    this.startMonitoring();
  }

  private initializeMetrics(): ConnectionPoolMetrics {
    return {
      totalConnections: 0,
      idleConnections: 0,
      activeConnections: 0,
      waitingClients: 0,
      totalQueries: 0,
      totalErrors: 0,
      averageQueryTime: 0,
      poolUtilization: 0,
      uptime: 0
    };
  }

  private setupEventListeners(): void {
    this.pool.on('connect', (client: PoolClient) => {
      this.metrics.totalConnections++;
      log('Database connection established', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      });
    });

    this.pool.on('acquire', (client: PoolClient) => {
      log('Database connection acquired', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount
      });
    });

    this.pool.on('remove', (client: PoolClient) => {
      log('Database connection removed', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount
      });
    });

    this.pool.on('error', (err: Error, client: PoolClient) => {
      this.metrics.totalErrors++;
      log('Database pool error', {
        error: err.message,
        stack: err.stack,
        totalErrors: this.metrics.totalErrors
      });
    });
  }

  private startHealthChecks(): void {
    if (!this.config.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        const client = await this.pool.connect();
        const start = Date.now();
        await client.query('SELECT 1');
        const duration = Date.now() - start;
        client.release();

        log('Database health check passed', {
          responseTime: duration,
          totalConnections: this.pool.totalCount,
          idleConnections: this.pool.idleCount
        });
      } catch (error) {
        this.metrics.totalErrors++;
        log('Database health check failed', {
          error: error instanceof Error ? error.message : String(error),
          totalErrors: this.metrics.totalErrors
        });
      }
    }, this.config.healthCheckInterval);
  }

  private startMonitoring(): void {
    if (!this.config.enableMonitoring || !this.config.monitoringInterval) return;

    this.monitoringInterval = setInterval(() => {
      this.updateMetrics();
      
      // Log metrics periodically
      if (this.metrics.totalQueries % 100 === 0 && this.metrics.totalQueries > 0) {
        log('Database pool metrics', this.metrics);
      }

      // Check for potential issues
      this.checkPoolHealth();
    }, this.config.monitoringInterval);
  }

  private updateMetrics(): void {
    this.metrics.totalConnections = this.pool.totalCount;
    this.metrics.idleConnections = this.pool.idleCount;
    this.metrics.activeConnections = this.pool.totalCount - this.pool.idleCount;
    this.metrics.waitingClients = this.pool.waitingCount;
    this.metrics.poolUtilization = this.pool.totalCount > 0 
      ? (this.metrics.activeConnections / this.pool.totalCount) * 100 
      : 0;
    this.metrics.uptime = Date.now() - this.startTime;

    // Calculate average query time from recent queries
    if (this.queryTimes.length > 0) {
      const sum = this.queryTimes.reduce((a, b) => a + b, 0);
      this.metrics.averageQueryTime = sum / this.queryTimes.length;
      
      // Keep only recent query times (last 100 queries)
      if (this.queryTimes.length > 100) {
        this.queryTimes = this.queryTimes.slice(-100);
      }
    }
  }

  private checkPoolHealth(): void {
    const { poolUtilization, waitingClients, totalErrors } = this.metrics;

    // Warn if pool utilization is high
    if (poolUtilization > 80) {
      log('High database pool utilization detected', {
        utilization: poolUtilization,
        activeConnections: this.metrics.activeConnections,
        totalConnections: this.metrics.totalConnections,
        waitingClients
      });
    }

    // Warn if there are waiting clients
    if (waitingClients > 5) {
      log('High number of waiting database clients', {
        waitingClients,
        poolUtilization,
        totalConnections: this.metrics.totalConnections
      });
    }

    // Warn if error rate is high
    if (totalErrors > 10 && this.metrics.totalQueries > 0) {
      const errorRate = (totalErrors / this.metrics.totalQueries) * 100;
      if (errorRate > 5) {
        log('High database error rate detected', {
          errorRate: errorRate.toFixed(2),
          totalErrors,
          totalQueries: this.metrics.totalQueries
        });
      }
    }
  }

  /**
   * Execute a query with connection management and monitoring
   */
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const start = Date.now();
    let client: PoolClient | null = null;

    return traceDatabaseOperation('query', text, params || [], async () => {
      try {
        client = await this.pool.connect();
        const result = await client.query(text, params);

        this.metrics.totalQueries++;
        const duration = Date.now() - start;
        this.queryTimes.push(duration);

        // Record performance metrics
        performanceMonitor.recordQuery(text, duration, params);

        return {
          rows: result.rows,
          rowCount: result.rowCount ?? 0
        };
      } catch (error) {
        this.metrics.totalErrors++;
        const duration = Date.now() - start;

        log('Database query error', {
          error: error instanceof Error ? error.message : String(error),
          query: text.substring(0, 100),
          duration
        });

        // Record error metrics (with negative duration to indicate error)
        performanceMonitor.recordQuery(text, -duration, params);

        throw error;
      } finally {
        if (client) {
          client.release();
        }
      }
    });
  }

  /**
   * Get a connection from the pool for transaction management
   */
  async getConnection(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      this.metrics.totalErrors++;
      log('Failed to acquire database connection', {
        error: error instanceof Error ? error.message : String(error),
        totalConnections: this.pool.totalCount,
        waitingClients: this.pool.waitingCount
      });
      throw error;
    }
  }

  /**
   * Execute a transaction with automatic rollback on error
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getConnection();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.metrics.totalErrors++;
      log('Database transaction rolled back', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get current pool metrics
   */
  getMetrics(): ConnectionPoolMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get pool status for health checks
   */
  getStatus(): {
    healthy: boolean;
    totalConnections: number;
    idleConnections: number;
    activeConnections: number;
    waitingClients: number;
    poolUtilization: number;
  } {
    const metrics = this.getMetrics();
    return {
      healthy: metrics.poolUtilization < 90 && metrics.waitingClients < 10,
      totalConnections: metrics.totalConnections,
      idleConnections: metrics.idleConnections,
      activeConnections: metrics.activeConnections,
      waitingClients: metrics.waitingClients,
      poolUtilization: metrics.poolUtilization
    };
  }

  /**
   * End the connection pool (alias for shutdown)
   */
  async end(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Gracefully shutdown the connection pool
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    log('Shutting down database connection pool', {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      activeConnections: this.metrics.activeConnections
    });

    // End the pool
    await this.pool.end();
    
    log('Database connection pool shutdown complete');
  }
}

// Get database URL (may be undefined for testing)
const databaseUrl = getEnvVar('POSTGRES_URL') || getEnvVar('DATABASE_URL');

// Configure pool sizes based on environment
const isProduction = getEnvVar('NODE_ENV') === 'production';

// Create a mock pool for testing when no database is configured
let connectionPool: EnhancedConnectionPool;

if (databaseUrl) {
  connectionPool = new EnhancedConnectionPool({
    connectionString: databaseUrl,
    // Production-optimized pool configuration with increased limits for high concurrency
    min: parseInt(getEnvVarString('DB_POOL_MIN') || (isProduction ? '20' : '10')),
    max: parseInt(getEnvVarString('DB_POOL_MAX') || (isProduction ? '100' : '50')),
    acquireTimeoutMillis: parseInt(getEnvVarString('DB_ACQUIRE_TIMEOUT') || '15000'), // Increased timeout
    createTimeoutMillis: parseInt(getEnvVarString('DB_CREATE_TIMEOUT') || '10000'),
    destroyTimeoutMillis: parseInt(getEnvVarString('DB_DESTROY_TIMEOUT') || '10000'),
    idleTimeoutMillis: parseInt(getEnvVarString('DB_IDLE_TIMEOUT') || '60000'), // Increased idle timeout
    reapIntervalMillis: parseInt(getEnvVarString('DB_REAP_INTERVAL') || '1000'),
    createRetryIntervalMillis: parseInt(getEnvVarString('DB_RETRY_INTERVAL') || '500'),
    connectionTimeoutMillis: parseInt(getEnvVarString('DB_CONNECTION_TIMEOUT') || '10000'), // Increased connection timeout
    healthCheckInterval: parseInt(getEnvVarString('DB_HEALTH_CHECK_INTERVAL') || '15000'), // More frequent health checks
    maxConnectionAge: parseInt(getEnvVarString('DB_MAX_CONNECTION_AGE') || '7200000'), // 2 hours
    enableMonitoring: true,
    monitoringInterval: parseInt(getEnvVarString('DB_MONITORING_INTERVAL') || '5000') // More frequent monitoring
  });
} else {
  // Create a mock pool for testing/development without database
  connectionPool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    getConnection: async () => ({ release: () => {} }),
    transaction: async (fn: Function) => fn({ release: () => {} }),
    getMetrics: () => ({
      totalConnections: 0,
      idleConnections: 0,
      activeConnections: 0,
      waitingClients: 0,
      poolUtilization: 0,
      totalQueries: 0,
      totalErrors: 0,
      averageQueryTime: 0,
      uptime: 0
    }),
    getStatus: () => ({
      healthy: true,
      totalConnections: 0,
      idleConnections: 0,
      activeConnections: 0,
      waitingClients: 0,
      poolUtilization: 0
    }),
    end: async () => {},
    shutdown: async () => {}
  } as any;
}

export { connectionPool };

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  await connectionPool.shutdown();
});

process.on('SIGINT', async () => {
  await connectionPool.shutdown();
});