/**
 * Performance Test Suite
 * Integrates load testing framework with the test orchestrator
 */

import type { TestConfig } from '../config/test-config.js';
import { TestHttpClient, startTestServer, type TestEnvironment } from '../utils/test-environment.js';
import { createTestResult, type TestResult } from '../reporting/test-reporter.js';
import { 
  LoadTestingFramework, 
  createDefaultLoadTestConfig, 
  createDynamicLoadTestConfig,
  validateLoadTestResults,
  type LoadTestResult,
  type LoadTestConfig 
} from './load-testing-framework.js';
import { 
  ResponseTimeTester, 
  createDefaultResponseTimeConfig,
  type ResponseTimeTestConfig 
} from './response-time-testing.js';
import { 
  ResourceMonitor, 
  createDefaultResourceMonitoringConfig,
  type ResourceMonitoringConfig 
} from './resource-monitoring.js';

export interface PerformanceTestSuiteConfig {
  loadTest: {
    enabled: boolean;
    maxConcurrentUsers: number;
    rampUpDurationMs: number;
    sustainedDurationMs: number;
    requestsPerUser: number;
  };
  responseTimeTest: {
    enabled: boolean;
    endpoints: string[];
    iterations: number;
    includePageLoad: boolean;
    includeStreaming: boolean;
  };
  memoryTest: {
    enabled: boolean;
    durationMs: number;
    memoryThresholdMb: number;
  };
}

export class PerformanceTestSuite {
  private httpClient: TestHttpClient;
  private testEnvironment: TestEnvironment | null = null;

  constructor(
    private config: TestConfig,
    private suiteConfig: PerformanceTestSuiteConfig
  ) {
    this.httpClient = new TestHttpClient(''); // Will be set when server starts
  }

  /**
   * Execute all performance tests
   */
  async executeTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    console.log('🚀 Starting performance test suite...');
    
    try {
      // Start test server
      this.testEnvironment = await startTestServer(this.config);
      this.httpClient = new TestHttpClient(this.testEnvironment.baseUrl);
      
      // Set auth token for authenticated endpoints
      if (this.config.server.env.ADMIN_TOKEN) {
        this.httpClient.setAuthToken(this.config.server.env.ADMIN_TOKEN);
      }
      
      console.log(`✅ Test server started on ${this.testEnvironment.baseUrl}`);
      
      // Verify server is ready
      await this.verifyServerReady();
      
      // Execute load tests
      if (this.suiteConfig.loadTest.enabled) {
        results.push(...await this.executeLoadTests());
      }
      
      // Execute response time tests
      if (this.suiteConfig.responseTimeTest.enabled) {
        results.push(...await this.executeResponseTimeTests());
      }
      
      // Execute memory tests
      if (this.suiteConfig.memoryTest.enabled) {
        results.push(...await this.executeMemoryTests());
      }
      
      console.log('✅ Performance test suite completed');
      
    } catch (error) {
      console.error('❌ Performance test suite failed:', error);
      results.push(createTestResult(
        'performance',
        'suite-execution',
        'fail',
        0,
        {
          errors: [{
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          }]
        }
      ));
    } finally {
      // Clean up test environment
      if (this.testEnvironment) {
        await this.testEnvironment.cleanup();
      }
    }
    
    return results;
  }

  private async verifyServerReady(): Promise<void> {
    const maxAttempts = 10;
    const delayMs = 1000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const health = await this.httpClient.getJson('/api/health');
        if (health?.status === 'ok') {
          return;
        }
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Server not ready after ${maxAttempts} attempts: ${error}`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Execute load testing scenarios
   */
  private async executeLoadTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    console.log('\n📊 Executing load tests...');
    
    // Test 1: Gradual ramp-up load test
    results.push(await this.runTest('load-test-ramp-up', async () => {
      const loadConfig = await createDynamicLoadTestConfig(this.testEnvironment!.baseUrl);
      loadConfig.maxConcurrentUsers = this.suiteConfig.loadTest.maxConcurrentUsers;
      loadConfig.rampUpDurationMs = this.suiteConfig.loadTest.rampUpDurationMs;
      loadConfig.sustainedDurationMs = this.suiteConfig.loadTest.sustainedDurationMs;
      loadConfig.requestsPerUser = this.suiteConfig.loadTest.requestsPerUser;
      
      const framework = new LoadTestingFramework(loadConfig);
      const result = await framework.executeLoadTest();
      
      // Validate results
      const validation = validateLoadTestResults(result, loadConfig.thresholds);
      if (!validation.passed) {
        throw new Error(`Load test failed validation: ${validation.violations.join(', ')}`);
      }
      
      console.log(`✅ Load test passed: ${result.summary.totalRequests} requests, ` +
                 `${result.summary.averageResponseTime.toFixed(0)}ms avg response time, ` +
                 `${result.summary.errorRate.toFixed(1)}% error rate`);
      
      return { loadTestResult: result };
    }));
    
    // Test 2: Spike test (immediate high load)
    results.push(await this.runTest('load-test-spike', async () => {
      const loadConfig = await createDynamicLoadTestConfig(this.testEnvironment!.baseUrl);
      loadConfig.maxConcurrentUsers = Math.min(this.suiteConfig.loadTest.maxConcurrentUsers * 2, 100);
      
      const framework = new LoadTestingFramework(loadConfig);
      const result = await framework.executeConcurrentTest(
        loadConfig.maxConcurrentUsers,
        30000 // 30 seconds
      );
      
      // More lenient thresholds for spike test
      const spikeThresholds = {
        ...loadConfig.thresholds,
        maxResponseTimeMs: loadConfig.thresholds.maxResponseTimeMs * 2,
        maxErrorRate: loadConfig.thresholds.maxErrorRate * 2
      };
      
      const validation = validateLoadTestResults(result, spikeThresholds);
      if (!validation.passed) {
        console.warn(`⚠️  Spike test validation warnings: ${validation.violations.join(', ')}`);
      }
      
      console.log(`✅ Spike test completed: ${result.summary.totalRequests} requests, ` +
                 `${result.summary.averageResponseTime.toFixed(0)}ms avg response time`);
      
      return { spikeTestResult: result };
    }));
    
    // Test 3: Sustained load test (lower concurrency, longer duration)
    results.push(await this.runTest('load-test-sustained', async () => {
      const loadConfig = await createDynamicLoadTestConfig(this.testEnvironment!.baseUrl);
      loadConfig.maxConcurrentUsers = Math.max(10, Math.floor(this.suiteConfig.loadTest.maxConcurrentUsers / 2));
      
      const framework = new LoadTestingFramework(loadConfig);
      const result = await framework.executeConcurrentTest(
        loadConfig.maxConcurrentUsers,
        this.suiteConfig.loadTest.sustainedDurationMs * 2 // Double the sustained duration
      );
      
      const validation = validateLoadTestResults(result, loadConfig.thresholds);
      if (!validation.passed) {
        throw new Error(`Sustained load test failed: ${validation.violations.join(', ')}`);
      }
      
      console.log(`✅ Sustained load test passed: ${result.summary.totalRequests} requests over ${result.summary.duration}ms`);
      
      return { sustainedTestResult: result };
    }));
    
    return results;
  }

  /**
   * Execute response time and latency tests
   */
  private async executeResponseTimeTests(): Promise<TestResult[]> {
    console.log('\n⏱️  Executing response time tests...');
    
    // Create response time test configuration
    const responseTimeConfig = createDefaultResponseTimeConfig(this.testEnvironment!.baseUrl);
    
    // Override with suite configuration if provided
    if (this.suiteConfig.responseTimeTest.endpoints.length > 0) {
      responseTimeConfig.endpoints = this.suiteConfig.responseTimeTest.endpoints.map(path => ({
        path,
        method: 'GET' as const,
        description: `Response time test for ${path}`
      }));
    }
    
    responseTimeConfig.iterations = this.suiteConfig.responseTimeTest.iterations;
    
    // Configure optional tests based on suite configuration
    responseTimeConfig.pageLoadTest.enabled = this.suiteConfig.responseTimeTest.includePageLoad;
    responseTimeConfig.streamingTest.enabled = this.suiteConfig.responseTimeTest.includeStreaming;
    
    // Create and execute response time tester
    const responseTester = new ResponseTimeTester(this.testEnvironment!.baseUrl);
    const results = await responseTester.executeTests(responseTimeConfig);
    
    return results;
  }

  /**
   * Execute memory usage and resource monitoring tests
   */
  private async executeMemoryTests(): Promise<TestResult[]> {
    console.log('\n🧠 Executing memory and resource monitoring tests...');
    
    // Create resource monitoring configuration
    const resourceConfig = createDefaultResourceMonitoringConfig();
    
    // Override with suite configuration if provided
    resourceConfig.memoryTest.durationMs = this.suiteConfig.memoryTest.durationMs;
    resourceConfig.memoryTest.leakThresholdMb = this.suiteConfig.memoryTest.memoryThresholdMb / 60; // Convert to per-second rate
    
    // Create and execute resource monitor
    const resourceMonitor = new ResourceMonitor(resourceConfig, this.httpClient);
    const results = await resourceMonitor.executeTests();
    
    return results;
  }



  /**
   * Helper method to run a single test with error handling and timing
   */
  private async runTest(testName: string, testFn: () => Promise<any>): Promise<TestResult> {
    const startTime = Date.now();
    const startTimeIso = new Date().toISOString();

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      return createTestResult('performance', testName, 'pass', duration, {
        startTime: startTimeIso,
        endTime: new Date().toISOString(),
        result
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return createTestResult('performance', testName, 'fail', duration, {
        startTime: startTimeIso,
        endTime: new Date().toISOString(),
        errors: [{
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }]
      });
    }
  }
}

/**
 * Create default performance test suite configuration
 */
export function createDefaultPerformanceConfig(): PerformanceTestSuiteConfig {
  return {
    loadTest: {
      enabled: true,
      maxConcurrentUsers: 50,
      rampUpDurationMs: 30000, // 30 seconds
      sustainedDurationMs: 60000, // 60 seconds
      requestsPerUser: 100
    },
    responseTimeTest: {
      enabled: true,
      endpoints: [
        '/api/health',
        '/api/services',
        '/api/staff',
        '/api/appointments?day=today',
        '/api/customers',
        '/api/inventory',
        '/api/analytics',
        '/api/pos/sales',
        '/api/marketing/campaigns',
        '/api/loyalty/entries'
      ],
      iterations: 20,
      includePageLoad: true,
      includeStreaming: true
    },
    memoryTest: {
      enabled: true,
      durationMs: 60000, // 1 minute
      memoryThresholdMb: 100 // 100MB increase threshold
    }
  };
}