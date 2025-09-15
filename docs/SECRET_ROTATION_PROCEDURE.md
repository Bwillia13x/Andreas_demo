# Secret Rotation Procedure

This document outlines the procedure for rotating sensitive secrets used in the mgmt_vibe_production application, including session secrets, database credentials, and API keys.

## Overview

Regular secret rotation is a critical security practice that minimizes the impact of compromised credentials. This application uses the following types of secrets:

- Session secrets (for cookie signing)
- Database credentials
- Third-party API keys (OpenAI, Stripe, etc.)
- Encryption keys

## Session Secret Rotation

### When to Rotate
- Every 90 days in production
- Immediately if compromise is suspected
- After any security incident

### Procedure
1. **Generate New Secret**
   ```bash
   # Generate a cryptographically secure 32-byte secret
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Update Environment Variables**
   - Update `SESSION_SECRET` in your environment configuration
   - For zero-downtime rotation, maintain both old and new secrets temporarily

3. **Deploy Changes**
   ```bash
   npm run build
   npm start
   ```

4. **Monitor Session Invalidation**
   - Monitor application logs for authentication errors
   - Expect some user re-authentication during the rotation window
   - Old sessions will be invalidated when they expire or users re-authenticate

5. **Cleanup**
   - After 24 hours, remove old secret references
   - Update any secret management systems

## Database Credential Rotation

### When to Rotate
- Every 30 days for application credentials
- Immediately after personnel changes
- Following security incidents

### Procedure
1. **Create New Database User/Credentials**
   ```sql
   -- PostgreSQL example
   CREATE USER new_app_user WITH ENCRYPTED PASSWORD 'new_secure_password';
   GRANT CONNECT ON DATABASE your_database TO new_app_user;
   GRANT USAGE ON SCHEMA public TO new_app_user;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO new_app_user;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO new_app_user;
   ```

2. **Update Environment Variables**
   - Update `DATABASE_URL` or relevant database connection variables
   - Test connection with new credentials

3. **Deploy Application**
   ```bash
   npm run build
   npm start
   ```

4. **Verify Application Health**
   ```bash
   curl -f http://localhost:8080/api/health
   ```

5. **Revoke Old Credentials**
   ```sql
   -- After confirming new credentials work
   REVOKE ALL PRIVILEGES ON DATABASE your_database FROM old_app_user;
   DROP USER old_app_user;
   ```

## API Key Rotation

### OpenAI API Key
1. Generate new API key in OpenAI dashboard
2. Update `OPENAI_API_KEY` environment variable
3. Deploy and test AI features
4. Revoke old API key in OpenAI dashboard

### Stripe API Keys
1. Generate new keys in Stripe dashboard (both publishable and secret)
2. Update `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY`
3. Deploy and test payment flows
4. Deactivate old keys in Stripe dashboard

## Encryption Key Rotation

### When to Rotate
- Every 180 days
- After security incidents involving encrypted data

### Procedure
1. **Generate New Key**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Update Environment Variables**
   - Update encryption key variables (if any)
   - For existing encrypted data, maintain backward compatibility

3. **Data Migration (if needed)**
   - If existing data needs re-encryption, plan a migration strategy
   - Consider downtime or gradual migration

## Automated Rotation

For production environments, consider implementing automated secret rotation:

### Using AWS Secrets Manager
```bash
# Example: Rotate database credentials
aws secretsmanager update-secret \
  --secret-id "prod/mgmt-vibe/database" \
  --secret-string '{"username":"newuser","password":"newpass"}'
```

### Using HashiCorp Vault
- Configure automatic secret rotation policies
- Set up application integration with Vault agent

## Monitoring and Alerts

### Set up alerts for:
- Secret rotation deadlines (30/60/90 days)
- Failed authentication attempts (potential secret compromise)
- Unusual API usage patterns

### Log Analysis
- Monitor for authentication failures
- Track secret usage patterns
- Alert on anomalous credential usage

## Emergency Procedures

### If Secret Compromise is Suspected:
1. **Immediate Action**
   - Generate new secrets immediately
   - Deploy emergency update
   - Notify security team

2. **Investigation**
   - Review access logs
   - Check for data exfiltration
   - Assess breach scope

3. **Communication**
   - Notify affected users if necessary
   - Document incident response

## Best Practices

### General Guidelines
- Never commit secrets to version control
- Use different secrets for different environments
- Implement principle of least privilege
- Regularly audit secret access

### Environment-Specific
- Development: Use easily identifiable test secrets
- Staging: Use production-like secrets with shorter rotation
- Production: Use strong, randomly generated secrets with strict rotation

### Documentation
- Maintain inventory of all secrets used
- Document rotation procedures for each secret type
- Keep emergency contact information current

## Contact Information

For security incidents or questions about secret rotation:
- Security Team: [contact information]
- On-call Engineer: [contact information]
- Incident Response Plan: [link to plan]
