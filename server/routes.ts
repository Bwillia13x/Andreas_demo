import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import chatRouter from "./routes/chat";
import { getNow, setFreeze, getFreeze } from "./lib/clock";
import { rateLimitedAuth, type AuthenticatedRequest } from "./middleware/auth";
import { securityHeaders } from "./middleware/security-headers";
import { cors } from "./middleware/cors";
import { csrf } from "./middleware/csrf";
import { requestLogging } from "./middleware/request-logging";
import { tracingMiddleware } from "../lib/tracing/opentelemetry";
import compression from "compression";
import {
  inputValidation,
  strictInputValidation,
  validateContentType,
  validateRequestSize,
  sqlInjectionPrevention,
  enhancedXSSPrevention
} from "./middleware/input-validation";
import {
  circuitBreakerMiddleware,
  requestTimeoutMiddleware,
  connectionMonitoringMiddleware,
  getCircuitBreakerStatus
} from "./middleware/error-handling";
import {
  loadBalancerMiddleware,
  connectionPoolMiddleware,
  getLoadBalancerStatus
} from "./middleware/load-balancer";
import { getEnvVar, getEnvVarString } from '../lib/env-security';
import { log } from '../lib/log';

// Extend Express Request to include session
declare module 'express-session' {
  interface SessionData {
    lastAccess?: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply request logging first to capture all requests
  app.use(requestLogging);

  // Apply tracing middleware
  app.use(tracingMiddleware());

  // Apply connection monitoring
  app.use(connectionMonitoringMiddleware());

  // Apply request timeout middleware
  app.use(requestTimeoutMiddleware(30000)); // 30 second timeout

  // Apply security headers to all routes
  app.use(securityHeaders);

  // Apply input validation to all routes
  app.use(inputValidation);

  // Apply content type validation for POST/PUT/PATCH requests
  app.use(validateContentType(['application/json', 'text/plain']));

  // Apply request size validation
  app.use(validateRequestSize(2 * 1024 * 1024)); // 2MB limit

  // Apply load balancer for high concurrency handling
  app.use(loadBalancerMiddleware());

  // Apply enhanced connection pooling for high concurrency
  app.use(connectionPoolMiddleware(200));

  // Apply compression middleware for API responses
  app.use('/api', compression({
    level: 6, // Good balance between speed and compression
    threshold: 1024, // Only compress responses larger than 1KB
    filter: (req, res) => {
      // Don't compress responses that are already compressed
      if (res.getHeader('Content-Encoding')) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  // Apply CORS middleware only to valid API routes (not to 404s)
  // This will be applied after route matching

  // Apply CSRF protection to state-changing routes
  app.use('/api', csrf);

  // Apply input validation to all routes
  app.use(inputValidation);
  
  // Apply content type validation to POST/PUT/PATCH routes
  app.use(validateContentType(['application/json', 'text/plain']));
  
  // Apply request size validation
  app.use(validateRequestSize(2 * 1024 * 1024)); // 2MB limit
  
  // Apply circuit breaker for API routes
  app.use('/api', circuitBreakerMiddleware('api-service'));
  
  // put application routes here
  // prefix all routes with /api
  
  // Add chat route for AI business assistant
  app.use("/api", cors, chatRouter);

  // Add performance monitoring routes
  const performanceRouter = await import("./routes/performance");
  app.use("/api/performance", cors, performanceRouter.default);

  // Map services to expected types for tests
  app.get("/api/services", cors, rateLimitedAuth, sqlInjectionPrevention, async (_req, res) => {
    try {
      const services = await storage.getAllServices();
      res.json(services.map(mapService));
    } catch (error) {
      console.error("Error getting services:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/services/:id", cors, rateLimitedAuth, sqlInjectionPrevention, async (req, res) => {
    try {
      const service = await storage.getService(req.params.id);
      if (!service) return res.status(404).json({ message: "Service not found" });
      res.json(mapService(service));
    } catch (error) {
      console.error("Error getting service:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Readiness probe - checks if service is ready to serve traffic
  app.get("/readyz", async (req, res) => {
    try {
      const checks = {
        database: false,
        connectionPool: false,
        timestamp: new Date().toISOString()
      };

      // Check database connectivity
      try {
        const { connectionPool } = await import('../lib/db/connection-pool');
        const poolStatus = connectionPool.getStatus();
        checks.database = poolStatus.healthy;
        checks.connectionPool = poolStatus.healthy && poolStatus.poolUtilization < 95;
      } catch (error) {
        log('Readiness check failed: database', { error: error instanceof Error ? error.message : String(error) });
      }

      const allChecksPass = checks.database && checks.connectionPool;

      if (allChecksPass) {
        res.status(200).json({
          status: "ready",
          checks,
          message: "Service is ready to serve traffic"
        });
      } else {
        res.status(503).json({
          status: "not ready",
          checks,
          message: "Service is not ready to serve traffic"
        });
      }
    } catch (error) {
      log('Readiness probe error', { error: error instanceof Error ? error.message : String(error) });
      res.status(503).json({
        status: "error",
        message: "Readiness check failed",
        timestamp: new Date().toISOString()
      });
    }
  });

  // Enhanced health endpoint for operational checks
  app.get("/api/health", async (req, res) => {
    try {
      const openaiKey = getEnvVar('OPENAI_API_KEY');
      const aiDemoMode = !openaiKey || openaiKey.trim() === '';
      
      // Initialize session for security testing - this ensures session cookie is set
      if (req.session) {
        req.session.lastAccess = new Date().toISOString();
        // Force session save to ensure cookie is set
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      
      // Get system health metrics
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      const circuitBreakerStatus = getCircuitBreakerStatus();
      
      // Get enhanced metrics from new components
      const { resourceManager } = await import('../lib/resource-manager');
      const { requestThrottler } = await import('./middleware/request-throttling');
      const { loadBalancer } = await import('../lib/load-balancer');
      const { sessionManager } = await import('../lib/session-manager');
      const { autoScaler } = await import('../lib/auto-scaler');

      // Database metrics are optional during smoke/demo without a configured DB
      const hasDb = Boolean(getEnvVar('POSTGRES_URL') || getEnvVar('DATABASE_URL'));
      let dbMetrics: {
        healthy: boolean;
        totalConnections: number;
        activeConnections: number;
        idleConnections: number;
        waitingClients: number;
        poolUtilization: number;
      };
      if (hasDb) {
        const { connectionPool } = await import('../lib/db/connection-pool');
        dbMetrics = connectionPool.getStatus();
      } else {
        dbMetrics = {
          healthy: true,
          totalConnections: 0,
          activeConnections: 0,
          idleConnections: 0,
          waitingClients: 0,
          poolUtilization: 0
        };
      }
      
      const resourceMetrics = resourceManager.getStatus();
      const throttlingMetrics = requestThrottler.getStatus();
      const lbMetrics = loadBalancer.getStatus();
      const lbIsHealthy = lbMetrics.totalInstances === 0 ? true : lbMetrics.healthy;
      const sessionMetrics = sessionManager.getStatus();
      const scalingMetrics = autoScaler.getStatus();
      
      // Determine overall health status
      const isHealthy = resourceMetrics.healthy && 
                       throttlingMetrics.healthy && 
                       dbMetrics.healthy &&
                       lbIsHealthy &&
                       sessionMetrics.healthy;
      
      const freeze = getFreeze();
      if (freeze && freeze.date == null) {
        freeze.date = '' as any;
      }
      res.json({
        status: isHealthy ? "ok" : "degraded",
        env: app.get("env"),
        timestamp: getNow().toISOString(),
        aiDemoMode,
        scenario: storage.getCurrentScenario?.() ?? 'default',
        seed: storage.getCurrentSeed?.() ?? null,
        freeze,
        system: {
          uptime: Math.floor(uptime),
          memory: {
            used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
            total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
            rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
            utilization: resourceMetrics.heapUtilization
          },
          circuitBreakers: circuitBreakerStatus,
          database: {
            healthy: dbMetrics.healthy,
            totalConnections: dbMetrics.totalConnections,
            activeConnections: dbMetrics.activeConnections,
            poolUtilization: dbMetrics.poolUtilization
          },
          throttling: {
            healthy: throttlingMetrics.healthy,
            activeRequests: throttlingMetrics.activeRequests,
            queuedRequests: throttlingMetrics.queuedRequests,
            concurrentUtilization: throttlingMetrics.concurrentUtilization
          },
          resources: {
            healthy: resourceMetrics.healthy,
            memoryUsage: resourceMetrics.memoryUsage,
            activeHandles: resourceMetrics.activeHandles,
            cacheSize: resourceMetrics.cacheSize
          },
          loadBalancer: {
            healthy: lbIsHealthy,
            totalInstances: lbMetrics.totalInstances,
            healthyInstances: lbMetrics.healthyInstances,
            currentLoad: lbMetrics.currentLoad,
            sessionCount: lbMetrics.sessionCount
          },
          sessions: {
            healthy: sessionMetrics.healthy,
            activeSessions: sessionMetrics.activeSessions,
            sessionUtilization: sessionMetrics.sessionUtilization,
            memoryUsageMB: sessionMetrics.memoryUsageMB
          },
          autoScaling: {
            enabled: scalingMetrics.enabled,
            currentInstances: scalingMetrics.currentInstances,
            activePolicies: scalingMetrics.activePolicies,
            recentEvents: scalingMetrics.recentEvents
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: "Health check failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: getNow().toISOString()
      });
    }
  });

  // Demo scenario reseed endpoint (for demos only) - requires authentication
  app.post("/api/demo/seed", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const scenario = String((req.query.scenario as string) || req.body?.scenario || 'default');
      const seed = req.query.seed ? parseInt(req.query.seed as string, 10) : (req.body?.seed as number | undefined);
      await storage.seedDemoData(scenario, seed);
      res.json({ ok: true, scenario, seed: storage.getCurrentSeed?.() });
    } catch (error) {
      console.error('Error reseeding demo data:', error);
      res.status(500).json({ message: 'Failed to reseed demo data' });
    }
  });

  // Business Profile endpoints
  app.get("/api/profile", rateLimitedAuth, async (req, res) => {
    try {
      const profile = await storage.getBusinessProfile();
      if (!profile) {
        return res.status(404).json({ message: "Business profile not found" });
      }
      res.json(mapProfile(profile));
    } catch (error) {
      console.error("Error getting business profile:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Services endpoints (remove duplicate - already defined above)
  // app.get("/api/services", async (req, res) => {
  //   try {
  //     const services = await storage.getAllServices();
  //     res.json(services);
  //   } catch (error) {
  //     console.error("Error getting services:", error);
  //     res.status(500).json({ message: "Internal server error" });
  //   }
  // });

  // app.get("/api/services/:id", async (req, res) => {
  //   try {
  //     const service = await storage.getService(req.params.id);
  //     if (!service) {
  //       return res.status(404).json({ message: "Service not found" });
  //     }
  //     res.json(service);
  //   } catch (error) {
  //     console.error("Error getting service:", error);
  //     res.status(500).json({ message: "Internal server error" });
  //   }
  // });

  // Staff endpoints
  app.get("/api/staff", cors, rateLimitedAuth, async (req, res) => {
    try {
      const staff = await storage.getAllStaff();
      res.json(staff);
    } catch (error) {
      console.error("Error getting staff:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/staff/:id", rateLimitedAuth, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      res.json(staffMember);
    } catch (error) {
      console.error("Error getting staff member:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Customer endpoints (limited for privacy)
  app.get("/api/customers", cors, rateLimitedAuth, sqlInjectionPrevention, async (req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      // Return limited customer data for privacy
      const publicCustomers = customers.map(customer => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        preferences: customer.preferences,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      }));
      res.json(publicCustomers);
    } catch (error) {
      console.error("Error getting customers:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Helper mappers to align API schema with tests
  function mapAppointment(a: any) {
    if (!a) return a;
    return { ...a, startTime: a.scheduledStart, endTime: a.scheduledEnd };
  }
  function mapService(s: any) {
    if (!s) return s;
    const priceNum = typeof s.price === 'string' ? parseFloat(s.price) : s.price;
    return { ...s, price: priceNum };
  }
  function mapInventoryItem(i: any) {
    if (!i) return i;
    const quantity = i.quantity ?? i.currentStock ?? 0;
    const min = i.minStock ?? 0;
    let status = 'in-stock';
    if (quantity === 0) status = 'out-of-stock';
    else if (quantity <= min) status = 'low-stock';
    return { ...i, quantity, status };
  }
  function mapProfile(p: any) {
    if (!p) return p;
    const hours = p.hours && typeof p.hours === 'object'
      ? Object.fromEntries(Object.entries(p.hours).map(([day, val]: any) => {
          if (typeof val === 'string') return [day, val];
          const open = val?.open ?? val?.start ?? '';
          const close = val?.close ?? val?.end ?? '';
          return [day, `${open}-${close}`];
        }))
      : p.hours;
    return { ...p, hours };
  }
  function toNum(x: any) { return typeof x === 'string' ? parseFloat(x) : x; }
  function mapAnalytics(a: any) {
    if (!a) return a;
    const topServices = Array.isArray(a.topServices) ? a.topServices.map((t: any) => ({
      ...t,
      revenue: toNum(t.revenue)
    })) : a.topServices;
    const staffPerformance = Array.isArray(a.staffPerformance) ? a.staffPerformance.map((s: any) => ({
      ...s,
      revenue: toNum(s.revenue),
      rating: toNum(s.rating)
    })) : a.staffPerformance;
    return {
      ...a,
      totalRevenue: toNum(a.totalRevenue),
      averageRating: toNum(a.averageRating),
      utilizationRate: toNum(a.utilizationRate),
      customerSatisfaction: toNum(a.customerSatisfaction),
      noShowRate: toNum(a.noShowRate),
      repeatCustomerRate: toNum(a.repeatCustomerRate),
      topServices,
      staffPerformance
    };
  }

  // Appointments endpoints
  app.get("/api/appointments", rateLimitedAuth, async (req, res) => {
    try {
      let appointments;

      // Check for day filter
      if (req.query.day === 'today') {
        appointments = await storage.getAppointmentsByDay(getNow());
      } else if (req.query.date) {
        const filterDate = new Date(req.query.date as string);
        if (isNaN(filterDate.getTime())) {
          return res.status(400).json({ message: "Invalid date format" });
        }
        appointments = await storage.getAppointmentsByDay(filterDate);
      } else {
        appointments = await storage.getAllAppointments();
      }

      res.json(appointments.map(mapAppointment));
    } catch (error) {
      console.error("Error getting appointments:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Analytics export (CSV)
  app.get("/api/analytics/export", rateLimitedAuth, async (_req, res) => {
    try {
      const analytics = await storage.getAllAnalytics();
      const header = [
        'date','totalRevenue','totalAppointments','totalCustomers','averageRating','utilizationRate','customerSatisfaction','noShowRate','repeatCustomerRate','averageServiceDuration'
      ];
      const rows = analytics.map(a => [
        new Date(a.date).toISOString(),
        a.totalRevenue,
        a.totalAppointments,
        a.totalCustomers,
        a.averageRating,
        a.utilizationRate,
        a.customerSatisfaction,
        a.noShowRate,
        a.repeatCustomerRate,
        a.averageServiceDuration
      ]);
      const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
      res.send(csv);
    } catch (error) {
      console.error("Error exporting analytics:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Demo time controls - requires authentication
  app.post("/api/demo/time", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const clear = req.query.clear === '1' || (req.body && req.body.clear === true);
      if (clear) {
        setFreeze(null);
      } else {
        const date = String((req.query.date as string) || (req.body && req.body.date) || getNow().toISOString());
        setFreeze(date);
      }
      await storage.seedDemoData(storage.getCurrentScenario?.(), storage.getCurrentSeed?.());
      res.json({ ok: true, freeze: getFreeze() });
    } catch (error) {
      console.error('Error setting demo time:', error);
      res.status(400).json({ message: 'Invalid date' });
    }
  });

  // Reset demo to defaults (clear freeze, default scenario/seed) - requires authentication
  app.post("/api/demo/reset", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      setFreeze(null);
      await storage.seedDemoData('default', undefined);
      const freeze = getFreeze();
      if (freeze && freeze.date == null) {
        freeze.date = '' as any;
      }
      res.json({ ok: true, scenario: storage.getCurrentScenario?.(), seed: storage.getCurrentSeed?.(), freeze });
    } catch (error) {
      console.error('Error resetting demo:', error);
      res.status(500).json({ message: 'Failed to reset demo' });
    }
  });

  app.get("/api/appointments/:id", rateLimitedAuth, async (req, res) => {
    try {
      const appointment = await storage.getAppointment(req.params.id);
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }
      res.json(mapAppointment(appointment));
    } catch (error) {
      console.error("Error getting appointment:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Inventory endpoints
  app.get("/api/inventory", rateLimitedAuth, async (req, res) => {
    try {
      const inventory = await storage.getAllInventoryItems();
      res.json(inventory.map(mapInventoryItem));
    } catch (error) {
      console.error("Error getting inventory:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inventory/:id", rateLimitedAuth, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }
      res.json(mapInventoryItem(item));
    } catch (error) {
      console.error("Error getting inventory item:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Analytics endpoints
  app.get("/api/analytics", rateLimitedAuth, async (req, res) => {
    try {
      const analytics = await storage.getAllAnalytics();
      res.json(analytics.map(mapAnalytics));
    } catch (error) {
      console.error("Error getting analytics:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POS endpoints
  app.get("/api/pos/sales", rateLimitedAuth, async (_req, res) => {
    try {
      const sales = await storage.getAllSales();
      res.json(sales);
    } catch (error) {
      console.error("Error getting sales:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POS sales CSV export
  app.get("/api/pos/sales/export", rateLimitedAuth, async (_req, res) => {
    try {
      const sales = await storage.getAllSales();
      const header = [
        'id','createdAt','subtotal','discount','tax','total','items'
      ];
      const rows = sales.map(s => [
        s.id,
        new Date(s.createdAt).toISOString(),
        s.subtotal ?? '',
        s.discount ?? '',
        s.tax ?? '',
        s.total,
        (s.items || []).map(i => `${i.kind}:${i.name}x${i.quantity}@${i.unitPrice}`).join('; ')
      ]);
      const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="pos-sales.csv"');
      res.send(csv);
    } catch (error) {
      console.error("Error exporting sales:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/pos/sales", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      let items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ message: 'No items provided' });

      // Map incoming items that may specify name instead of id (test convenience)
      const mapped: any[] = [];
      for (const it of items) {
        if (!it) continue;
        if (it.kind === 'service' && !it.id && it.name) {
          const services = await storage.getAllServices();
          const found = services.find(s => s.name === it.name);
          if (found) mapped.push({ kind: 'service', id: found.id, quantity: it.quantity || 1 });
          else return res.status(400).json({ message: 'Service not found' });
        } else if (it.kind === 'product' && !it.id && it.name) {
          const inv = await storage.getAllInventoryItems();
          const found = inv.find(p => p.name === it.name);
          if (found) mapped.push({ kind: 'product', id: found.id, quantity: it.quantity || 1 });
          else return res.status(400).json({ message: 'Product not found' });
        } else {
          mapped.push({ kind: it.kind, id: it.id, quantity: it.quantity || 1 });
        }
      }
      items = mapped;

      const discountPct = typeof req.body?.discountPct === 'number' ? req.body.discountPct : undefined;
      const taxPct = typeof req.body?.taxPct === 'number' ? req.body.taxPct : undefined;
      const sale = await storage.createSale({ items, discountPct, taxPct });
      res.json(sale);
    } catch (error: any) {
      console.error("Error creating sale:", error);
      res.status(400).json({ message: error?.message || "Failed to create sale" });
    }
  });

  app.delete("/api/pos/sales/:id", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const ok = await storage.deleteSale(req.params.id);
      if (!ok) return res.status(404).json({ message: 'Sale not found' });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting sale:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Marketing endpoints
  app.get("/api/marketing/campaigns", cors, rateLimitedAuth, sqlInjectionPrevention, async (_req, res) => {
    try {
      const campaigns = await storage.getAllCampaigns();
      res.json(campaigns);
    } catch (error) {
      console.error("Error getting campaigns:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/marketing/campaigns", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { name, description, channel, status } = req.body || {};
      if (!name || typeof name !== 'string') return res.status(400).json({ message: 'Name is required' });
      const campaign = await storage.createCampaign({ name, description, channel, status });
      res.json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/marketing/campaigns/:id", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { status, name, description, channel } = req.body || {};
      const updated = await storage.updateCampaign(req.params.id, { status, name, description, channel });
      if (!updated) return res.status(404).json({ message: 'Campaign not found' });
      res.json(updated);
    } catch (error) {
      console.error("Error updating campaign:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Marketing performance (mock metrics derived deterministically)
  app.get("/api/marketing/performance", cors, rateLimitedAuth, sqlInjectionPrevention, async (_req, res) => {
    try {
      const campaigns = await storage.getAllCampaigns();
      const hashToFloat = (s: string): number => {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h % 1000) / 1000;
      };
      const list = campaigns.map((c) => {
        const base = 3000 + Math.floor(hashToFloat(c.id + 'imp') * 12000); // 3k-15k
        const ctr = 0.02 + hashToFloat(c.id + 'ctr') * 0.06; // 2%-8%
        const clicks = Math.max(1, Math.floor(base * ctr));
        const convRate = 0.03 + hashToFloat(c.id + 'conv') * 0.12; // 3%-15%
        const conversions = Math.max(0, Math.floor(clicks * convRate));
        return {
          id: c.id,
          name: c.name,
          impressions: base,
          clicks,
          ctr: +(ctr * 100).toFixed(2),
          conversions,
          convRate: +(convRate * 100).toFixed(2),
        };
      });
      const summary = list.reduce((acc, x) => {
        acc.impressions += x.impressions;
        acc.clicks += x.clicks;
        acc.conversions += x.conversions;
        return acc;
      }, { impressions: 0, clicks: 0, conversions: 0, ctr: 0, convRate: 0 });
      summary.ctr = summary.impressions ? +(summary.clicks / summary.impressions * 100).toFixed(2) : 0;
      summary.convRate = summary.clicks ? +(summary.conversions / summary.clicks * 100).toFixed(2) : 0;
      res.json({ summary, campaigns: list });
    } catch (error) {
      console.error('Error generating marketing performance:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Loyalty endpoints
  app.get("/api/loyalty/entries", rateLimitedAuth, async (req, res) => {
    try {
      const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
      const entries = await storage.getLoyaltyEntries(customerId);
      res.json(entries);
    } catch (error) {
      console.error("Error getting loyalty entries:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Loyalty CSV export
  app.get("/api/loyalty/entries/export", rateLimitedAuth, async (_req, res) => {
    try {
      const entries = await storage.getLoyaltyEntries();
      const header = ['id','customerId','type','points','note','createdAt'];
      const rows = entries.map(e => [
        e.id,
        e.customerId,
        e.type,
        String(e.points ?? ''),
        (e.note ?? '').replace(/,/g, ';'),
        new Date(e.createdAt).toISOString()
      ]);
      const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="loyalty-entries.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting loyalty entries:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/loyalty/entries", strictInputValidation, enhancedXSSPrevention, sqlInjectionPrevention, rateLimitedAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { customerId, type, points, note } = req.body || {};
      if (!customerId || !type) return res.status(400).json({ message: 'customerId and type are required' });
      const entry = await storage.createLoyaltyEntry({ customerId, type, points, note });
      res.json(entry);
    } catch (error: any) {
      console.error("Error creating loyalty entry:", error);
      res.status(400).json({ message: error?.message || "Failed to create loyalty entry" });
    }
  });

  app.get("/api/analytics/:id", rateLimitedAuth, async (req, res) => {
    try {
      const analyticsData = await storage.getAnalytics(req.params.id);
      if (!analyticsData) {
        return res.status(404).json({ message: "Analytics data not found" });
      }
      res.json(analyticsData);
    } catch (error) {
      console.error("Error getting analytics data:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // API 404 handler - must come before catch-all routes
  // This prevents undefined API endpoints from serving HTML pages
  app.use('/api/*', (req, res) => {
    log('API endpoint not found', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    
    res.status(404).json({
      message: 'API endpoint not found',
      error: 'ENDPOINT_NOT_FOUND',
      path: req.path,
      method: req.method
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
