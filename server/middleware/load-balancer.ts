/**
 * Load Balancing and Request Queuing Middleware
 * Handles high concurrency scenarios with intelligent request management
 */

import { Request, Response, NextFunction } from 'express';
import { log } from '../../lib/log';

interface QueuedRequest {
  req: Request;
  res: Response;
  next: NextFunction;
  timestamp: number;
  priority: number;
}

interface LoadBalancerConfig {
  maxConcurrentRequests: number;
  maxQueueSize: number;
  requestTimeout: number;
  priorityLevels: Record<string, number>;
  enableAdaptiveThrottling: boolean;
}

class LoadBalancer {
  private activeRequests = 0;
  private requestQueue: QueuedRequest[] = [];
  private config: LoadBalancerConfig;
  private responseTimeHistory: number[] = [];
  private errorRateHistory: number[] = [];
  private lastAdaptiveCheck = Date.now();

  constructor(config: Partial<LoadBalancerConfig> = {}) {
    this.config = {
      maxConcurrentRequests: 200, // Further increased for high concurrency
      maxQueueSize: 1000, // Increased queue size
      requestTimeout: 45000, // Increased timeout for queued requests
      priorityLevels: {
        '/api/health': 10,
        '/api/chat': 8, // Increased priority for chat
        '/api/pos': 9, // Increased priority for POS operations
        '/api/services': 7, // Increased priority for service endpoints
        '/api/staff': 6, // Increased priority for staff endpoints
        '/api/appointments': 5, // Increased priority for appointments
        '/api/analytics': 3,
        '/api/marketing': 2,
        '/api/loyalty': 2,
        'default': 1
      },
      enableAdaptiveThrottling: true,
      ...config
    };
  }

  /**
   * Main middleware function for load balancing
   */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      // Check if we're at capacity
      if (this.activeRequests >= this.config.maxConcurrentRequests) {
        return this.queueRequest(req, res, next);
      }

      // Process request immediately
      this.processRequest(req, res, next, startTime);
    };
  }

  /**
   * Queue request when at capacity
   */
  private queueRequest(req: Request, res: Response, next: NextFunction) {
    // Check queue capacity
    if (this.requestQueue.length >= this.config.maxQueueSize) {
      log('Request queue full, rejecting request', {
        queueSize: this.requestQueue.length,
        maxQueueSize: this.config.maxQueueSize,
        path: req.path,
        method: req.method
      });

      res.status(503).json({
        message: 'Server overloaded, please try again later',
        error: 'QUEUE_FULL',
        retryAfter: 5
      });
      return;
    }

    // Determine request priority
    const priority = this.getRequestPriority(req.path);
    
    // Add to queue
    const queuedRequest: QueuedRequest = {
      req,
      res,
      next,
      timestamp: Date.now(),
      priority
    };

    this.requestQueue.push(queuedRequest);
    this.requestQueue.sort((a, b) => b.priority - a.priority); // Higher priority first

    log('Request queued', {
      queueSize: this.requestQueue.length,
      priority,
      path: req.path,
      method: req.method
    });

    // Set timeout for queued request
    setTimeout(() => {
      this.timeoutQueuedRequest(queuedRequest);
    }, this.config.requestTimeout);
  }

  /**
   * Process request with monitoring
   */
  private processRequest(req: Request, res: Response, next: NextFunction, startTime: number) {
    this.activeRequests++;

    // Monitor response
    const originalSend = res.send;
    const originalJson = res.json;
    let responseHandled = false;

    const handleResponse = (statusCode: number) => {
      if (responseHandled) return;
      responseHandled = true;

      this.activeRequests--;
      const responseTime = Date.now() - startTime;
      
      // Record metrics
      this.recordResponseTime(responseTime);
      this.recordErrorRate(statusCode >= 400 ? 1 : 0);

      // Process next request in queue
      this.processNextInQueue();

      // Adaptive throttling check
      if (this.config.enableAdaptiveThrottling) {
        this.checkAdaptiveThrottling();
      }
    };

    res.send = function(body) {
      handleResponse(this.statusCode);
      return originalSend.call(this, body);
    };

    res.json = function(body) {
      handleResponse(this.statusCode);
      return originalJson.call(this, body);
    };

    // Handle connection close
    res.on('close', () => {
      handleResponse(res.statusCode || 499);
    });

    next();
  }

  /**
   * Process next request in queue
   */
  private processNextInQueue() {
    if (this.requestQueue.length === 0 || this.activeRequests >= this.config.maxConcurrentRequests) {
      return;
    }

    const queuedRequest = this.requestQueue.shift();
    if (!queuedRequest) return;

    // Check if request has timed out
    const queueTime = Date.now() - queuedRequest.timestamp;
    if (queueTime > this.config.requestTimeout) {
      if (!queuedRequest.res.headersSent) {
        queuedRequest.res.status(408).json({
          message: 'Request timeout while queued',
          error: 'QUEUE_TIMEOUT',
          queueTime
        });
      }
      return this.processNextInQueue(); // Try next request
    }

    log('Processing queued request', {
      queueTime,
      path: queuedRequest.req.path,
      method: queuedRequest.req.method,
      remainingQueue: this.requestQueue.length
    });

    this.processRequest(queuedRequest.req, queuedRequest.res, queuedRequest.next, queuedRequest.timestamp);
  }

  /**
   * Timeout a queued request
   */
  private timeoutQueuedRequest(queuedRequest: QueuedRequest) {
    const index = this.requestQueue.indexOf(queuedRequest);
    if (index === -1) return; // Already processed

    this.requestQueue.splice(index, 1);

    if (!queuedRequest.res.headersSent) {
      queuedRequest.res.status(408).json({
        message: 'Request timeout while queued',
        error: 'QUEUE_TIMEOUT',
        queueTime: Date.now() - queuedRequest.timestamp
      });
    }
  }

  /**
   * Get request priority based on path
   */
  private getRequestPriority(path: string): number {
    for (const [pattern, priority] of Object.entries(this.config.priorityLevels)) {
      if (pattern === 'default') continue;
      if (path.startsWith(pattern)) {
        return priority;
      }
    }
    return this.config.priorityLevels.default;
  }

  /**
   * Record response time for adaptive throttling
   */
  private recordResponseTime(responseTime: number) {
    this.responseTimeHistory.push(responseTime);
    if (this.responseTimeHistory.length > 100) {
      this.responseTimeHistory.shift();
    }
  }

  /**
   * Record error rate for adaptive throttling
   */
  private recordErrorRate(isError: number) {
    this.errorRateHistory.push(isError);
    if (this.errorRateHistory.length > 100) {
      this.errorRateHistory.shift();
    }
  }

  /**
   * Enhanced adaptive throttling based on performance metrics with extreme load handling
   */
  private checkAdaptiveThrottling() {
    const now = Date.now();
    if (now - this.lastAdaptiveCheck < 5000) return; // Check every 5 seconds (more frequent)
    this.lastAdaptiveCheck = now;

    if (this.responseTimeHistory.length < 5) return; // Need fewer samples for faster response

    const avgResponseTime = this.responseTimeHistory.reduce((a, b) => a + b, 0) / this.responseTimeHistory.length;
    const errorRate = this.errorRateHistory.reduce((a, b) => a + b, 0) / this.errorRateHistory.length;
    const p95ResponseTime = this.getPercentile(this.responseTimeHistory, 95);

    // More aggressive thresholds for extreme load conditions
    if (avgResponseTime > 10000 || errorRate > 0.2 || p95ResponseTime > 15000) {
      // Extreme load - significant reduction
      const reduction = Math.min(50, Math.floor(this.config.maxConcurrentRequests * 0.3));
      this.config.maxConcurrentRequests = Math.max(20, this.config.maxConcurrentRequests - reduction);
      log('Adaptive throttling: Extreme load detected - significant reduction', {
        newLimit: this.config.maxConcurrentRequests,
        avgResponseTime,
        p95ResponseTime,
        errorRate,
        reduction
      });
    } else if (avgResponseTime > 5000 || errorRate > 0.1 || p95ResponseTime > 8000) {
      // High load - moderate reduction
      const reduction = Math.min(20, Math.floor(this.config.maxConcurrentRequests * 0.2));
      this.config.maxConcurrentRequests = Math.max(30, this.config.maxConcurrentRequests - reduction);
      log('Adaptive throttling: High load detected - moderate reduction', {
        newLimit: this.config.maxConcurrentRequests,
        avgResponseTime,
        p95ResponseTime,
        errorRate,
        reduction
      });
    } else if (avgResponseTime < 2000 && errorRate < 0.02 && p95ResponseTime < 3000) {
      // Good performance - gradual increase
      this.config.maxConcurrentRequests = Math.min(400, this.config.maxConcurrentRequests + 10);
      log('Adaptive throttling: Good performance - gradual increase', {
        newLimit: this.config.maxConcurrentRequests,
        avgResponseTime,
        p95ResponseTime,
        errorRate
      });
    } else if (avgResponseTime < 1000 && errorRate < 0.01) {
      // Excellent performance - faster increase
      this.config.maxConcurrentRequests = Math.min(500, this.config.maxConcurrentRequests + 15);
      log('Adaptive throttling: Excellent performance - faster increase', {
        newLimit: this.config.maxConcurrentRequests,
        avgResponseTime,
        p95ResponseTime,
        errorRate
      });
    }
  }

  /**
   * Calculate percentile from response time history
   */
  private getPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Get current load balancer status
   */
  getStatus() {
    const avgResponseTime = this.responseTimeHistory.length > 0 
      ? this.responseTimeHistory.reduce((a, b) => a + b, 0) / this.responseTimeHistory.length 
      : 0;
    
    const errorRate = this.errorRateHistory.length > 0
      ? this.errorRateHistory.reduce((a, b) => a + b, 0) / this.errorRateHistory.length
      : 0;

    return {
      activeRequests: this.activeRequests,
      queuedRequests: this.requestQueue.length,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      maxQueueSize: this.config.maxQueueSize,
      avgResponseTime,
      errorRate,
      utilizationPercent: (this.activeRequests / this.config.maxConcurrentRequests) * 100
    };
  }
}

// Create singleton instance
const loadBalancer = new LoadBalancer();

/**
 * Load balancer middleware
 */
export function loadBalancerMiddleware() {
  return loadBalancer.middleware();
}

/**
 * Get load balancer status
 */
export function getLoadBalancerStatus() {
  return loadBalancer.getStatus();
}

/**
 * Connection pooling middleware for database-like operations
 */
export function connectionPoolMiddleware(maxConnections: number = 100) {
  let activeConnections = 0;
  const connectionQueue: Array<{ callback: () => void; timestamp: number; req: Request; res: Response }> = [];
  const connectionStats = {
    totalRequests: 0,
    queuedRequests: 0,
    timeouts: 0,
    peakActiveConnections: 0
  };

  return (req: Request, res: Response, next: NextFunction) => {
    connectionStats.totalRequests++;

    if (activeConnections < maxConnections) {
      activeConnections++;
      connectionStats.peakActiveConnections = Math.max(connectionStats.peakActiveConnections, activeConnections);

      const releaseConnection = () => {
        activeConnections--;

        // Process next queued request
        if (connectionQueue.length > 0) {
          const queuedItem = connectionQueue.shift();
          if (queuedItem) {
            connectionStats.queuedRequests--;
            // Check if still valid (not timed out)
            if (Date.now() - queuedItem.timestamp < 30000) { // 30 second queue timeout
              activeConnections++;
              connectionStats.peakActiveConnections = Math.max(connectionStats.peakActiveConnections, activeConnections);
              queuedItem.callback();
            } else {
              connectionStats.timeouts++;
              if (!queuedItem.res.headersSent) {
                queuedItem.res.status(503).json({
                  message: 'Queued request timeout',
                  error: 'QUEUED_REQUEST_TIMEOUT'
                });
              }
            }
          }
        }
      };

      res.on('finish', releaseConnection);
      res.on('close', releaseConnection);

      next();
    } else {
      // Queue the connection
      const queueItem = {
        callback: () => {
          activeConnections++;
          connectionStats.peakActiveConnections = Math.max(connectionStats.peakActiveConnections, activeConnections);

          const releaseConnection = () => {
            activeConnections--;

            // Process next queued request
            if (connectionQueue.length > 0) {
              const nextItem = connectionQueue.shift();
              if (nextItem) {
                connectionStats.queuedRequests--;
                if (Date.now() - nextItem.timestamp < 30000) {
                  activeConnections++;
                  connectionStats.peakActiveConnections = Math.max(connectionStats.peakActiveConnections, activeConnections);
                  nextItem.callback();
                } else {
                  connectionStats.timeouts++;
                  if (!nextItem.res.headersSent) {
                    nextItem.res.status(503).json({
                      message: 'Queued request timeout',
                      error: 'QUEUED_REQUEST_TIMEOUT'
                    });
                  }
                }
              }
            }
          };

          res.on('finish', releaseConnection);
          res.on('close', releaseConnection);

          next();
        },
        timestamp: Date.now(),
        req,
        res
      };

      connectionQueue.push(queueItem);
      connectionStats.queuedRequests++;

      // Log queue status periodically
      if (connectionStats.queuedRequests % 10 === 0) {
        log('Connection pool queue growing', {
          activeConnections,
          queuedRequests: connectionStats.queuedRequests,
          maxConnections,
          totalRequests: connectionStats.totalRequests,
          timeouts: connectionStats.timeouts,
          peakActiveConnections: connectionStats.peakActiveConnections
        });
      }

      // Timeout queued connections (30 seconds)
      setTimeout(() => {
        const index = connectionQueue.findIndex(item => item === queueItem);
        if (index !== -1) {
          connectionQueue.splice(index, 1);
          connectionStats.queuedRequests--;
          connectionStats.timeouts++;

          if (!res.headersSent) {
            res.status(503).json({
              message: 'Connection pool timeout - server overloaded',
              error: 'CONNECTION_POOL_TIMEOUT',
              retryAfter: 30
            });
          }
        }
      }, 30000);
    }
  };
}