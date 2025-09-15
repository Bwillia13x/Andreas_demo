/**
 * Lightweight Job Queue for Long-Running Tasks
 * Provides background processing with retries, idempotency, and monitoring
 */

import { log, logError } from '../log';
import { getEnvVar, getEnvVarString } from '../env-security';

export interface Job {
  id: string;
  type: string;
  data: any;
  priority: number; // 1-10, higher = more important
  maxRetries: number;
  retryCount: number;
  createdAt: Date;
  nextRunAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  idempotencyKey?: string;
}

export interface JobHandler {
  (job: Job): Promise<any>;
}

export interface QueueConfig {
  maxConcurrency: number;
  retryDelayMs: number;
  maxRetries: number;
  cleanupIntervalMs: number;
  enableMonitoring: boolean;
}

/**
 * Lightweight Job Queue Implementation
 */
export class JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<string, JobHandler>();
  private running = new Set<string>();
  private config: QueueConfig;
  private cleanupInterval?: NodeJS.Timeout;
  private processingInterval?: NodeJS.Timeout;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = {
      maxConcurrency: parseInt(getEnvVarString('JOB_QUEUE_MAX_CONCURRENCY') || '5'),
      retryDelayMs: parseInt(getEnvVarString('JOB_QUEUE_RETRY_DELAY_MS') || '60000'), // 1 minute
      maxRetries: parseInt(getEnvVarString('JOB_QUEUE_MAX_RETRIES') || '3'),
      cleanupIntervalMs: parseInt(getEnvVarString('JOB_QUEUE_CLEANUP_INTERVAL_MS') || '3600000'), // 1 hour
      enableMonitoring: getEnvVarString('JOB_QUEUE_MONITORING') !== 'false',
      ...config
    };

    this.start();
  }

  /**
   * Register a job handler
   */
  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
    log(`Registered job handler for type: ${type}`);
  }

  /**
   * Add a job to the queue
   */
  async addJob(
    type: string,
    data: any,
    options: {
      priority?: number;
      maxRetries?: number;
      delayMs?: number;
      idempotencyKey?: string;
    } = {}
  ): Promise<string> {
    const jobId = this.generateJobId();

    const job: Job = {
      id: jobId,
      type,
      data,
      priority: options.priority || 5,
      maxRetries: options.maxRetries || this.config.maxRetries,
      retryCount: 0,
      createdAt: new Date(),
      nextRunAt: new Date(Date.now() + (options.delayMs || 0)),
      status: 'pending',
      idempotencyKey: options.idempotencyKey
    };

    // Check for idempotency
    if (options.idempotencyKey) {
      const existingJob = Array.from(this.jobs.values()).find(
        j => j.idempotencyKey === options.idempotencyKey && j.status !== 'cancelled'
      );
      if (existingJob) {
        log(`Job with idempotency key ${options.idempotencyKey} already exists, returning existing job`);
        return existingJob.id;
      }
    }

    this.jobs.set(jobId, job);
    log(`Added job ${jobId} of type ${type} with priority ${job.priority}`);

    return jobId;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && job.status === 'pending') {
      job.status = 'cancelled';
      log(`Cancelled job ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    totalJobs: number;
    pendingJobs: number;
    runningJobs: number;
    completedJobs: number;
    failedJobs: number;
    avgProcessingTime: number;
  } {
    const jobs = Array.from(this.jobs.values());
    const completedJobs = jobs.filter(j => j.status === 'completed');
    const processingTimes = completedJobs
      .map(j => j.result?.processingTime || 0)
      .filter(t => t > 0);

    const avgProcessingTime = processingTimes.length > 0
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
      : 0;

    return {
      totalJobs: jobs.length,
      pendingJobs: jobs.filter(j => j.status === 'pending').length,
      runningJobs: this.running.size,
      completedJobs: completedJobs.length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      avgProcessingTime
    };
  }

  /**
   * Start the queue processing
   */
  private start(): void {
    log('Starting job queue processor', {
      maxConcurrency: this.config.maxConcurrency,
      retryDelayMs: this.config.retryDelayMs
    });

    // Process jobs every second
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, 1000);

    // Cleanup old jobs every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Process pending jobs
   */
  private async processJobs(): Promise<void> {
    if (this.running.size >= this.config.maxConcurrency) {
      return; // Max concurrency reached
    }

    // Get pending jobs sorted by priority (highest first) and creation time
    const pendingJobs = Array.from(this.jobs.values())
      .filter(job => job.status === 'pending' && job.nextRunAt <= new Date())
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    for (const job of pendingJobs) {
      if (this.running.size >= this.config.maxConcurrency) {
        break;
      }

      if (this.running.has(job.id)) {
        continue; // Already running
      }

      this.processJob(job);
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job): Promise<void> {
    if (this.running.size >= this.config.maxConcurrency) {
      return;
    }

    this.running.add(job.id);
    job.status = 'running';

    const handler = this.handlers.get(job.type);
    if (!handler) {
      logError(`No handler registered for job type: ${job.type}`, new Error(`Unknown job type: ${job.type}`));
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      this.running.delete(job.id);
      return;
    }

    const startTime = Date.now();

    try {
      log(`Processing job ${job.id} of type ${job.type}`, { priority: job.priority });
      const result = await handler(job);
      const processingTime = Date.now() - startTime;

      job.status = 'completed';
      job.result = {
        ...result,
        processingTime,
        completedAt: new Date()
      };

      log(`Job ${job.id} completed successfully in ${processingTime}ms`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      job.retryCount++;

      logError(`Job ${job.id} failed (attempt ${job.retryCount}/${job.maxRetries})`, error as Error, {
        jobType: job.type,
        processingTime,
        jobData: job.data
      });

      if (job.retryCount < job.maxRetries) {
        // Schedule retry
        job.status = 'pending';
        job.nextRunAt = new Date(Date.now() + (this.config.retryDelayMs * job.retryCount));
        job.error = `Attempt ${job.retryCount} failed: ${(error as Error).message}`;
      } else {
        // Max retries reached
        job.status = 'failed';
        job.error = `Max retries exceeded. Final error: ${(error as Error).message}`;
      }
    } finally {
      this.running.delete(job.id);
    }
  }

  /**
   * Clean up old completed/failed jobs
   */
  private cleanup(): void {
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let cleanedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if ((job.status === 'completed' || job.status === 'failed') && job.createdAt < cutoffDate) {
        this.jobs.delete(jobId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log(`Cleaned up ${cleanedCount} old jobs`);
    }
  }

  /**
   * Generate a unique job ID
   */
  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `job_${timestamp}_${random}`;
  }

  /**
   * Shutdown the queue
   */
  shutdown(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    log('Job queue shutdown complete', this.getStats());
  }
}

// Create and export the job queue
export const jobQueue = new JobQueue();

// Graceful shutdown
process.on('SIGTERM', () => {
  jobQueue.shutdown();
});

process.on('SIGINT', () => {
  jobQueue.shutdown();
});
