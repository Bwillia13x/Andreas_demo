/**
 * Test Configuration Management
 * Centralized configuration for all test suites
 */

export interface TestConfig {
  environment: 'local' | 'staging' | 'docker';
  testSuites: TestSuite[];
  thresholds: PerformanceThresholds;
  security: SecurityConfig;
  reporting: ReportingConfig;
  server: ServerConfig;
}

export interface TestSuite {
  name: string;
  type: 'functional' | 'performance' | 'security' | 'deployment' | 'uat';
  enabled: boolean;
  config: Record<string, any>;
}

export interface PerformanceThresholds {
  maxResponseTime: number; // milliseconds
  maxMemoryUsage: number; // MB
  minConcurrentUsers: number;
  maxErrorRate: number; // percentage
}

export interface SecurityConfig {
  enableVulnerabilityScanning: boolean;
  enableInputValidationTests: boolean;
  enableAuthenticationTests: boolean;
  maxSecurityRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ReportingConfig {
  outputDir: string;
  formats: ('html' | 'json' | 'csv')[];
  includeScreenshots: boolean;
  includeMetrics: boolean;
}

export interface ServerConfig {
  startupTimeoutMs: number;
  portFile: string;
  baseUrl?: string;
  env: Record<string, string>;
}

/**
 * Default test configuration
 */
export const defaultTestConfig: TestConfig = {
  environment: 'local',
  testSuites: [
    {
      name: 'smoke-tests',
      type: 'functional',
      enabled: true,
      config: {
        timeout: 30000,
        retries: 2
      }
    },
    {
      name: 'api-tests',
      type: 'functional', 
      enabled: true,
      config: {
        timeout: 15000,
        retries: 1
      }
    },
    {
      name: 'e2e-tests',
      type: 'functional',
      enabled: true,
      config: {
        timeout: 60000,
        retries: 1,
        headless: true
      }
    },
    {
      name: 'performance-tests',
      type: 'performance',
      enabled: true,
      config: {
        duration: 60000,
        concurrency: 10,
        maxConcurrentUsers: 50,
        rampUpDuration: 30000
      }
    },
    {
      name: 'security-tests',
      type: 'security',
      enabled: false,
      config: {
        timeout: 30000
      }
    }
  ],
  thresholds: {
    maxResponseTime: 200, // 200ms
    maxMemoryUsage: 512, // 512MB
    minConcurrentUsers: 50,
    maxErrorRate: 1 // 1%
  },
  security: {
    enableVulnerabilityScanning: true,
    enableInputValidationTests: true,
    enableAuthenticationTests: true,
    maxSecurityRiskLevel: 'medium'
  },
  reporting: {
    outputDir: 'test-results',
    formats: ['html', 'json'],
    includeScreenshots: true,
    includeMetrics: true
  },
  server: {
    startupTimeoutMs: 20000,
    portFile: '.local/test_port',
    env: {
      NODE_ENV: 'production',
      SMOKE_MODE: '1', // Enable demo data seeding for tests
      ADMIN_TOKEN: 'test-admin-token-12345-secure',
      SKIP_RATE_LIMIT: 'true', // Skip rate limiting in tests to avoid interference
      CORS_ORIGINS: '["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"]' // Allow test origins
    }
  }
};

/**
 * Load test configuration from file or use defaults
 */
export function loadTestConfig(configPath?: string): TestConfig {
  if (configPath) {
    try {
      // In a real implementation, we'd load from file
      // For now, return defaults
      return defaultTestConfig;
    } catch (error) {
      console.warn(`Failed to load config from ${configPath}, using defaults`);
      return defaultTestConfig;
    }
  }
  return defaultTestConfig;
}

/**
 * Validate test configuration
 */
export function validateTestConfig(config: TestConfig): string[] {
  const errors: string[] = [];
  
  if (config.thresholds.maxResponseTime <= 0) {
    errors.push('maxResponseTime must be positive');
  }
  
  if (config.thresholds.maxMemoryUsage <= 0) {
    errors.push('maxMemoryUsage must be positive');
  }
  
  if (config.thresholds.maxErrorRate < 0 || config.thresholds.maxErrorRate > 100) {
    errors.push('maxErrorRate must be between 0 and 100');
  }
  
  if (!config.reporting.outputDir) {
    errors.push('reporting.outputDir is required');
  }
  
  if (config.reporting.formats.length === 0) {
    errors.push('at least one reporting format must be specified');
  }
  
  return errors;
}