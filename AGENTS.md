# Banking Peak Load Prototype

## Project Overview

University group project (3 SKS) simulating CIMB Niaga's peak load management problem: 1M transactions/hour causing crashes, 10s latency, and cost spikes. We build a prototype demonstrating defense-in-depth scalability — not a real banking system.

## Key Docs

- `docs/PRD.md` — Product Requirements Document
- `docs/DEVELOPMENT.md` — Development setup, conventions, tooling
- `docs/WORKFLOW.md` — Git workflow, branch strategy, CI
- `docs/ARCHITECTURE.md` — System architecture and design decisions
- `docs/adrs/` — Architecture Decision Records

## Tech Stack

- **Language:** Go
- **Database:** PostgreSQL 16 + PgBouncer (connection pooling)
- **Cache:** Redis 7
- **Queue:** RabbitMQ (or Redis Streams)
- **Observability:** Prometheus + Grafana
- **Load Testing:** k6
- **Infra:** Docker Compose (no cloud required)

## Endpoints

| Method | Path | Type | Description |
|--------|------|------|-------------|
| POST | /api/v1/transactions | Write | Create transaction (async via queue when enabled) |
| GET | /api/v1/transactions/:id/status | Read | Transaction status inquiry |
| GET | /api/v1/accounts/:id/balance | Read | Account balance inquiry |

## Feature Flags

All protection/optimization layers are toggleable via env vars:

- `CACHE_ENABLED` — Redis cache for read path
- `QUEUE_ENABLED` — Async write via message queue
- `RATE_LIMIT_ENABLED` — Token bucket rate limiting
- `CIRCUIT_BREAKER_ENABLED` — Fail-fast on unhealthy downstream
- `DB_READ_REPLICA_ENABLED` — Route reads to replica

Baseline = all flags off. Optimized = all flags on.

## Docker Compose Profiles

- `docker compose up` — Baseline (API + PostgreSQL only)
- `docker compose --profile optimized up` — + Redis, RabbitMQ, replica
- `docker compose --profile observability up` — + Prometheus, Grafana
- `docker compose --profile optimized --profile observability up` — Full stack

## SLO Targets

- Availability: 99.5% non-5xx during peak
- Latency: p95 < 500ms (read), p95 < 2s (write)
- Throughput: 300 TPS sustained
