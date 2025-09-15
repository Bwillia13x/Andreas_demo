/**
 * Performance Targets and SLOs Configuration
 * Defines Service Level Objectives for the application
 */

export interface PerformanceTargets {
  // Response time targets (in milliseconds)
  responseTime: {
    p50: number;  // 50th percentile
    p95: number;  // 95th percentile
    p99: number;  // 99th percentile
  };

  // Error rate targets
  errorRate: {
    maxPercentage: number;  // Maximum error rate percentage
    windowMinutes: number;  // Time window for error rate calculation
  };

  // Throughput targets
  throughput: {
    minRequestsPerSecond: number;  // Minimum sustainable RPS
    maxRequestsPerSecond: number;  // Maximum expected RPS
  };

  // Resource usage targets
  resources: {
    maxMemoryUsagePercent: number;  // Maximum memory usage percentage
    maxCpuUsagePercent: number;     // Maximum CPU usage percentage
    maxDatabaseConnections: number; // Maximum database connections
  };

  // Client-side performance targets
  client: {
    firstContentfulPaint: number;    // Maximum FCP in milliseconds
    largestContentfulPaint: number;  // Maximum LCP in milliseconds
    firstInputDelay: number;         // Maximum FID in milliseconds
    cumulativeLayoutShift: number;   // Maximum CLS score
    bundleSizeLimitKb: number;       // Maximum bundle size in KB
  };

  // API endpoint specific targets
  endpoints: {
    [endpoint: string]: {
      maxResponseTime: number;  // Maximum response time for specific endpoint
      minRequestsPerSecond?: number; // Minimum throughput for endpoint
    };
  };
}

/**
 * Production performance targets
 * These represent our Service Level Objectives (SLOs)
 */
export const PRODUCTION_TARGETS: PerformanceTargets = {
  // Response time targets
  responseTime: {
    p50: 200,   // 200ms median response time
    p95: 500,   // 500ms 95th percentile
    p99: 1000   // 1000ms 99th percentile (1 second)
  },

  // Error rate targets
  errorRate: {
    maxPercentage: 1.0,  // Maximum 1% error rate
    windowMinutes: 5     // Measured over 5-minute windows
  },

  // Throughput targets
  throughput: {
    minRequestsPerSecond: 50,   // Handle at least 50 RPS
    maxRequestsPerSecond: 200   // Support up to 200 RPS
  },

  // Resource usage targets
  resources: {
    maxMemoryUsagePercent: 80,  // Use max 80% of available memory
    maxCpuUsagePercent: 70,     // Use max 70% of available CPU
    maxDatabaseConnections: 25  // Maximum 25 concurrent DB connections
  },

  // Client-side performance targets
  client: {
    firstContentfulPaint: 1800,     // FCP under 1.8 seconds
    largestContentfulPaint: 2500,   // LCP under 2.5 seconds
    firstInputDelay: 100,           // FID under 100ms
    cumulativeLayoutShift: 0.1,     // CLS score under 0.1
    bundleSizeLimitKb: 1000         // Bundle size under 1MB
  },

  // API endpoint specific targets
  endpoints: {
    '/api/health': {
      maxResponseTime: 100   // Health checks should be fast
    },
    '/api/services': {
      maxResponseTime: 300   // Service listings should be quick
    },
    '/api/appointments': {
      maxResponseTime: 500   // Appointment queries can be slower
    },
    '/api/analytics': {
      maxResponseTime: 1000  // Analytics can take longer
    },
    '/api/performance/metrics': {
      maxResponseTime: 200   // Metrics should be fast
    }
  }
};

/**
 * Staging performance targets (more lenient)
 */
export const STAGING_TARGETS: PerformanceTargets = {
  ...PRODUCTION_TARGETS,
  responseTime: {
    p50: 300,
    p95: 800,
    p99: 1500
  },
  errorRate: {
    maxPercentage: 2.0,
    windowMinutes: 5
  },
  throughput: {
    minRequestsPerSecond: 25,
    maxRequestsPerSecond: 100
  },
  resources: {
    maxMemoryUsagePercent: 85,
    maxCpuUsagePercent: 75,
    maxDatabaseConnections: 20
  },
  client: {
    ...PRODUCTION_TARGETS.client,
    bundleSizeLimitKb: 1200  // Allow larger bundles in staging
  }
};

/**
 * Development performance targets (most lenient)
 */
export const DEVELOPMENT_TARGETS: PerformanceTargets = {
  ...PRODUCTION_TARGETS,
  responseTime: {
    p50: 500,
    p95: 1500,
    p99: 3000
  },
  errorRate: {
    maxPercentage: 5.0,
    windowMinutes: 5
  },
  throughput: {
    minRequestsPerSecond: 10,
    maxRequestsPerSecond: 50
  },
  resources: {
    maxMemoryUsagePercent: 90,
    maxCpuUsagePercent: 80,
    maxDatabaseConnections: 15
  },
  client: {
    ...PRODUCTION_TARGETS.client,
    bundleSizeLimitKb: 1500  // Allow larger bundles in dev
  }
};

/**
 * Get performance targets based on environment
 */
export function getPerformanceTargets(): PerformanceTargets {
  const nodeEnv = process.env.NODE_ENV || 'development';

  switch (nodeEnv) {
    case 'production':
      return PRODUCTION_TARGETS;
    case 'staging':
      return STAGING_TARGETS;
    case 'development':
    default:
      return DEVELOPMENT_TARGETS;
  }
}

/**
 * Validate if current performance metrics meet targets
 */
export function validatePerformanceMetrics(
  metrics: {
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    errorRate: number;
    requestsPerSecond: number;
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    databaseConnections: number;
  },
  targets: PerformanceTargets = getPerformanceTargets()
): {
  passed: boolean;
  violations: string[];
  summary: {
    responseTime: boolean;
    errorRate: boolean;
    throughput: boolean;
    resources: boolean;
  };
} {
  const violations: string[] = [];

  // Check response times
  const responseTimePassed =
    metrics.p50ResponseTime <= targets.responseTime.p50 &&
    metrics.p95ResponseTime <= targets.responseTime.p95 &&
    metrics.p99ResponseTime <= targets.responseTime.p99;

  if (!responseTimePassed) {
    violations.push(
      `Response time targets not met: P50=${metrics.p50ResponseTime}ms (target: ${targets.responseTime.p50}ms), ` +
      `P95=${metrics.p95ResponseTime}ms (target: ${targets.responseTime.p95}ms), ` +
      `P99=${metrics.p99ResponseTime}ms (target: ${targets.responseTime.p99}ms)`
    );
  }

  // Check error rate
  const errorRatePassed = metrics.errorRate <= targets.errorRate.maxPercentage;
  if (!errorRatePassed) {
    violations.push(
      `Error rate target not met: ${metrics.errorRate}% (target: ${targets.errorRate.maxPercentage}%)`
    );
  }

  // Check throughput
  const throughputPassed =
    metrics.requestsPerSecond >= targets.throughput.minRequestsPerSecond &&
    metrics.requestsPerSecond <= targets.throughput.maxRequestsPerSecond;

  if (!throughputPassed) {
    violations.push(
      `Throughput target not met: ${metrics.requestsPerSecond} RPS ` +
      `(target range: ${targets.throughput.minRequestsPerSecond}-${targets.throughput.maxRequestsPerSecond} RPS)`
    );
  }

  // Check resource usage
  const resourcesPassed =
    metrics.memoryUsagePercent <= targets.resources.maxMemoryUsagePercent &&
    metrics.cpuUsagePercent <= targets.resources.maxCpuUsagePercent &&
    metrics.databaseConnections <= targets.resources.maxDatabaseConnections;

  if (!resourcesPassed) {
    violations.push(
      `Resource usage targets not met: Memory=${metrics.memoryUsagePercent}% (target: ${targets.resources.maxMemoryUsagePercent}%), ` +
      `CPU=${metrics.cpuUsagePercent}% (target: ${targets.resources.maxCpuUsagePercent}%), ` +
      `DB connections=${metrics.databaseConnections} (target: ${targets.resources.maxDatabaseConnections})`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
    summary: {
      responseTime: responseTimePassed,
      errorRate: errorRatePassed,
      throughput: throughputPassed,
      resources: resourcesPassed
    }
  };
}

/**
 * Generate load test configuration based on targets
 */
export function generateLoadTestConfig(targets: PerformanceTargets = getPerformanceTargets()) {
  return {
    // Test different load levels
    scenarios: [
      {
        name: 'baseline',
        duration: 60000, // 1 minute
        concurrency: 10,
        targetRPS: 20
      },
      {
        name: 'normal_load',
        duration: 120000, // 2 minutes
        concurrency: 25,
        targetRPS: targets.throughput.minRequestsPerSecond
      },
      {
        name: 'peak_load',
        duration: 180000, // 3 minutes
        concurrency: 50,
        targetRPS: Math.min(targets.throughput.maxRequestsPerSecond, targets.throughput.minRequestsPerSecond * 2)
      }
    ],

    // Target validation
    targets,

    // Test endpoints
    endpoints: [
      { path: '/api/health', weight: 0.3 },
      { path: '/api/services', weight: 0.2 },
      { path: '/api/staff', weight: 0.15 },
      { path: '/api/appointments', weight: 0.15 },
      { path: '/api/analytics', weight: 0.1 },
      { path: '/api/performance/metrics', weight: 0.1 }
    ],

    // Performance assertions
    assertions: {
      maxResponseTime: targets.responseTime.p95,
      maxErrorRate: targets.errorRate.maxPercentage,
      minRequestsPerSecond: targets.throughput.minRequestsPerSecond
    }
  };
}
