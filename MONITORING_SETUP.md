# 📊 Production Monitoring Setup Guide

## Quick Start Monitoring Commands

### 1. Application Health Monitoring

```bash
# Continuous health check
watch -n 30 'curl -s http://localhost:5000/api/health | jq'

# Performance monitoring
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:5000/api/health
```

### 2. System Resource Monitoring

```bash
# Monitor container resources
docker stats mgmt-vibe

# Monitor system resources
top -p $(pgrep -f "node.*dist/index.js")
```

### 3. Log Monitoring

```bash
# Follow application logs
docker logs -f mgmt-vibe

# Monitor error patterns
tail -f /var/log/mgmt-vibe/error.log | grep -E "(ERROR|WARN)"
```

## Monitoring Alerts Configuration

### Critical Alerts (Immediate Response)

```yaml
# Response Time Alert
- alert: HighResponseTime
  expr: http_request_duration_seconds{quantile="0.95"} > 0.1
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "High response time detected"

# Error Rate Alert  
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "High error rate detected"

# Memory Usage Alert
- alert: HighMemoryUsage
  expr: process_resident_memory_bytes / 1024 / 1024 > 512
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High memory usage detected"
```

### Performance Baselines (From Your Testing)

- **Response Time:** <5ms average (Alert if >50ms)
- **Error Rate:** <1% (Alert if >2%)
- **Memory Usage:** <512MB (Alert if >1GB)
- **CPU Usage:** <50% (Alert if >80%)

## Dashboard Metrics

### Application Performance

```javascript
// Key metrics to track
const metrics = {
  responseTime: {
    target: '<5ms',
    warning: '>10ms', 
    critical: '>50ms'
  },
  errorRate: {
    target: '<1%',
    warning: '>2%',
    critical: '>5%'
  },
  throughput: {
    target: '>100 req/s',
    warning: '<50 req/s'
  }
};
```

### Security Monitoring

```bash
# Monitor authentication failures
grep "authentication failed" /var/log/mgmt-vibe/security.log | tail -20

# Monitor rate limiting
grep "rate limit exceeded" /var/log/mgmt-vibe/access.log | tail -20

# Monitor suspicious patterns
grep -E "(sql injection|xss|csrf)" /var/log/mgmt-vibe/security.log
```

## Automated Health Checks

### Basic Health Check Script

```bash
#!/bin/bash
# health-check.sh

ENDPOINT="http://localhost:5000/api/health"
RESPONSE=$(curl -s -w "%{http_code}" $ENDPOINT)
HTTP_CODE="${RESPONSE: -3}"

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Health check passed"
    exit 0
else
    echo "❌ Health check failed - HTTP $HTTP_CODE"
    exit 1
fi
```

### Performance Validation Script

```bash
#!/bin/bash
# performance-check.sh

# Test response time
RESPONSE_TIME=$(curl -w "%{time_total}" -o /dev/null -s http://localhost:5000/api/health)
THRESHOLD=0.05  # 50ms

if (( $(echo "$RESPONSE_TIME < $THRESHOLD" | bc -l) )); then
    echo "✅ Performance check passed: ${RESPONSE_TIME}s"
else
    echo "⚠️ Performance degraded: ${RESPONSE_TIME}s (threshold: ${THRESHOLD}s)"
fi
```

## Production Monitoring Checklist

### Week 1 - Initial Monitoring

- [ ] Health checks running every 30 seconds
- [ ] Performance metrics collected every minute
- [ ] Error logs monitored in real-time
- [ ] Security events tracked
- [ ] Resource usage monitored

### Week 2 - Pattern Analysis

- [ ] Identify peak usage patterns
- [ ] Analyze error trends
- [ ] Review performance under real load
- [ ] Validate security measures effectiveness

### Month 1 - Optimization

- [ ] Fine-tune alert thresholds based on real data
- [ ] Optimize performance bottlenecks identified
- [ ] Enhance security monitoring based on threats observed
- [ ] Plan scaling strategies based on growth patterns

## Incident Response Procedures

### Response Time Degradation

1. Check system resources (CPU, memory, disk)
2. Review recent deployments or changes
3. Analyze database performance
4. Check network connectivity
5. Scale horizontally if needed

### High Error Rates

1. Check application logs for error patterns
2. Verify database connectivity
3. Check external service dependencies
4. Review recent code changes
5. Consider rollback if critical

### Security Incidents

1. Immediately review security logs
2. Check for suspicious IP patterns
3. Verify rate limiting effectiveness
4. Review authentication logs
5. Consider temporary IP blocking if needed

## Monitoring Tools Integration

### Prometheus Metrics

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'mgmt-vibe'
    static_configs:
      - targets: ['localhost:5000']
    metrics_path: '/metrics'
```

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "mgmt-vibe Production Monitoring",
    "panels": [
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "http_request_duration_seconds{quantile=\"0.95\"}"
          }
        ]
      },
      {
        "title": "Error Rate", 
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])"
          }
        ]
      }
    ]
  }
}
```

---

**🎯 Monitoring Status: Ready for Production**

Your platform's excellent baseline performance (sub-5ms response times, 98% reliability) provides a strong foundation for production monitoring. Focus on maintaining these standards while watching for the load-related issues identified in testing.
