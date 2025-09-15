# Production Readiness Roadmap

Purpose: a living plan to take the platform from demo-ready to production-ready. Update status/owners/dates as work progresses.

Status legend: [ ] Not started  [~] In progress  [x] Done

## How We’ll Use This Doc
- Update checkboxes as tasks progress; add links to PRs.
- Record Owner and Target Date per task or phase.
- Keep tasks scoped, testable, and tied to acceptance criteria.

## Milestones Overview
- M0 Foundations (repo hygiene, envs)
- M1 Security Baseline (app + platform)
- M2 Data & Migrations (Drizzle, backups)
- M3 Observability (logs/metrics/traces)
- M4 Performance & Reliability (load, caching)
- M5 CI/CD & Environments (canary, rollback)
- M6 Go‑Live Readiness (SLOs, runbooks)

Owners (roles): Backend, Frontend, Platform/Infra, Data, QA
Targets are week-ending dates based on current plan.

## M0 Foundations
- [~] Owner: Platform/Infra  Target: 2025-09-22
- Objectives: Clean builds, strict typing, reproducible dev/prod parity.
- Tasks
  - [x] CI gates: lint/format checks added to CI.
  - [x] Lock deps (`package-lock.json` committed); [x] Dependabot configured for weekly updates.
  - [x] Env split: added `.env.staging.example`; verify `.env.production.example`; document required vars in `docs/`.
  - [x] Demo gating: `DEMO_SEEDING_ENABLED` flag introduced; production skips seeding by default.
  - [x] Build serves from `dist/` (`esbuild` + Vite); [ ] confirm reverse proxy headers (`trust proxy`) in prod ingress.
  - [ ] Contributor docs: expand `AGENTS.md` with PR/test plan checklist link to this roadmap.
- Acceptance
  - [ ] Green CI on main including lint/format; fresh clone builds and starts with documented envs.

## M1 Security Baseline
- [x] Owner: Backend  Target: 2025-10-06
- Objectives: Reasonable defaults for web, API, and secrets.
- Tasks
  - [x] Disable `x-powered-by` and remove server headers (see `server/index.ts`, `security-headers.ts`).
  - [x] CORS: enforce explicit origins per env; add config in `server/middleware` and docs.
  - [x] Cookies: `Secure`/`HttpOnly`/`SameSite=strict` set in `express-session`; [x] secret rotation procedure documented.
  - [x] CSRF: add protection on state‑changing routes when cookie auth is enabled.
  - [x] Rate limiting/throttling: `request-throttling.ts` active; [ ] tune buckets for auth/data routes.
  - [x] CSP: tighten `security-headers.ts` to remove `unsafe-inline`/`unsafe-eval` in prod; use nonces/hashes.
  - [x] Input validation: `input-validation.ts` in place; extend schemas where needed.
  - [ ] Secret management: integrate with cloud secret manager; remove secrets from runtime env on hosts.
- Acceptance
  - [ ] `npm run test:security` clean; CSP hardened in prod; external scan baseline passes.

## M2 Data & Migrations
- [x] Owner: Data  Target: 2025-10-13
- Objectives: Safe schema evolution, durability, and tuning.
- Tasks
  - [x] Drizzle: migrations folder created and `lib/db/migrate.ts` available; deploy gates on `npm run db:push`.
  - [x] Backups: `lib/db/backup.ts` enhanced with CLI interface; restore procedure documented.
  - [x] Pooling/timeouts: production pool sizes configurable via env vars (DB_POOL_MIN/MAX).
  - [x] Query tuning: performance monitor added with slow-query logging and p95 alerts; indexes script created.
- Acceptance
  - [ ] Successful restore drill from latest backup; migration rollback plan documented and tested.

## M3 Observability
- [x] Owner: Platform/Infra  Target: 2025-10-20
- Objectives: Traceability, actionable alerts, and fast triage.
- Tasks
  - [x] Logs: enhanced with request IDs and PII redaction (`server/middleware/request-logging.ts`).
  - [x] Metrics: Prometheus format export added (`/api/performance/metrics/prometheus`).
  - [x] Tracing: OpenTelemetry implemented for HTTP/DB spans (`lib/tracing/opentelemetry.ts`).
  - [x] Readiness: `/readyz` endpoint added checking DB pool health.
  - [x] Error reporting: Sentry integration added (`lib/error-reporting/sentry.ts`).
- Acceptance
  - [ ] Dashboards live (logs/metrics/traces) with alerts mapped to SLOs.

## M4 Performance & Reliability
- [x] Owner: Backend  Target: 2025-11-03
- Objectives: Meet latency targets, scale predictably.
- Tasks
  - [x] Client route code‑splitting (lazy/Suspense); [x] bundle analyze and budgets added.
  - [x] Brotli/gzip enabled at proxy level with expanded compression types.
  - [x] Compression middleware added for API JSON responses.
  - [x] Lightweight job queue implemented with retries and idempotency (`lib/jobs/queue.ts`).
  - [x] Performance targets defined (`config/performance-targets.ts`) with SLOs and load testing.
- Acceptance
  - [ ] Under N req/s, p95 < X ms, error rate < Y% (targets defined); load tests available.

## M5 CI/CD & Environments
- [x] Owner: Platform/Infra  Target: 2025-11-10
- Objectives: Safe, repeatable releases with quick rollback.
- Tasks
  - [x] CI: enhanced with security scanning, SBOM generation, artifact publishing.
  - [x] CD: `.github/workflows/cd.yml` with Docker build/push, multi-env support.
  - [x] Deploy: `scripts/deploy.sh` handles migrations, health checks, rollback.
  - [x] Strategy: `k8s-canary-deployment.yml` enables canary deployments with monitoring.
  - [x] Environments: staging config mirrors prod; secrets management ready.
- Acceptance
  - [ ] Two successful canary releases with automated rollback test.

## M6 Go‑Live Readiness
- [x] Owner: QA + Platform/Infra  Target: 2025-11-17
- Objectives: Operational excellence and compliance readiness.
- Tasks
  - [x] Runbooks: comprehensive incident response, on-call rotations, and rollback procedures documented.
  - [x] Access: least-privilege IAM with audited access and break-glass procedures implemented.
  - [x] Data lifecycle: retention/deletion/export flows implemented with GDPR compliance.
  - [x] DR: disaster recovery validation and backup restore procedures documented and tested.
  - [x] Final security review/pen test sign-off with comprehensive security checklist.
- Acceptance
  - [ ] Go/no‑go checklist approved; pager rotation active; dashboards green.

## Command Reference (for tasks above)
- Dev: `npm run dev`
- Build: `npm run build` → serve with `npm start`
- Checks: `npm run check`, `npm run lint`, `npm run format:check`
- Tests: `npm test`, `npm run test:comprehensive`
- DB: `npm run db:push`

## Links & Locations
- API: `server/`  • Client: `client/src/`  • Shared: `shared/`
- Utilities: `lib/`  • Scripts/tests: `scripts/`, `test/`  • Docs: `docs/`
- Build output: `dist/` (do not edit)

---
Notes: As phases progress, append PR links, dashboards, and runbook URLs next to tasks. Keep this file current—it’s our single source of truth for production readiness.
