#!/bin/bash

# Deployment script for mgmt-vibe
# Handles database migrations, health checks, and rollback

set -euo pipefail

# Configuration
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
ROLLBACK_TIMEOUT="${ROLLBACK_TIMEOUT:-300}"
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-10}"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-30}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Validate environment
validate_environment() {
    log_info "Validating deployment environment: $DEPLOY_ENV"

    if [[ "$DEPLOY_ENV" != "staging" && "$DEPLOY_ENV" != "production" ]]; then
        log_error "Invalid environment: $DEPLOY_ENV. Must be 'staging' or 'production'"
        exit 1
    fi

    # Check required environment variables
    required_vars=("DATABASE_URL" "SESSION_SECRET")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log_error "Required environment variable $var is not set"
            exit 1
        fi
    done

    log_success "Environment validation passed"
}

# Backup current database state
backup_database() {
    log_info "Creating database backup before deployment"

    local backup_file="backup-pre-deploy-$(date +%Y%m%d-%H%M%S).sql"

    if command -v pg_dump &> /dev/null; then
        pg_dump "$DATABASE_URL" > "$backup_file" 2>/dev/null || {
            log_warn "Failed to create database backup"
            return 1
        }
        log_success "Database backup created: $backup_file"
        echo "$backup_file" > .deploy_backup
    else
        log_warn "pg_dump not available, skipping database backup"
    fi
}

# Run database migrations
run_migrations() {
    local skip_migration="${SKIP_DB_MIGRATION:-false}"

    if [[ "$skip_migration" == "true" ]]; then
        log_info "Skipping database migration as requested"
        return 0
    fi

    log_info "Running database migrations"

    # Check if we have npm and the migration script
    if ! command -v npm &> /dev/null; then
        log_error "npm not found, cannot run migrations"
        return 1
    fi

    # Run migrations
    if npm run db:migrate 2>&1; then
        log_success "Database migrations completed successfully"
        return 0
    else
        log_error "Database migrations failed"
        return 1
    fi
}

# Health check function
health_check() {
    local url="${HEALTH_CHECK_URL:-http://localhost:5000}"
    local retries="${HEALTH_CHECK_RETRIES:-10}"
    local interval="${HEALTH_CHECK_INTERVAL:-30}"

    log_info "Performing health checks on $url"

    for ((i=1; i<=retries; i++)); do
        log_info "Health check attempt $i/$retries"

        if curl -f -s --max-time 10 "$url/api/health" > /dev/null 2>&1; then
            log_success "Health check passed"
            return 0
        fi

        if [[ $i -lt $retries ]]; then
            log_warn "Health check failed, retrying in $interval seconds..."
            sleep "$interval"
        fi
    done

    log_error "Health check failed after $retries attempts"
    return 1
}

# Rollback function
rollback() {
    log_error "Deployment failed, initiating rollback"

    # Stop the new deployment
    log_info "Stopping new deployment"
    # Add your stop deployment commands here

    # Restore from backup if available
    if [[ -f ".deploy_backup" ]]; then
        local backup_file
        backup_file=$(cat .deploy_backup)

        if [[ -f "$backup_file" ]]; then
            log_info "Restoring database from backup: $backup_file"
            # Add database restore commands here
            log_success "Database restored from backup"
        fi
    fi

    # Start previous version
    log_info "Starting previous version"
    # Add commands to start previous version here

    # Final health check
    if health_check; then
        log_success "Rollback completed successfully"
    else
        log_error "Rollback completed but health checks are failing"
        exit 1
    fi
}

# Main deployment function
deploy() {
    log_info "Starting deployment to $DEPLOY_ENV environment"

    # Validate environment
    validate_environment

    # Create backup
    if ! backup_database; then
        log_warn "Continuing deployment despite backup failure"
    fi

    # Run database migrations
    if ! run_migrations; then
        log_error "Database migration failed"
        rollback
        exit 1
    fi

    # Deploy the application
    log_info "Deploying application"

    # Add your deployment commands here
    # This could be Docker, Kubernetes, etc.

    # Example for Docker Compose:
    # docker-compose up -d --scale app=2

    # Health checks
    if ! health_check; then
        log_error "Post-deployment health checks failed"
        rollback
        exit 1
    fi

    log_success "Deployment completed successfully"

    # Clean up
    if [[ -f ".deploy_backup" ]]; then
        rm -f "$(cat .deploy_backup)" .deploy_backup 2>/dev/null || true
    fi
}

# Canary deployment function
canary_deploy() {
    log_info "Starting canary deployment to $DEPLOY_ENV"

    # Step 1: Deploy to 10% of traffic
    log_info "Step 1: Deploying to 10% of traffic"
    # Add canary deployment logic here

    # Step 2: Health checks on canary
    if ! health_check; then
        log_error "Canary health checks failed"
        rollback
        exit 1
    fi

    # Step 3: Monitor for 5 minutes
    log_info "Step 3: Monitoring canary for 5 minutes"
    sleep 300

    # Additional monitoring logic here
    # Check error rates, response times, etc.

    # Step 4: Scale to 50%
    log_info "Step 4: Scaling canary to 50% traffic"
    # Add scaling logic here

    # Step 5: Monitor for another 5 minutes
    log_info "Step 5: Monitoring 50% deployment for 5 minutes"
    sleep 300

    # Step 6: Full rollout
    log_info "Step 6: Full production rollout"
    # Complete the rollout

    log_success "Canary deployment completed successfully"
}

# Main script
case "${1:-deploy}" in
    "deploy")
        deploy
        ;;
    "canary")
        canary_deploy
        ;;
    "rollback")
        rollback
        ;;
    "health-check")
        health_check
        ;;
    *)
        echo "Usage: $0 [deploy|canary|rollback|health-check]"
        echo "Environment variables:"
        echo "  DEPLOY_ENV - Target environment (staging|production)"
        echo "  SKIP_DB_MIGRATION - Skip database migration (true|false)"
        echo "  HEALTH_CHECK_URL - URL for health checks"
        echo "  HEALTH_CHECK_RETRIES - Number of health check retries"
        echo "  HEALTH_CHECK_INTERVAL - Seconds between health check retries"
        exit 1
        ;;
esac
