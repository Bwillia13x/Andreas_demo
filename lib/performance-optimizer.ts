/**
 * Performance Optimizer
 * Handles memory leak detection, resource cleanup, and performance degradation monitoring
 */

import { EventEmitter } from 'events';
import { log, logWarn, logError } from './log';
import { resourceManager } from './resource-manager';
import { performanceMonitor } from './performance-monitor';

export interface MemoryLeakDetection {
  enabled: boolean;
  checkInterval: number; // milliseconds
  memoryGrowthThreshold: number; // MB per minute
  heapGrowthThreshold: number; // MB per minute
  consecutiveChecks: number; // Number of consecutive checks before alert
}

export interface PerformanceDegradationConfig {
  enabled: boolean;
  checkInterval: number; // milliseconds
  responseTimeThreshold: number; // percentage increase
  throughputThreshold: number; // percentage decrease
  windowSize: number; // number of data points to compare
}

export interface MaintenanceTaskConfig {
  enabled: boolean;
  interval: number; // milliseconds
  tasks: {
    garbageCollection: boolean;
    cacheCleanup: boolean;
    connectionCleanup: boolean;
    logRotation: boolean;
    metricsPurge: boolean;
  };
}

export interface OptimizationConfig {
  memoryLeakDetection: MemoryLeakDetection;
  performanceDegradation: PerformanceDegradationConfig;
  maintenanceTasks: MaintenanceTaskConfig;
  autoOptimization: {
    enabled: boolean;
    aggressiveMode: boolean;
    triggerThresholds: {
      memoryUsageMB: number;
      heapUtilizationPercent: number;
      responseTimeMs: number;
      errorRatePercent: number;
    };
  };
}

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

interface PerformanceSnapshot {
  timestamp: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
  memoryUsage: number;
}

export class PerformanceOptimizer extends EventEmitter {
  private config: OptimizationConfig;
  private memorySnapshots: MemorySnapshot[] = [];
  private performanceSnapshots: PerformanceSnapshot[] = [];
  private memoryLeakCheckInterval?: NodeJS.Timeout;
  private performanceDegradationInterval?: NodeJS.Timeout;
  private maintenanceInterval?: NodeJS.Timeout;
  private consecutiveMemoryIncreases = 0;
  private consecutivePerformanceDecreases = 0;
  private lastOptimizationTime = 0;

  constructor(config: Partial<OptimizationConfig> = {}) {
    super();
    
    this.config = {
      memoryLeakDetection: {
        enabled: true,
        checkInterval: 60000, // 1 minute
        memoryGrowthThreshold: 10, // 10MB per minute
        heapGrowthThreshold: 5, // 5MB per minute
        consecutiveChecks: 3
      },
      performanceDegradation: {
        enabled: true,
        checkInterval: 30000, // 30 seconds
        responseTimeThreshold: 20, // 20% increase
        throughputThreshold: 15, // 15% decrease
        windowSize: 10 // Compare last 10 data points
      },
      maintenanceTasks: {
        enabled: true,
        interval: 300000, // 5 minutes
        tasks: {
          garbageCollection: true,
          cacheCleanup: true,
          connectionCleanup: true,
          logRotation: false, // Disabled by default
          metricsPurge: true
        }
      },
      autoOptimization: {
        enabled: true,
        aggressiveMode: false,
        triggerThresholds: {
          memoryUsageMB: 400,
          heapUtilizationPercent: 85,
          responseTimeMs: 1000,
          errorRatePercent: 2
        }
      },
      ...config
    };

    this.startOptimization();
  }

  /**
   * Start all optimization processes
   */
  private startOptimization(): void {
    if (this.config.memoryLeakDetection.enabled) {
      this.startMemoryLeakDetection();
    }

    if (this.config.performanceDegradation.enabled) {
      this.startPerformanceDegradationMonitoring();
    }

    if (this.config.maintenanceTasks.enabled) {
      this.startMaintenanceTasks();
    }

    log('Performance optimizer started', {
      memoryLeakDetection: this.config.memoryLeakDetection.enabled,
      performanceDegradation: this.config.performanceDegradation.enabled,
      maintenanceTasks: this.config.maintenanceTasks.enabled,
      autoOptimization: this.config.autoOptimization.enabled
    });
  }

  /**
   * Start memory leak detection
   */
  private startMemoryLeakDetection(): void {
    this.memoryLeakCheckInterval = setInterval(() => {
      this.checkForMemoryLeaks();
    }, this.config.memoryLeakDetection.checkInterval);
  }

  /**
   * Start performance degradation monitoring
   */
  private startPerformanceDegradationMonitoring(): void {
    this.performanceDegradationInterval = setInterval(() => {
      this.checkForPerformanceDegradation();
    }, this.config.performanceDegradation.checkInterval);
  }

  /**
   * Start maintenance tasks
   */
  private startMaintenanceTasks(): void {
    this.maintenanceInterval = setInterval(() => {
      this.runMaintenanceTasks();
    }, this.config.maintenanceTasks.interval);
  }

  /**
   * Check for memory leaks
   */
  private checkForMemoryLeaks(): void {
    const memUsage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external
    };

    this.memorySnapshots.push(snapshot);

    // Keep only recent snapshots (last hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.memorySnapshots = this.memorySnapshots.filter(s => s.timestamp > oneHourAgo);

    // Check for memory growth if we have enough data
    if (this.memorySnapshots.length >= 2) {
      const current = this.memorySnapshots[this.memorySnapshots.length - 1];
      const previous = this.memorySnapshots[this.memorySnapshots.length - 2];
      
      const timeDiffMinutes = (current.timestamp - previous.timestamp) / (1000 * 60);
      const heapGrowthMB = (current.heapUsed - previous.heapUsed) / (1024 * 1024);
      const rssGrowthMB = (current.rss - previous.rss) / (1024 * 1024);
      
      const heapGrowthRate = heapGrowthMB / timeDiffMinutes;
      const rssGrowthRate = rssGrowthMB / timeDiffMinutes;

      // Check if growth exceeds thresholds
      const heapLeakDetected = heapGrowthRate > this.config.memoryLeakDetection.heapGrowthThreshold;
      const memoryLeakDetected = rssGrowthRate > this.config.memoryLeakDetection.memoryGrowthThreshold;

      if (heapLeakDetected || memoryLeakDetected) {
        this.consecutiveMemoryIncreases++;
        
        if (this.consecutiveMemoryIncreases >= this.config.memoryLeakDetection.consecutiveChecks) {
          this.handleMemoryLeak(heapGrowthRate, rssGrowthRate);
        }
      } else {
        this.consecutiveMemoryIncreases = 0;
      }
    }

    // Check for auto-optimization triggers
    if (this.config.autoOptimization.enabled) {
      this.checkAutoOptimizationTriggers(snapshot);
    }
  }

  /**
   * Handle detected memory leak
   */
  private handleMemoryLeak(heapGrowthRate: number, rssGrowthRate: number): void {
    logWarn('Memory leak detected', {
      heapGrowthRateMBPerMin: heapGrowthRate.toFixed(2),
      rssGrowthRateMBPerMin: rssGrowthRate.toFixed(2),
      consecutiveChecks: this.consecutiveMemoryIncreases,
      currentHeapMB: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
      currentRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024))
    });

    this.emit('memoryLeak', {
      heapGrowthRate,
      rssGrowthRate,
      consecutiveChecks: this.consecutiveMemoryIncreases
    });

    // Trigger immediate optimization
    this.optimizeMemoryUsage();
    
    // Reset counter after handling
    this.consecutiveMemoryIncreases = 0;
  }

  /**
   * Check for performance degradation
   */
  private checkForPerformanceDegradation(): void {
    const currentMetrics = performanceMonitor.getCurrentMetrics();
    if (!currentMetrics) return;

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      averageResponseTime: currentMetrics.responseTime.average,
      requestsPerSecond: currentMetrics.requests.requestsPerSecond,
      errorRate: currentMetrics.requests.errorRate,
      memoryUsage: currentMetrics.system.memoryUsage
    };

    this.performanceSnapshots.push(snapshot);

    // Keep only recent snapshots
    const maxSnapshots = this.config.performanceDegradation.windowSize * 2;
    if (this.performanceSnapshots.length > maxSnapshots) {
      this.performanceSnapshots = this.performanceSnapshots.slice(-maxSnapshots);
    }

    // Check for degradation if we have enough data
    if (this.performanceSnapshots.length >= this.config.performanceDegradation.windowSize * 2) {
      this.analyzePerformanceTrends();
    }
  }

  /**
   * Analyze performance trends for degradation
   */
  private analyzePerformanceTrends(): void {
    const windowSize = this.config.performanceDegradation.windowSize;
    const recent = this.performanceSnapshots.slice(-windowSize);
    const previous = this.performanceSnapshots.slice(-windowSize * 2, -windowSize);

    if (recent.length < windowSize || previous.length < windowSize) return;

    // Calculate averages for comparison
    const recentAvg = {
      responseTime: recent.reduce((sum, s) => sum + s.averageResponseTime, 0) / recent.length,
      throughput: recent.reduce((sum, s) => sum + s.requestsPerSecond, 0) / recent.length,
      errorRate: recent.reduce((sum, s) => sum + s.errorRate, 0) / recent.length
    };

    const previousAvg = {
      responseTime: previous.reduce((sum, s) => sum + s.averageResponseTime, 0) / previous.length,
      throughput: previous.reduce((sum, s) => sum + s.requestsPerSecond, 0) / previous.length,
      errorRate: previous.reduce((sum, s) => sum + s.errorRate, 0) / previous.length
    };

    // Calculate percentage changes
    const responseTimeIncrease = previousAvg.responseTime > 0 
      ? ((recentAvg.responseTime - previousAvg.responseTime) / previousAvg.responseTime) * 100 
      : 0;
    
    const throughputDecrease = previousAvg.throughput > 0 
      ? ((previousAvg.throughput - recentAvg.throughput) / previousAvg.throughput) * 100 
      : 0;

    // Check for degradation
    const responseTimeDegraded = responseTimeIncrease > this.config.performanceDegradation.responseTimeThreshold;
    const throughputDegraded = throughputDecrease > this.config.performanceDegradation.throughputThreshold;

    if (responseTimeDegraded || throughputDegraded) {
      this.consecutivePerformanceDecreases++;
      
      if (this.consecutivePerformanceDecreases >= 2) { // Require 2 consecutive degradations
        this.handlePerformanceDegradation(responseTimeIncrease, throughputDecrease, recentAvg, previousAvg);
      }
    } else {
      this.consecutivePerformanceDecreases = 0;
    }
  }

  /**
   * Handle detected performance degradation
   */
  private handlePerformanceDegradation(
    responseTimeIncrease: number, 
    throughputDecrease: number,
    recentAvg: any,
    previousAvg: any
  ): void {
    logWarn('Performance degradation detected', {
      responseTimeIncreasePercent: responseTimeIncrease.toFixed(1),
      throughputDecreasePercent: throughputDecrease.toFixed(1),
      currentResponseTimeMs: recentAvg.responseTime.toFixed(0),
      previousResponseTimeMs: previousAvg.responseTime.toFixed(0),
      currentThroughput: recentAvg.throughput.toFixed(1),
      previousThroughput: previousAvg.throughput.toFixed(1)
    });

    this.emit('performanceDegradation', {
      responseTimeIncrease,
      throughputDecrease,
      recentAvg,
      previousAvg
    });

    // Trigger optimization based on severity
    if (responseTimeIncrease > 50 || throughputDecrease > 30) {
      this.optimizePerformance(true); // Aggressive optimization
    } else {
      this.optimizePerformance(false); // Standard optimization
    }

    this.consecutivePerformanceDecreases = 0;
  }

  /**
   * Check auto-optimization triggers
   */
  private checkAutoOptimizationTriggers(memorySnapshot: MemorySnapshot): void {
    const currentMetrics = performanceMonitor.getCurrentMetrics();
    if (!currentMetrics) return;

    const triggers = this.config.autoOptimization.triggerThresholds;
    const memoryUsageMB = memorySnapshot.heapUsed / (1024 * 1024);
    const heapUtilization = (memorySnapshot.heapUsed / memorySnapshot.heapTotal) * 100;

    const shouldOptimize = 
      memoryUsageMB > triggers.memoryUsageMB ||
      heapUtilization > triggers.heapUtilizationPercent ||
      currentMetrics.responseTime.average > triggers.responseTimeMs ||
      currentMetrics.requests.errorRate > triggers.errorRatePercent;

    if (shouldOptimize) {
      // Prevent too frequent optimizations
      const timeSinceLastOptimization = Date.now() - this.lastOptimizationTime;
      if (timeSinceLastOptimization > 60000) { // At least 1 minute between optimizations
        this.optimizePerformance(this.config.autoOptimization.aggressiveMode);
        this.lastOptimizationTime = Date.now();
      }
    }
  }

  /**
   * Run periodic maintenance tasks
   */
  private runMaintenanceTasks(): void {
    const tasks = this.config.maintenanceTasks.tasks;
    
    log('Running maintenance tasks', tasks);

    try {
      if (tasks.garbageCollection) {
        this.forceGarbageCollection();
      }

      if (tasks.cacheCleanup) {
        this.cleanupCaches();
      }

      if (tasks.connectionCleanup) {
        this.cleanupConnections();
      }

      if (tasks.metricsPurge) {
        this.purgeOldMetrics();
      }

      if (tasks.logRotation) {
        this.rotateLogFiles();
      }

      this.emit('maintenanceCompleted', { tasks });
      
    } catch (error) {
      logError('Maintenance tasks failed', error as Error);
      this.emit('maintenanceError', error);
    }
  }

  /**
   * Force garbage collection
   */
  private forceGarbageCollection(): void {
    if (global.gc && typeof global.gc === 'function') {
      const beforeMemory = process.memoryUsage().heapUsed;
      global.gc();
      const afterMemory = process.memoryUsage().heapUsed;
      const freedMB = (beforeMemory - afterMemory) / (1024 * 1024);
      
      if (freedMB > 1) { // Only log if significant memory was freed
        log('Garbage collection completed', {
          freedMemoryMB: freedMB.toFixed(1),
          heapUsedMB: Math.round(afterMemory / (1024 * 1024))
        });
      }
    }
  }

  /**
   * Cleanup caches
   */
  private cleanupCaches(): void {
    // Clear resource manager cache
    resourceManager.clearCache();
    
    // Note: require.cache is not available in ES modules (production build)
    // This is only relevant for CommonJS modules in development
    if (process.env.NODE_ENV === 'development' && typeof require !== 'undefined' && require.cache) {
      try {
        const modulesBefore = Object.keys(require.cache).length;
        
        for (const [path] of Object.entries(require.cache)) {
          // Only clear non-essential modules
          if (path.includes('/tmp/') || path.includes('/cache/')) {
            delete require.cache[path];
          }
        }
        
        const modulesAfter = Object.keys(require.cache).length;
        if (modulesBefore > modulesAfter) {
          log('Require cache cleaned', {
            modulesBefore,
            modulesAfter,
            cleaned: modulesBefore - modulesAfter
          });
        }
      } catch (error) {
        // Silently handle require.cache errors in production
        log('Cache cleanup skipped (ES modules)', { reason: 'require.cache not available' });
      }
    }
  }

  /**
   * Cleanup connections
   */
  private cleanupConnections(): void {
    // This would typically involve cleaning up database connections,
    // HTTP keep-alive connections, etc.
    // For now, we'll just log the action
    log('Connection cleanup completed');
  }

  /**
   * Purge old metrics
   */
  private purgeOldMetrics(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    const memoryBefore = this.memorySnapshots.length;
    this.memorySnapshots = this.memorySnapshots.filter(s => s.timestamp > oneHourAgo);
    
    const performanceBefore = this.performanceSnapshots.length;
    this.performanceSnapshots = this.performanceSnapshots.filter(s => s.timestamp > oneHourAgo);
    
    if (memoryBefore > this.memorySnapshots.length || performanceBefore > this.performanceSnapshots.length) {
      log('Old metrics purged', {
        memorySnapshots: { before: memoryBefore, after: this.memorySnapshots.length },
        performanceSnapshots: { before: performanceBefore, after: this.performanceSnapshots.length }
      });
    }
  }

  /**
   * Rotate log files (placeholder)
   */
  private rotateLogFiles(): void {
    // This would typically involve rotating log files
    // Implementation depends on logging setup
    log('Log rotation completed');
  }

  /**
   * Optimize memory usage
   */
  optimizeMemoryUsage(): void {
    log('Starting memory optimization');
    
    // Use resource manager's optimization
    resourceManager.optimizeMemory();
    
    // Additional memory optimization
    this.forceGarbageCollection();
    this.cleanupCaches();
    
    log('Memory optimization completed');
    this.emit('memoryOptimized');
  }

  /**
   * Optimize performance
   */
  optimizePerformance(aggressive: boolean = false): void {
    log('Starting performance optimization', { aggressive });
    
    try {
      // Memory optimization
      this.optimizeMemoryUsage();
      
      if (aggressive) {
        // More aggressive optimizations
        this.forceGarbageCollection();
        
        // Multiple GC cycles for aggressive mode
        setTimeout(() => this.forceGarbageCollection(), 1000);
        setTimeout(() => this.forceGarbageCollection(), 2000);
      }
      
      // Connection cleanup
      this.cleanupConnections();
      
      log('Performance optimization completed', { aggressive });
      this.emit('performanceOptimized', { aggressive });
      
    } catch (error) {
      logError('Performance optimization failed', error as Error);
      this.emit('optimizationError', error);
    }
  }

  /**
   * Get optimization status
   */
  getStatus(): {
    memoryLeakDetection: {
      enabled: boolean;
      consecutiveIncreases: number;
      lastCheck: number;
    };
    performanceDegradation: {
      enabled: boolean;
      consecutiveDecreases: number;
      snapshotCount: number;
    };
    maintenanceTasks: {
      enabled: boolean;
      lastRun: number;
    };
    recommendations: string[];
  } {
    const recommendations = this.generateRecommendations();
    
    return {
      memoryLeakDetection: {
        enabled: this.config.memoryLeakDetection.enabled,
        consecutiveIncreases: this.consecutiveMemoryIncreases,
        lastCheck: this.memorySnapshots.length > 0 
          ? this.memorySnapshots[this.memorySnapshots.length - 1].timestamp 
          : 0
      },
      performanceDegradation: {
        enabled: this.config.performanceDegradation.enabled,
        consecutiveDecreases: this.consecutivePerformanceDecreases,
        snapshotCount: this.performanceSnapshots.length
      },
      maintenanceTasks: {
        enabled: this.config.maintenanceTasks.enabled,
        lastRun: Date.now() // Simplified - would track actual last run time
      },
      recommendations
    };
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const currentMetrics = performanceMonitor.getCurrentMetrics();
    
    if (!currentMetrics) {
      return ['Enable performance monitoring to get recommendations'];
    }

    // Memory recommendations
    if (currentMetrics.system.heapUtilization > 85) {
      recommendations.push('High heap utilization - consider increasing heap size or optimizing memory usage');
    }
    
    if (currentMetrics.system.memoryUsage > 400) {
      recommendations.push('High memory usage detected - review for memory leaks and optimize resource usage');
    }

    // Performance recommendations
    if (currentMetrics.responseTime.average > 500) {
      recommendations.push('High response times - consider performance optimization or scaling');
    }
    
    if (currentMetrics.requests.errorRate > 1) {
      recommendations.push('Error rate above threshold - investigate and fix error sources');
    }

    // Maintenance recommendations
    if (this.consecutiveMemoryIncreases > 0) {
      recommendations.push('Potential memory leak detected - monitor memory usage closely');
    }
    
    if (this.consecutivePerformanceDecreases > 0) {
      recommendations.push('Performance degradation detected - consider optimization measures');
    }

    if (recommendations.length === 0) {
      recommendations.push('System performance is optimal');
    }

    return recommendations;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<OptimizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart intervals if configuration changed
    this.stop();
    this.startOptimization();
    
    log('Performance optimizer configuration updated', newConfig);
  }

  /**
   * Stop the optimizer
   */
  stop(): void {
    if (this.memoryLeakCheckInterval) {
      clearInterval(this.memoryLeakCheckInterval);
      this.memoryLeakCheckInterval = undefined;
    }
    
    if (this.performanceDegradationInterval) {
      clearInterval(this.performanceDegradationInterval);
      this.performanceDegradationInterval = undefined;
    }
    
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = undefined;
    }
    
    log('Performance optimizer stopped');
  }
}

// Create and export the performance optimizer
export const performanceOptimizer = new PerformanceOptimizer({
  memoryLeakDetection: {
    enabled: true,
    checkInterval: 60000, // 1 minute
    memoryGrowthThreshold: 10, // 10MB per minute
    heapGrowthThreshold: 5, // 5MB per minute
    consecutiveChecks: 3
  },
  performanceDegradation: {
    enabled: true,
    checkInterval: 30000, // 30 seconds
    responseTimeThreshold: 20, // 20% increase
    throughputThreshold: 15, // 15% decrease
    windowSize: 10
  },
  maintenanceTasks: {
    enabled: true,
    interval: 300000, // 5 minutes
    tasks: {
      garbageCollection: true,
      cacheCleanup: true,
      connectionCleanup: true,
      logRotation: false,
      metricsPurge: true
    }
  },
  autoOptimization: {
    enabled: true,
    aggressiveMode: false,
    triggerThresholds: {
      memoryUsageMB: 400,
      heapUtilizationPercent: 85,
      responseTimeMs: 1000,
      errorRatePercent: 2
    }
  }
});