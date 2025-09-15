/**
 * Test Orchestrator - Central coordination of all testing activities
 * Manages test execution, environment setup, and result aggregation
 */

import type { TestConfig, TestSuite } from '../config/test-config.js';
import { TestReporter, type TestSuiteResult, createTestSuiteResult, createTestResult } from '../reporting/test-reporter.js';
import { startTestServer, TestHttpClient, TestDataManager, PerformanceMonitor, type TestEnvironment } from '../utils/test-environment.js';

export interface TestExecutionOptions {
  suites?: string[]; // Specific suites to run, if not provided runs all enabled
  verbose?: boolean;
  bail?: boolean; // Stop on first failure
  parallel?: boolean; // Run suites in parallel (when safe)
}

export interface TestExecutionResult {
  success: boolean;
  report: any;
  savedReports: string[];
  duration: number;
}

/**
 * Main test orchestrator class
 */
export class TestOrchestrator {
  private reporter: TestReporter;
  private performanceMonitor: PerformanceMonitor;

  constructor(private config: TestConfig) {
    this.reporter = new TestReporter(config);
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Execute all configured test suites
   */
  async executeTests(options: TestExecutionOptions = {}): Promise<TestExecutionResult> {
    const startTime = Date.now();
    console.log('🚀 Starting test execution...');
    console.log(`Environment: ${this.config.environment}`);
    
    let testEnvironment: TestEnvironment | null = null;
    let success = true;

    try {
      // Start test server
      console.log('📡 Starting test server...');
      testEnvironment = await startTestServer(this.config);
      console.log(`✅ Server started on ${testEnvironment.baseUrl}`);

      // Initialize test utilities
      const httpClient = new TestHttpClient(testEnvironment.baseUrl);
      // Set auth token from test configuration if available
      if (this.config.server.env.ADMIN_TOKEN) {
        httpClient.setAuthToken(this.config.server.env.ADMIN_TOKEN);
      }
      const dataManager = new TestDataManager(httpClient);

      // Verify server health
      await dataManager.getHealthStatus();
      console.log('✅ Server health check passed');

      // Get suites to execute
      const suitesToRun = this.getSuitesToRun(options.suites);
      console.log(`📋 Executing ${suitesToRun.length} test suite(s): ${suitesToRun.map(s => s.name).join(', ')}`);

      // Execute test suites
      for (const suite of suitesToRun) {
        try {
          console.log(`\n🧪 Running ${suite.name} (${suite.type})...`);
          const suiteResult = await this.executeSuite(suite, httpClient, dataManager, options);
          this.reporter.addSuiteResult(suiteResult);
          
          const passRate = suiteResult.summary.passRate;
          const status = passRate === 100 ? '✅' : passRate >= 90 ? '⚠️' : '❌';
          console.log(`${status} ${suite.name}: ${suiteResult.summary.passed}/${suiteResult.summary.totalTests} passed (${passRate.toFixed(1)}%)`);

          if (suiteResult.summary.failed > 0 && options.bail) {
            console.log('🛑 Stopping execution due to failures (bail mode)');
            success = false;
            break;
          }

          if (suiteResult.summary.failed > 0) {
            success = false;
          }
        } catch (error) {
          console.error(`❌ Suite ${suite.name} failed to execute:`, error);
          success = false;
          
          if (options.bail) {
            break;
          }
        }
      }

      // Add performance metrics to report
      this.reporter.addPerformanceMetrics(this.performanceMonitor.getMetrics());

    } catch (error) {
      console.error('❌ Test execution failed:', error);
      success = false;
    } finally {
      // Clean up test environment
      if (testEnvironment) {
        console.log('🧹 Cleaning up test environment...');
        await testEnvironment.cleanup();
      }
    }

    // Generate and save reports
    const report = this.reporter.generateReport();
    const savedReports = await this.reporter.saveReport(report);
    
    const duration = Date.now() - startTime;
    console.log(`\n📊 Test execution completed in ${(duration / 1000).toFixed(1)}s`);
    console.log(`📈 Production readiness score: ${report.readinessScore}%`);
    console.log(`📄 Reports saved: ${savedReports.join(', ')}`);

    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach(rec => console.log(`   • ${rec}`));
    }

    return {
      success,
      report,
      savedReports,
      duration
    };
  }

  /**
   * Get list of test suites to run based on configuration and options
   */
  private getSuitesToRun(requestedSuites?: string[]): TestSuite[] {
    const enabledSuites = this.config.testSuites.filter(suite => suite.enabled);
    
    if (requestedSuites && requestedSuites.length > 0) {
      return enabledSuites.filter(suite => requestedSuites.includes(suite.name));
    }
    
    return enabledSuites;
  }

  /**
   * Execute a single test suite
   */
  private async executeSuite(
    suite: TestSuite,
    httpClient: TestHttpClient,
    dataManager: TestDataManager,
    options: TestExecutionOptions
  ): Promise<TestSuiteResult> {
    const startTime = new Date().toISOString();
    const tests = [];

    try {
      switch (suite.name) {
        case 'smoke-tests':
          tests.push(...await this.runSmokeTests(httpClient, dataManager, suite));
          break;
        case 'api-tests':
          tests.push(...await this.runApiTests(httpClient, dataManager, suite));
          break;
        case 'e2e-tests':
          tests.push(...await this.runE2eTests(httpClient, dataManager, suite));
          break;
        case 'performance-tests':
          tests.push(...await this.runPerformanceTests(httpClient, dataManager, suite));
          break;
        case 'security-tests':
          tests.push(...await this.runSecurityTests(httpClient, dataManager, suite));
          break;
        default:
          console.warn(`Unknown test suite: ${suite.name}`);
      }
    } catch (error) {
      console.error(`Error executing suite ${suite.name}:`, error);
      tests.push(createTestResult(
        suite.type,
        `${suite.name}-execution`,
        'fail',
        0,
        {
          errors: [{
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          }]
        }
      ));
    }

    const endTime = new Date().toISOString();
    return createTestSuiteResult(suite.name, suite.type, tests, {
      startTime,
      endTime,
      config: suite.config
    });
  }

  /**
   * Run smoke tests (enhanced version of existing smoke.ts)
   */
  private async runSmokeTests(httpClient: TestHttpClient, dataManager: TestDataManager, suite: TestSuite) {
    const tests = [];

    // Health check test
    tests.push(await this.runTest('health-check', async () => {
      const health = await httpClient.getJson('/api/health');
      if (health?.status !== 'ok') {
        throw new Error('Health check failed');
      }
      if (typeof health.aiDemoMode === 'undefined') {
        throw new Error('Health missing aiDemoMode');
      }
    }));

    // Core data endpoints
    tests.push(await this.runTest('services-endpoint', async () => {
      const services = await httpClient.getJson('/api/services');
      if (!Array.isArray(services) || services.length === 0) {
        throw new Error('Services endpoint returned invalid data');
      }
    }));

    tests.push(await this.runTest('staff-endpoint', async () => {
      const staff = await httpClient.getJson('/api/staff');
      if (!Array.isArray(staff) || staff.length === 0) {
        throw new Error('Staff endpoint returned invalid data');
      }
    }));

    tests.push(await this.runTest('appointments-endpoint', async () => {
      const appointments = await httpClient.getJson('/api/appointments?day=today');
      if (!Array.isArray(appointments)) {
        throw new Error('Appointments endpoint returned invalid data');
      }
    }));

    // CSV export functionality
    tests.push(await this.runTest('csv-export', async () => {
      const response = await httpClient.get('/api/analytics/export');
      if (!response.ok) {
        throw new Error('CSV export failed');
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/csv')) {
        throw new Error('CSV export wrong content-type');
      }
      const csvText = await response.text();
      if (!csvText.includes('totalRevenue')) {
        throw new Error('CSV export missing expected headers');
      }
    }));

    // Chat functionality
    tests.push(await this.runTest('chat-non-streaming', async () => {
      const chat = await httpClient.postJson('/api/chat', {
        messages: [{ role: 'user', content: 'What is our schedule today?' }],
        stream: false
      });
      if (!chat?.message) {
        throw new Error('Chat response missing message');
      }
    }));

    tests.push(await this.runTest('chat-streaming', async () => {
      const streamed = await httpClient.streamSSE('/api/chat', {
        messages: [{ role: 'user', content: 'Stream a quick summary.' }],
        stream: true
      });
      if (!streamed || streamed.length < 10) {
        throw new Error('SSE chat response too short');
      }
    }));

    // Demo scenario functionality
    tests.push(await this.runTest('demo-scenarios', async () => {
      // Test low inventory scenario
      await httpClient.postJson('/api/demo/seed?scenario=low_inventory&seed=123');
      const inventory = await httpClient.getJson('/api/inventory');
      const outOfStock = Array.isArray(inventory) 
        ? inventory.filter((i: any) => i.status === 'out-of-stock')
        : [];
      if (outOfStock.length === 0) {
        throw new Error('Low inventory scenario did not produce out-of-stock items');
      }

      // Test deterministic seeding
      await httpClient.postJson('/api/demo/seed?scenario=low_inventory&seed=123');
      const inventory2 = await httpClient.getJson('/api/inventory');
      const outOfStock2 = Array.isArray(inventory2) 
        ? inventory2.filter((i: any) => i.status === 'out-of-stock').map((i: any) => i.sku).sort()
        : [];
      const outOfStock1 = outOfStock.map((i: any) => i.sku).sort();
      
      if (JSON.stringify(outOfStock1) !== JSON.stringify(outOfStock2)) {
        throw new Error('Deterministic seeding failed');
      }
    }));

    // Error handling
    tests.push(await this.runTest('error-handling', async () => {
      const response = await httpClient.get('/api/appointments?date=invalid-date');
      if (response.status !== 400) {
        throw new Error('Expected 400 for invalid date parameter');
      }
    }));

    return tests;
  }

  /**
   * Run API endpoint tests
   */
  private async runApiTests(httpClient: TestHttpClient, dataManager: TestDataManager, suite: TestSuite) {
    const tests = [];

    // Test all major API endpoints
    const endpoints = [
      '/api/profile',
      '/api/services',
      '/api/staff',
      '/api/customers',
      '/api/appointments',
      '/api/inventory',
      '/api/analytics',
      '/api/pos/sales',
      '/api/marketing/campaigns',
      '/api/loyalty/entries'
    ];

    for (const endpoint of endpoints) {
      tests.push(await this.runTest(`api-${endpoint.replace(/\//g, '-')}`, async () => {
        const response = await httpClient.get(endpoint);
        if (!response.ok) {
          throw new Error(`${endpoint} returned ${response.status}`);
        }
        const data = await response.json();
        if (data === null || data === undefined) {
          throw new Error(`${endpoint} returned null/undefined`);
        }
      }));
    }

    return tests;
  }

  /**
   * Run E2E tests (placeholder - would integrate with existing e2e.ts)
   */
  private async runE2eTests(httpClient: TestHttpClient, dataManager: TestDataManager, suite: TestSuite) {
    const tests = [];

    tests.push(await this.runTest('e2e-navigation', async () => {
      // This would integrate with existing Puppeteer-based E2E tests
      // For now, just verify the server is responding to page requests
      const response = await httpClient.get('/');
      if (!response.ok) {
        throw new Error('Home page not accessible');
      }
    }));

    return tests;
  }

  /**
   * Run performance tests
   */
  private async runPerformanceTests(httpClient: TestHttpClient, dataManager: TestDataManager, suite: TestSuite) {
    const tests = [];

    // Import performance test suite dynamically
    try {
      const { PerformanceTestSuite, createDefaultPerformanceConfig } = await import('../performance/performance-test-suite.js');
      
      // Create performance test configuration
      const perfConfig = createDefaultPerformanceConfig();
      
      // Override with suite configuration if provided
      if (suite.config.maxConcurrentUsers) {
        perfConfig.loadTest.maxConcurrentUsers = suite.config.maxConcurrentUsers;
      }
      if (suite.config.duration) {
        perfConfig.loadTest.sustainedDurationMs = suite.config.duration;
      }
      if (suite.config.rampUpDuration) {
        perfConfig.loadTest.rampUpDurationMs = suite.config.rampUpDuration;
      }
      
      // Execute performance test suite
      const perfTestSuite = new PerformanceTestSuite(this.config, perfConfig);
      const perfResults = await perfTestSuite.executeTests();
      
      // Convert performance test results to our format
      tests.push(...perfResults);
      
    } catch (error) {
      // Fallback to basic performance test if performance suite fails to load
      console.warn('Performance test suite not available, running basic tests:', error);
      
      tests.push(await this.runTest('response-time-health', async () => {
        const { metrics } = await this.performanceMonitor.measureRequest('health-check', async () => {
          return httpClient.getJson('/api/health');
        });

        if (metrics.duration > this.config.thresholds.maxResponseTime) {
          throw new Error(`Health endpoint too slow: ${metrics.duration}ms > ${this.config.thresholds.maxResponseTime}ms`);
        }
      }));
      
      // Basic load test simulation
      tests.push(await this.runTest('basic-load-test', async () => {
        const concurrentRequests = 10;
        const promises = [];
        
        for (let i = 0; i < concurrentRequests; i++) {
          promises.push(httpClient.getJson('/api/health'));
        }
        
        const startTime = Date.now();
        await Promise.all(promises);
        const duration = Date.now() - startTime;
        
        if (duration > this.config.thresholds.maxResponseTime * concurrentRequests) {
          throw new Error(`Concurrent requests too slow: ${duration}ms for ${concurrentRequests} requests`);
        }
      }));
    }

    return tests;
  }

  /**
   * Run security tests
   */
  private async runSecurityTests(httpClient: TestHttpClient, dataManager: TestDataManager, suite: TestSuite) {
    const tests = [];

    tests.push(await this.runTest('security-headers', async () => {
      const response = await httpClient.get('/api/health');
      // Check for basic security headers (this would be expanded)
      if (!response.headers.get('content-type')) {
        throw new Error('Missing content-type header');
      }
    }));

    return tests;
  }

  /**
   * Helper method to run a single test with error handling and timing
   */
  private async runTest(testName: string, testFn: () => Promise<void>) {
    const startTime = Date.now();
    const startTimeIso = new Date().toISOString();

    try {
      await testFn();
      const duration = Date.now() - startTime;
      return createTestResult('functional', testName, 'pass', duration, {
        startTime: startTimeIso,
        endTime: new Date().toISOString()
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      return createTestResult('functional', testName, 'fail', duration, {
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