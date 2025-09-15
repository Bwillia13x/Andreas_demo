# Rollback Procedures

## Overview
This document provides procedures for safely rolling back application deployments, database changes, and infrastructure modifications when issues arise in production.

## Rollback Types

### Application Rollback
Reverting application code and configuration changes.

### Database Rollback
Reverting database schema and data changes.

### Infrastructure Rollback
Reverting infrastructure configuration changes.

### Configuration Rollback
Reverting configuration and environment variable changes.

## Application Rollback

### Kubernetes Deployment Rollback
```bash
# Check current deployment status
kubectl get deployments -n mgmt-vibe
kubectl describe deployment mgmt-vibe-app

# View deployment history
kubectl rollout history deployment/mgmt-vibe-app -n mgmt-vibe

# Rollback to previous version
kubectl rollout undo deployment/mgmt-vibe-app -n mgmt-vibe

# Or rollback to specific revision
kubectl rollout undo deployment/mgmt-vibe-app --to-revision=2 -n mgmt-vibe

# Monitor rollback progress
kubectl rollout status deployment/mgmt-vibe-app -n mgmt-vibe
```

### Docker Compose Rollback
```bash
# Stop current deployment
docker-compose down

# Pull previous image version
docker pull ghcr.io/your-org/mgmt-vibe:latest-stable

# Update docker-compose.yml to use stable tag
sed -i 's/:latest/:latest-stable/g' docker-compose.yml

# Start with previous version
docker-compose up -d

# Verify deployment
docker-compose ps
docker-compose logs -f app
```

### Health Verification After Rollback
```bash
# Check application health
curl -f http://localhost:5000/api/health
curl -f http://localhost:5000/readyz

# Verify key functionality
curl -f http://localhost:5000/api/services
curl -f http://localhost:5000/api/staff

# Monitor error rates for 5 minutes
# Check that error rates return to baseline levels
```

## Database Rollback

### Migration Rollback Strategy
Database rollbacks are complex and should be approached carefully:

1. **Prevention First**: Design migrations to be reversible
2. **Backup Always**: Create backups before any schema changes
3. **Test Rollbacks**: Test rollback procedures in staging
4. **Gradual Rollback**: Use feature flags rather than schema changes when possible

### Schema Migration Rollback
```bash
# List recent migrations
npm run db:migrate show

# Create a rollback migration (preferred approach)
# Generate a down migration that reverses the up migration
npx drizzle-kit generate --name rollback_[migration_name]

# Run the rollback
npm run db:migrate down

# Verify database integrity
psql "$DATABASE_URL" -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;"
```

### Data Rollback Scenarios

#### Complete Data Restore
```bash
# Stop application to prevent data modifications
kubectl scale deployment mgmt-vibe-app --replicas=0 -n mgmt-vibe

# Restore from backup (if using logical backups)
pg_restore -d "$DATABASE_URL" --clean --if-exists backup_file.sql

# Or restore from physical backup
# (Consult your database administrator for physical backup restoration)

# Restart application
kubectl scale deployment mgmt-vibe-app --replicas=3 -n mgmt-vibe

# Verify data integrity
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM appointments;"
```

#### Partial Data Restore
For targeted data recovery:
```sql
-- Create temporary table with good data
CREATE TABLE users_backup AS SELECT * FROM users WHERE created_at < 'problematic_timestamp';

-- Restore specific records
INSERT INTO users (SELECT * FROM users_backup)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  -- ... other fields as needed
WHERE users.updated_at > 'problematic_timestamp';

-- Clean up
DROP TABLE users_backup;
```

### Database Rollback Checklist
- [ ] Application stopped to prevent data corruption
- [ ] Database backup created before rollback
- [ ] Rollback migration tested in staging
- [ ] Foreign key constraints temporarily disabled if needed
- [ ] Rollback executed in correct order (reverse of deployment)
- [ ] Data integrity verified after rollback
- [ ] Application restarted and tested
- [ ] Monitoring alerts verified as resolved

## Infrastructure Rollback

### Kubernetes Resource Rollback
```bash
# Rollback ConfigMap changes
kubectl rollout undo configmap/app-config -n mgmt-vibe

# Rollback Secret changes (if using GitOps)
kubectl apply -f k8s/secrets-stable.yml

# Rollback Ingress changes
kubectl apply -f k8s/ingress-stable.yml

# Rollback Service changes
kubectl apply -f k8s/service-stable.yml
```

### Network Configuration Rollback
```bash
# Rollback load balancer configuration
# (Consult cloud provider documentation)

# Rollback DNS changes
# Use DNS provider's rollback features or restore previous records

# Rollback firewall rules
# Remove newly added rules and restore previous configuration
```

### Infrastructure as Code Rollback
```bash
# For Terraform-managed infrastructure
terraform plan -destroy
terraform destroy -target=resource_that_changed

# Or rollback to previous commit
git checkout HEAD~1 -- infrastructure/
terraform apply
```

## Configuration Rollback

### Environment Variables Rollback
```bash
# Rollback via Kubernetes
kubectl apply -f k8s/config-stable.yml

# Or update ConfigMap directly
kubectl patch configmap app-config -n mgmt-vibe --type merge -p '{
  "data": {
    "DATABASE_URL": "previous_value",
    "REDIS_URL": "previous_value"
  }
}'

# Force pod restart to pick up changes
kubectl rollout restart deployment/mgmt-vibe-app -n mgmt-vibe
```

### Feature Flag Rollback
```bash
# Disable problematic feature flags
curl -X POST http://localhost:5000/api/admin/features \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"feature_name": "new_feature", "enabled": false}'

# Or rollback via database
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = false WHERE name = 'problematic_feature';"
```

## Automated Rollback Procedures

### Canary Deployment Rollback
```bash
# Scale down canary deployment
kubectl scale deployment mgmt-vibe-app-canary --replicas=0 -n mgmt-vibe

# Verify stable deployment is handling all traffic
kubectl get pods -n mgmt-vibe -l version=stable

# Update ingress to remove canary routing
kubectl patch ingress mgmt-vibe-ingress -n mgmt-vibe --type=json -p='[
  {"op": "remove", "path": "/metadata/annotations/nginx.ingress.kubernetes.io~1canary"},
  {"op": "remove", "path": "/metadata/annotations/nginx.ingress.kubernetes.io~1canary-weight"}
]'
```

### Blue-Green Deployment Rollback
```bash
# Switch traffic back to blue environment
kubectl patch service mgmt-vibe-service -n mgmt-vibe -p '{
  "spec": {
    "selector": {
      "environment": "blue"
    }
  }
}'

# Scale down green environment
kubectl scale deployment mgmt-vibe-app-green --replicas=0 -n mgmt-vibe

# Verify blue environment is healthy
curl -f http://localhost:5000/api/health
```

## Rollback Validation

### Pre-Rollback Checks
- [ ] Business impact assessment completed
- [ ] Rollback plan reviewed and approved
- [ ] Backup of current state created
- [ ] Rollback procedure tested in staging
- [ ] Communication plan prepared

### Post-Rollback Validation
- [ ] Application health checks pass
- [ ] Key functionality verified
- [ ] Error rates returned to baseline
- [ ] Performance metrics normal
- [ ] Customer impact confirmed resolved
- [ ] Monitoring alerts cleared

### Rollback Success Criteria
- [ ] All health endpoints return 200
- [ ] Error rate < 1% for 5 minutes post-rollback
- [ ] P95 response time < target threshold
- [ ] No customer reports of issues
- [ ] All monitoring alerts resolved

## Rollback Time Guidelines

### Target Rollback Times
- **Application Code**: < 10 minutes
- **Configuration**: < 5 minutes
- **Database Schema**: < 15 minutes (with tested rollback migration)
- **Complete Data Restore**: < 30 minutes (with recent backup)
- **Infrastructure**: < 20 minutes

### Rollback Decision Framework
- **Immediate Rollback**: If user impact is severe and root cause is known
- **Controlled Rollback**: If impact is manageable and fix can be deployed quickly
- **No Rollback**: If rollback risk exceeds current impact or fix is imminent

## Communication During Rollback

### Internal Communication
- Update incident ticket with rollback status
- Notify team via incident channel
- Provide regular status updates

### External Communication
- Update status page with rollback progress
- Notify customers of resolution timeline
- Provide post-resolution summary

## Post-Rollback Activities

### Immediate Actions
- [ ] Monitor system for 30 minutes post-rollback
- [ ] Verify all automated tests pass
- [ ] Confirm customer impact resolved
- [ ] Update incident ticket with resolution

### Follow-up Actions
- [ ] Schedule post-mortem meeting within 48 hours
- [ ] Analyze why rollback was needed
- [ ] Improve deployment and testing processes
- [ ] Update rollback procedures based on lessons learned

## Tools and Automation

### Automated Rollback Tools
```bash
# Use deployment scripts for consistent rollbacks
./scripts/deploy.sh rollback

# Automated health checks
curl -f http://localhost:5000/api/health || ./scripts/deploy.sh emergency-rollback

# Database migration rollback
npm run db:migrate rollback -- --to [migration_id]
```

### Monitoring During Rollback
- Set up rollback-specific alerts
- Monitor key metrics throughout process
- Have manual intervention points
- Document all actions taken

---

**Last Updated**: [Date]
**Document Owner**: [Platform Team]
**Review Frequency**: Quarterly
