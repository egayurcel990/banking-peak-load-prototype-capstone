# Implementation Plan

## Phase 1 — Baseline
- [x] Seed data generator (`cmd/seeds/main.go`) — 100K accounts, 1M transactions
- [x] Real balance validation + atomic debit/credit on transaction creation
- [x] k6 realistic mixed workload (`scripts/load-test/mixed.js`) for baseline and optimized comparison

## Phase 2 — Optimizations
- [x] Redis cache-aside for GET /accounts/:id/balance and GET /transactions/:id/status
- [x] Cache invalidation on writes
- [x] RabbitMQ producer — publish transaction to queue (return 202 + pending)
- [x] RabbitMQ consumer / worker — process queued transactions, update DB
- [x] Circuit breaker middleware (`sony/gobreaker`) wrapping DB/cache/queue calls
- [x] Route reads to PostgreSQL replica when `DB_READ_REPLICA_ENABLED=true`

## Phase 3 — Observability
- [x] Prometheus scrape config (`deployments/prometheus/prometheus.yml`)
- [x] Grafana dashboard provisioning (TPS, p95 latency, error rate, cache hit rate)
- [x] k6 write-path and stress scripts (`optimized.js`, `rampup.js`, `spike.js`, `sustained.js`, `full.js`)
