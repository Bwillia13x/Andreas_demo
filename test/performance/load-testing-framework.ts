/**
 * Load Testing Framework
 * Implements concurrent user simulation, gradual load increase, and sustained load testing
 */

import type { TestConfig } from '../config/test-config.js';
import { TestHttpClient, startTestServer, type TestEnvironment } from '../utils/test-environment.js';

export interface LoadTestConfig {
  baseUrl: string;
  maxConcurrentUsers: number;
  rampUpDurationMs: number;
  sustainedDurationMs: number;
  requestsPerUser: number;
  endpoints: LoadTestEndpoint[];
  thresholds: LoadTestThresholds;
}

export interface LoadTestEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  weight: number; // Relative frequency (1-10)
  body?: any;
  headers?: Record<string, string>;
}

export interface LoadTestThresholds {
  maxResponseTimeMs: number;
  maxErrorRate: number; // percentage
  minThroughput: number; // requests per second
}

export interface LoadTestResult {
  summary: LoadTestSummary;
  metrics: LoadTestMetrics[];
  errors: LoadTestError[];
  phases: LoadTestPhase[];
}

export interface LoadTestSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  averageResponseTime: number;
  medianResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number; // requests per second
  duration: number; // milliseconds
  concurrentUsers: number;
}

export interface LoadTestMetrics {
  timestamp: number;
  activeUsers: number;
  requestsPerSecond: number;
  averageResponseTime: number;
  errorRate: number;
  memoryUsage?: number;
}

export interface LoadTestError {
  timestamp: number;
  endpoint: string;
  method: string;
  error: string;
  responseTime?: number;
  statusCode?: number;
}

export interface LoadTestPhase {
  name: string;
  startTime: number;
  endTime: number;
  concurrentUsers: number;
  requests: number;
  errors: number;
  averageResponseTime: number;
}

/**
 * Virtual User class - simulates a single user's behavior
 */
class VirtualUser {
  private httpClient: TestHttpClient;
  private isActive = false;
  private requestCount = 0;
  private errors: LoadTestError[] = [];

  constructor(
    private userId: number,
    private config: LoadTestConfig,
    private onMetric: (metric: { timestamp: number; responseTime: number; success: boolean; endpoint: string; method: string; error?: string }) => void
  ) {
    // Initialize HTTP client with authentication token for load testing
    // Use the same token that's configured for the test server
    const authToken = process.env.ADMIN_TOKEN || 'test-admin-token-12345-secure';
    this.httpClient = new TestHttpClient(config.baseUrl, authToken);
  }

  async start(): Promise<void> {
    this.isActive = true;
    
    while (this.isActive && this.requestCount < this.config.requestsPerUser) {
      try {
        await this.makeRequest();
        this.requestCount++;
        
        // Random delay between requests (100-500ms)
        const delay = 100 + Math.random() * 400;
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        // Log error but continue making requests - don't let one error stop the entire user
        console.error(`User ${this.userId} unexpected error (continuing):`, error);
        this.requestCount++; // Still count it as an attempt
        
        // Add a longer delay after errors to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  stop(): void {
    this.isActive = false;
  }

  private async makeRequest(): Promise<void> {
    const endpoint = this.selectEndpoint();
    const startTime = Date.now();
    
    try {
      let response: Response;
      
      // Use endpoint-specific headers if provided
      const headers = endpoint.headers || {};
      
      switch (endpoint.method) {
        case 'GET':
          response = await this.httpClient.get(endpoint.path, headers);
          break;
        case 'POST':
          response = await this.httpClient.post(endpoint.path, endpoint.body || {}, headers);
          break;
        case 'PUT':
          response = await this.httpClient.put(endpoint.path, endpoint.body || {}, headers);
          break;
        case 'DELETE':
          response = await this.httpClient.delete(endpoint.path, headers);
          break;
        case 'PATCH':
          response = await this.httpClient.patch(endpoint.path, endpoint.body || {}, headers);
          break;
        default:
          throw new Error(`Unsupported method: ${endpoint.method}`);
      }
      
      const responseTime = Date.now() - startTime;
      const success = response.ok;
      
      this.onMetric({
        timestamp: startTime,
        responseTime,
        success,
        endpoint: endpoint.path,
        method: endpoint.method,
        error: success ? undefined : `HTTP ${response.status}`
      });
      
      if (!success) {
        this.errors.push({
          timestamp: startTime,
          endpoint: endpoint.path,
          method: endpoint.method,
          error: `HTTP ${response.status}`,
          responseTime,
          statusCode: response.status
        });
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Log detailed error information for debugging
      console.error(`Load test request failed: ${endpoint.method} ${endpoint.path}`, {
        error: errorMessage,
        userId: this.userId,
        responseTime,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      this.onMetric({
        timestamp: startTime,
        responseTime,
        success: false,
        endpoint: endpoint.path,
        method: endpoint.method,
        error: errorMessage
      });
      
      this.errors.push({
        timestamp: startTime,
        endpoint: endpoint.path,
        method: endpoint.method,
        error: errorMessage,
        responseTime
      });
    }
  }

  private selectEndpoint(): LoadTestEndpoint {
    // Weighted random selection
    const totalWeight = this.config.endpoints.reduce((sum, ep) => sum + ep.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const endpoint of this.config.endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        return endpoint;
      }
    }
    
    // Fallback to first endpoint
    return this.config.endpoints[0];
  }

  getErrors(): LoadTestError[] {
    return [...this.errors];
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

/**
 * Main Load Testing Framework
 */
export class LoadTestingFramework {
  private virtualUsers: VirtualUser[] = [];
  private metrics: LoadTestMetrics[] = [];
  private allErrors: LoadTestError[] = [];
  private phases: LoadTestPhase[] = [];
  private requestMetrics: Array<{ timestamp: number; responseTime: number; success: boolean; endpoint: string; method: string; error?: string }> = [];

  constructor(private config: LoadTestConfig) {}

  /**
   * Execute load test with gradual ramp-up and sustained load
   */
  async executeLoadTest(): Promise<LoadTestResult> {
    console.log('🚀 Starting load test...');
    console.log(`Target: ${this.config.maxConcurrentUsers} concurrent users`);
    console.log(`Ramp-up: ${this.config.rampUpDurationMs}ms`);
    console.log(`Sustained: ${this.config.sustainedDurationMs}ms`);
    
    const startTime = Date.now();
    
    try {
      // Phase 1: Gradual ramp-up
      await this.executeRampUpPhase(startTime);
      
      // Phase 2: Sustained load
      await this.executeSustainedPhase();
      
      // Phase 3: Ramp-down
      await this.executeRampDownPhase();
      
      const endTime = Date.now();
      
      return this.generateResults(startTime, endTime);
    } catch (error) {
      console.error('Load test execution failed:', error);
      throw error;
    } finally {
      // Ensure all users are stopped
      this.stopAllUsers();
    }
  }

  /**
   * Execute concurrent user simulation without ramp-up
   */
  async executeConcurrentTest(concurrentUsers: number, durationMs: number): Promise<LoadTestResult> {
    console.log(`🚀 Starting concurrent test with ${concurrentUsers} users for ${durationMs}ms`);
    
    const startTime = Date.now();
    
    try {
      // Start all users immediately
      await this.startUsers(concurrentUsers);
      
      // Monitor for specified duration
      await this.monitorTest(durationMs);
      
      const endTime = Date.now();
      
      return this.generateResults(startTime, endTime);
    } finally {
      this.stopAllUsers();
    }
  }

  private async executeRampUpPhase(startTime: number): Promise<void> {
    console.log('📈 Ramp-up phase starting...');
    const phaseStartTime = Date.now();
    
    const usersPerInterval = Math.max(1, Math.floor(this.config.maxConcurrentUsers / 10));
    const intervalMs = this.config.rampUpDurationMs / 10;
    
    for (let i = 0; i < 10; i++) {
      const usersToStart = Math.min(usersPerInterval, this.config.maxConcurrentUsers - this.virtualUsers.length);
      
      if (usersToStart > 0) {
        await this.startUsers(usersToStart);
        console.log(`  Active users: ${this.virtualUsers.length}/${this.config.maxConcurrentUsers}`);
      }
      
      if (this.virtualUsers.length >= this.config.maxConcurrentUsers) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    const phaseEndTime = Date.now();
    this.phases.push({
      name: 'ramp-up',
      startTime: phaseStartTime,
      endTime: phaseEndTime,
      concurrentUsers: this.virtualUsers.length,
      requests: this.getTotalRequests(),
      errors: this.allErrors.length,
      averageResponseTime: this.getAverageResponseTime()
    });
    
    console.log(`✅ Ramp-up complete: ${this.virtualUsers.length} active users`);
  }

  private async executeSustainedPhase(): Promise<void> {
    console.log('⏱️  Sustained load phase starting...');
    const phaseStartTime = Date.now();
    
    await this.monitorTest(this.config.sustainedDurationMs);
    
    const phaseEndTime = Date.now();
    this.phases.push({
      name: 'sustained',
      startTime: phaseStartTime,
      endTime: phaseEndTime,
      concurrentUsers: this.virtualUsers.length,
      requests: this.getTotalRequests(),
      errors: this.allErrors.length,
      averageResponseTime: this.getAverageResponseTime()
    });
    
    console.log('✅ Sustained load phase complete');
  }

  private async executeRampDownPhase(): Promise<void> {
    console.log('📉 Ramp-down phase starting...');
    const phaseStartTime = Date.now();
    
    // Gradually stop users
    const usersPerInterval = Math.max(1, Math.floor(this.virtualUsers.length / 5));
    const intervalMs = 2000; // 2 seconds between intervals
    
    for (let i = 0; i < 5 && this.virtualUsers.length > 0; i++) {
      const usersToStop = Math.min(usersPerInterval, this.virtualUsers.length);
      
      for (let j = 0; j < usersToStop; j++) {
        const user = this.virtualUsers.pop();
        if (user) {
          user.stop();
        }
      }
      
      console.log(`  Active users: ${this.virtualUsers.length}`);
      
      if (this.virtualUsers.length === 0) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    const phaseEndTime = Date.now();
    this.phases.push({
      name: 'ramp-down',
      startTime: phaseStartTime,
      endTime: phaseEndTime,
      concurrentUsers: 0,
      requests: this.getTotalRequests(),
      errors: this.allErrors.length,
      averageResponseTime: this.getAverageResponseTime()
    });
    
    console.log('✅ Ramp-down complete');
  }

  private async startUsers(count: number): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < count; i++) {
      const userId = this.virtualUsers.length + i + 1;
      const user = new VirtualUser(userId, this.config, (metric) => {
        this.requestMetrics.push(metric);
        if (!metric.success && metric.error) {
          this.allErrors.push({
            timestamp: metric.timestamp,
            endpoint: metric.endpoint,
            method: metric.method,
            error: metric.error,
            responseTime: metric.responseTime
          });
        }
      });
      
      this.virtualUsers.push(user);
      promises.push(user.start());
    }
    
    // Don't await all promises as users should run concurrently
    // Just start them and let them run
    promises.forEach(promise => {
      promise.catch(error => {
        console.error('Virtual user error:', error);
      });
    });
  }

  private async monitorTest(durationMs: number): Promise<void> {
    const startTime = Date.now();
    const endTime = startTime + durationMs;
    const intervalMs = 1000; // Collect metrics every second
    
    while (Date.now() < endTime) {
      const now = Date.now();
      const recentMetrics = this.requestMetrics.filter(m => now - m.timestamp < intervalMs);
      
      const metric: LoadTestMetrics = {
        timestamp: now,
        activeUsers: this.virtualUsers.length,
        requestsPerSecond: recentMetrics.length,
        averageResponseTime: recentMetrics.length > 0 
          ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length 
          : 0,
        errorRate: recentMetrics.length > 0 
          ? (recentMetrics.filter(m => !m.success).length / recentMetrics.length) * 100 
          : 0,
        memoryUsage: this.getMemoryUsage()
      };
      
      this.metrics.push(metric);
      
      // Log progress every 10 seconds
      if (this.metrics.length % 10 === 0) {
        console.log(`  Progress: ${Math.round(((now - startTime) / durationMs) * 100)}% | ` +
                   `RPS: ${metric.requestsPerSecond} | ` +
                   `Avg RT: ${metric.averageResponseTime.toFixed(0)}ms | ` +
                   `Errors: ${metric.errorRate.toFixed(1)}%`);
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  private stopAllUsers(): void {
    this.virtualUsers.forEach(user => user.stop());
    this.virtualUsers = [];
  }

  private getTotalRequests(): number {
    return this.requestMetrics.length;
  }

  private getAverageResponseTime(): number {
    if (this.requestMetrics.length === 0) return 0;
    return this.requestMetrics.reduce((sum, m) => sum + m.responseTime, 0) / this.requestMetrics.length;
  }

  private getMemoryUsage(): number {
    const usage = process.memoryUsage();
    return Math.round(usage.heapUsed / 1024 / 1024); // MB
  }

  private generateResults(startTime: number, endTime: number): LoadTestResult {
    const duration = endTime - startTime;
    const totalRequests = this.requestMetrics.length;
    const successfulRequests = this.requestMetrics.filter(m => m.success).length;
    const failedRequests = totalRequests - successfulRequests;
    
    // Calculate percentiles
    const responseTimes = this.requestMetrics.map(m => m.responseTime).sort((a, b) => a - b);
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);
    const medianIndex = Math.floor(responseTimes.length * 0.5);
    
    const summary: LoadTestSummary = {
      totalRequests,
      successfulRequests,
      failedRequests,
      errorRate: totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
      averageResponseTime: this.getAverageResponseTime(),
      medianResponseTime: responseTimes[medianIndex] || 0,
      p95ResponseTime: responseTimes[p95Index] || 0,
      p99ResponseTime: responseTimes[p99Index] || 0,
      throughput: duration > 0 ? (totalRequests / duration) * 1000 : 0, // requests per second
      duration,
      concurrentUsers: this.config.maxConcurrentUsers
    };
    
    return {
      summary,
      metrics: this.metrics,
      errors: this.allErrors,
      phases: this.phases
    };
  }
}

/**
 * Create default load test configuration for the platform
 */
export function createDefaultLoadTestConfig(baseUrl: string): LoadTestConfig {
  return {
    baseUrl,
    maxConcurrentUsers: 50,
    rampUpDurationMs: 30000, // 30 seconds
    sustainedDurationMs: 60000, // 60 seconds
    requestsPerUser: 100,
    endpoints: [
      { path: '/api/health', method: 'GET', weight: 10 },
      { path: '/api/services', method: 'GET', weight: 8 },
      { path: '/api/staff', method: 'GET', weight: 8 },
      { path: '/api/appointments?day=today', method: 'GET', weight: 7 },
      { path: '/api/customers', method: 'GET', weight: 6 },
      { path: '/api/inventory', method: 'GET', weight: 6 },
      { path: '/api/analytics', method: 'GET', weight: 5 },
      { path: '/api/pos/sales', method: 'GET', weight: 5 },
      { path: '/api/marketing/campaigns', method: 'GET', weight: 4 },
      { path: '/api/loyalty/entries', method: 'GET', weight: 4 },
      { path: '/api/marketing/performance', method: 'GET', weight: 3 },
      { path: '/api/profile', method: 'GET', weight: 2 },
      // Write operations (lower weight) - require authentication
      {
        path: '/api/marketing/campaigns',
        method: 'POST',
        weight: 1,
        body: {
          name: 'Load Test Campaign',
          description: 'Generated during load test',
          channel: 'email',
          status: 'draft'
        }
      }
    ],
    thresholds: {
      maxResponseTimeMs: 200,
      maxErrorRate: 1, // 1%
      minThroughput: 10 // 10 requests per second
    }
  };
}

/**
 * Create load test configuration with dynamic service IDs
 */
export async function createDynamicLoadTestConfig(baseUrl: string): Promise<LoadTestConfig> {
  const config = createDefaultLoadTestConfig(baseUrl);
  
  try {
    // Fetch available services to get real IDs (services endpoint is public)
    const httpClient = new TestHttpClient(baseUrl);
    const servicesResponse = await httpClient.get('/api/services');
    
    if (servicesResponse.ok) {
      const services = await servicesResponse.json();
      if (services.length > 0) {
        // Add POS sales endpoint with real service ID
        config.endpoints.push({
          path: '/api/pos/sales',
          method: 'POST',
          weight: 2,
          body: {
            items: [{ 
              kind: 'service', 
              id: services[0].id, 
              name: services[0].name, 
              quantity: 1 
            }],
            discountPct: 0,
            taxPct: 8.5
          }
        });
        
        console.log(`✅ Using service "${services[0].name}" (${services[0].id}) for load testing`);
      }
    } else {
      console.warn('⚠️ Could not fetch services, skipping POS sales endpoint in load test');
    }
  } catch (error) {
    console.warn('⚠️ Error fetching services for load test:', error);
  }
  
  return config;
}

/**
 * Validate load test results against thresholds
 */
export function validateLoadTestResults(result: LoadTestResult, thresholds: LoadTestThresholds): {
  passed: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  
  if (result.summary.averageResponseTime > thresholds.maxResponseTimeMs) {
    violations.push(`Average response time (${result.summary.averageResponseTime.toFixed(0)}ms) exceeds threshold (${thresholds.maxResponseTimeMs}ms)`);
  }
  
  if (result.summary.p95ResponseTime > thresholds.maxResponseTimeMs * 2) {
    violations.push(`95th percentile response time (${result.summary.p95ResponseTime.toFixed(0)}ms) exceeds threshold (${thresholds.maxResponseTimeMs * 2}ms)`);
  }
  
  if (result.summary.errorRate > thresholds.maxErrorRate) {
    violations.push(`Error rate (${result.summary.errorRate.toFixed(1)}%) exceeds threshold (${thresholds.maxErrorRate}%)`);
  }
  
  if (result.summary.throughput < thresholds.minThroughput) {
    violations.push(`Throughput (${result.summary.throughput.toFixed(1)} RPS) below threshold (${thresholds.minThroughput} RPS)`);
  }
  
  return {
    passed: violations.length === 0,
    violations
  };
}