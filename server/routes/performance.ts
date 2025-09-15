/**
 * Performance Monitoring API Routes
 * Provides endpoints for accessing performance metrics, alerts, and dashboard data
 */

import { Router } from 'express';
import { performanceMonitor } from '../../lib/performance-monitor';
import { performanceDashboard } from '../../lib/performance-dashboard';
import { performanceOptimizer } from '../../lib/performance-optimizer';
import { prometheusMetricsMiddleware } from '../../lib/metrics/prometheus';
import { log, logError } from '../../lib/log';

const router = Router();

/**
 * GET /api/performance/dashboard
 * Get current dashboard data including metrics, alerts, and charts
 */
router.get('/dashboard', (req, res) => {
  try {
    const dashboardData = performanceDashboard.getDashboardData();
    res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logError('Failed to get dashboard data', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard data'
    });
  }
});

/**
 * GET /api/performance/metrics
 * Get current performance metrics
 */
router.get('/metrics', (req, res) => {
  try {
    const current = performanceMonitor.getCurrentMetrics();
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;
    const history = performanceMonitor.getMetricsHistory(since);
    
    res.json({
      success: true,
      data: {
        current,
        history,
        count: history.length
      }
    });
  } catch (error) {
    logError('Failed to get performance metrics', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance metrics'
    });
  }
});

/**
 * GET /api/performance/alerts
 * Get performance alerts
 */
router.get('/alerts', (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const alerts = activeOnly 
      ? performanceMonitor.getActiveAlerts()
      : performanceMonitor.getAllAlerts();
    
    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        activeCount: performanceMonitor.getActiveAlerts().length
      }
    });
  } catch (error) {
    logError('Failed to get performance alerts', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance alerts'
    });
  }
});

/**
 * POST /api/performance/alerts/:alertId/resolve
 * Resolve a specific alert
 */
router.post('/alerts/:alertId/resolve', (req, res) => {
  try {
    const { alertId } = req.params;
    performanceMonitor.resolveAlert(alertId);
    
    log('Performance alert resolved via API', { alertId });
    
    res.json({
      success: true,
      message: 'Alert resolved successfully'
    });
  } catch (error) {
    logError('Failed to resolve alert', error as Error, { alertId: req.params.alertId });
    res.status(500).json({
      success: false,
      error: 'Failed to resolve alert'
    });
  }
});

/**
 * GET /api/performance/summary
 * Get performance summary for health checks
 */
router.get('/summary', (req, res) => {
  try {
    const summary = performanceMonitor.getPerformanceSummary();
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logError('Failed to get performance summary', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance summary'
    });
  }
});

/**
 * GET /api/performance/health
 * Get detailed health status for monitoring systems
 */
router.get('/health', (req, res) => {
  try {
    const healthStatus = performanceDashboard.getHealthStatus();
    
    // Set appropriate HTTP status based on health
    const statusCode = healthStatus.status === 'healthy' ? 200 :
                      healthStatus.status === 'warning' ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    logError('Failed to get health status', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve health status'
    });
  }
});

/**
 * POST /api/performance/reports
 * Generate a performance report
 */
router.post('/reports', (req, res) => {
  try {
    const { periodHours = 24 } = req.body;
    
    if (periodHours < 1 || periodHours > 168) { // Max 1 week
      return res.status(400).json({
        success: false,
        error: 'Period must be between 1 and 168 hours'
      });
    }
    
    const report = performanceDashboard.generateReport(periodHours);
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logError('Failed to generate performance report', error as Error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate report'
    });
  }
});

/**
 * GET /api/performance/reports
 * Get available performance reports
 */
router.get('/reports', (req, res) => {
  try {
    const reports = performanceDashboard.getReports();
    
    res.json({
      success: true,
      data: {
        reports: reports.map(r => ({
          id: r.id,
          generatedAt: r.generatedAt,
          period: r.period,
          summary: r.summary
        })),
        count: reports.length
      }
    });
  } catch (error) {
    logError('Failed to get performance reports', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance reports'
    });
  }
});

/**
 * GET /api/performance/reports/:reportId
 * Get a specific performance report
 */
router.get('/reports/:reportId', (req, res) => {
  try {
    const { reportId } = req.params;
    const report = performanceDashboard.getReport(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logError('Failed to get performance report', error as Error, { reportId: req.params.reportId });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance report'
    });
  }
});

/**
 * GET /api/performance/export
 * Export all performance data
 */
router.get('/export', (req, res) => {
  try {
    const exportData = performanceDashboard.exportData();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="performance-data-${Date.now()}.json"`);
    res.send(exportData);
  } catch (error) {
    logError('Failed to export performance data', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to export performance data'
    });
  }
});

/**
 * PUT /api/performance/config
 * Update performance monitoring configuration
 */
router.put('/config', (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration provided'
      });
    }
    
    performanceMonitor.updateConfig(config);
    
    log('Performance monitoring configuration updated via API', config);
    
    res.json({
      success: true,
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    logError('Failed to update performance configuration', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

/**
 * GET /api/performance/optimizer/status
 * Get performance optimizer status
 */
router.get('/optimizer/status', (req, res) => {
  try {
    const status = performanceOptimizer.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logError('Failed to get optimizer status', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve optimizer status'
    });
  }
});

/**
 * POST /api/performance/optimizer/memory
 * Trigger memory optimization
 */
router.post('/optimizer/memory', (req, res) => {
  try {
    performanceOptimizer.optimizeMemoryUsage();
    
    log('Memory optimization triggered via API');
    
    res.json({
      success: true,
      message: 'Memory optimization completed'
    });
  } catch (error) {
    logError('Failed to optimize memory', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize memory'
    });
  }
});

/**
 * POST /api/performance/optimizer/performance
 * Trigger performance optimization
 */
router.post('/optimizer/performance', (req, res) => {
  try {
    const { aggressive = false } = req.body;
    
    performanceOptimizer.optimizePerformance(aggressive);
    
    log('Performance optimization triggered via API', { aggressive });
    
    res.json({
      success: true,
      message: 'Performance optimization completed',
      aggressive
    });
  } catch (error) {
    logError('Failed to optimize performance', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize performance'
    });
  }
});

/**
 * PUT /api/performance/optimizer/config
 * Update performance optimizer configuration
 */
router.put('/optimizer/config', (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration provided'
      });
    }
    
    performanceOptimizer.updateConfig(config);
    
    log('Performance optimizer configuration updated via API', config);
    
    res.json({
      success: true,
      message: 'Optimizer configuration updated successfully'
    });
  } catch (error) {
    logError('Failed to update optimizer configuration', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to update optimizer configuration'
    });
  }
});

/**
 * GET /api/performance/metrics/prometheus
 * Export metrics in Prometheus format
 */
router.get('/metrics/prometheus', prometheusMetricsMiddleware);

export default router;