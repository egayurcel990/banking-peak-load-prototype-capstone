# Development Guide

## Prerequisites

- Go 1.25
- Docker & Docker Compose v2
- k6 (for load testing)
- kubectl and a local Kubernetes cluster such as Docker Desktop Kubernetes, minikube, or kind (for Kubernetes runs)
- Make (optional, for convenience commands)

## Project Structure

```
banking-peak-load-prototype/
├── CLAUDE.md                  # Claude Code context
├── docker-compose.yml         # All services with profiles
├── .env.baseline              # Feature flags all OFF
├── .env.optimized             # Feature flags all ON
├── .env                       # Active config (gitignored, copy from preset)
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md
│   ├── WORKFLOW.md
│   └── adrs/
│       ├── 001-go-over-rust.md
│       ├── 002-feature-flag-over-branches.md
│       ├── 003-pgbouncer-connection-pooling.md
│       ├── 004-redis-caching-strategy.md
│       └── 005-async-write-via-queue.md
├── cmd/
│   └── server/
│       └── main.go            # Entry point
├── internal/
│   ├── config/                # Env-based configuration
│   ├── handler/               # HTTP handlers per endpoint
│   ├── middleware/             # Rate limiter, circuit breaker, logging, tracing
│   ├── repository/            # DB access (with cache-aside logic)
│   ├── service/               # Business logic
│   ├── queue/                 # Queue producer + consumer/worker
│   └── model/                 # Domain types
├── migrations/                # SQL migrations
├── seeds/                     # Dummy data generation scripts
├── scripts/
│   ├── load-test/             # k6 scripts
│   └── setup/                 # Helper scripts (seed, wait-for-db, etc.)
├── deployments/
│   ├── docker/                # Dockerfiles
│   ├── k8s/                   # Kubernetes manifests
│   ├── pgbouncer/             # PgBouncer config
│   ├── prometheus/            # prometheus.yml
│   └── grafana/               # Dashboard JSON provisioning
└── Makefile
```

## Quick Start

```bash
# 1. Clone and setup
cp .env.baseline.example .env

# 2. Run baseline
docker compose up -d

# 3. Run optimized
cp .env.optimized.example .env
docker compose --profile optimized up -d

# 4. Run full stack (with observability)
docker compose --profile optimized --profile observability up -d

# 5. Run load test
k6 run scripts/load-test/mixed.js
```

## Kubernetes Local Run

The manifests in `deployments/k8s/` run the optimized prototype stack in Kubernetes: app, PostgreSQL, PgBouncer, Redis, RabbitMQ, Prometheus, Grafana, ConfigMap/Secret, namespace, and HPA.

Start a local cluster first, then apply the manifests:

```bash
make k8s-up
make k8s-status
```

Expose the API locally. This command keeps running, so leave it open in its own terminal:

```bash
make k8s-port-forward
```

Try the app from another terminal:

```bash
curl http://localhost:8080/metrics
curl http://localhost:8080/api/v1/accounts/1001/balance
```

Seed dummy data by forwarding PostgreSQL in a separate terminal:

```bash
make k8s-port-forward-db
```

Then run:

```bash
make k8s-seed
```

Run the optimized load test against the forwarded Kubernetes app:

```bash
make k8s-load-test
```

Optional observability port-forwards:

```bash
make k8s-port-forward-prometheus
make k8s-port-forward-grafana
```

Grafana is available at `http://localhost:3000` with `admin` / `admin`.

Clean up:

```bash
make k8s-down
```

Default local ports are `8080` for the app, `15432` for PostgreSQL, `9090` for Prometheus, and `3000` for Grafana. Override them with Make variables, for example `make K8S_APP_PORT=18080 k8s-port-forward`.

Review image names, secrets, and environment variables before applying the manifests to a shared cluster. The app manifest currently pulls `ghcr.io/ahargunyllib/banking-peak-load-prototype:latest`; for local code changes, build and publish an image your cluster can pull, or load the image into your local cluster and update `deployments/k8s/app.yaml`. The HPA requires `metrics-server`; without it, the app still runs, but autoscaling metrics will not be available.

## Environment Variables

### Application
| Var | Default | Description |
|-----|---------|-------------|
| `APP_PORT` | `8080` | HTTP server port |
| `APP_ENV` | `development` | Environment name |

### Feature Flags
| Var | Default | Description |
|-----|---------|-------------|
| `CACHE_ENABLED` | `false` | Enable Redis cache for read path |
| `QUEUE_ENABLED` | `false` | Enable async write via message queue |
| `RATE_LIMIT_ENABLED` | `false` | Enable rate limiting middleware |
| `RATE_LIMIT_RPS` | `100` | Requests per second per client |
| `RATE_LIMIT_BURST` | `200` | Burst allowance |
| `CIRCUIT_BREAKER_ENABLED` | `false` | Enable circuit breaker |
| `CB_MAX_FAILURES` | `5` | Failures before circuit opens |
| `CB_TIMEOUT_SECONDS` | `10` | Duration circuit stays open |
| `DB_READ_REPLICA_ENABLED` | `false` | Route reads to replica |

### Database
| Var | Default | Description |
|-----|---------|-------------|
| `DB_PRIMARY_DSN` | `postgres://...` | Primary PostgreSQL DSN |
| `PGBOUNCER_DSN` | `postgres://...` | PgBouncer write-pool DSN (routes to primary) |
| `PGBOUNCER_READ_DSN` | `postgres://...` | PgBouncer read-pool DSN (routes to replica; required when `DB_READ_REPLICA_ENABLED=true`) |

### Redis
| Var | Default | Description |
|-----|---------|-------------|
| `REDIS_ADDR` | `redis:6379` | Redis address |
| `CACHE_BALANCE_TTL` | `10s` | TTL for balance cache |
| `CACHE_TX_STATUS_TTL` | `30s` | TTL for completed tx status |

### Queue
| Var | Default | Description |
|-----|---------|-------------|
| `QUEUE_URL` | `amqp://...` | RabbitMQ connection URL |
| `QUEUE_WORKERS` | `10` | Number of concurrent consumers |

## Coding Conventions

- **Router:** echo
- **DB driver:** pgx/v5 (connect through PgBouncer)
- **Config:** env vars loaded via `caarlos0/env` or `kelseyhightower/envconfig`
- **Errors:** Wrap with context, don't swallow
- **Logging:** `slog` (stdlib) with JSON output, always include `trace_id`
- **Metrics:** `prometheus/client_golang`, register in `init()` or dependency injection
- **Naming:** snake_case for JSON fields, camelCase for Go

## Testing

```bash
# Unit tests
go test ./...

# Integration tests (requires docker compose up)
go test -tags=integration ./...

# Load tests
k6 run scripts/load-test/mixed.js
k6 run scripts/load-test/optimized.js
```

### Load Test Scripts

| Script | Description | Best fit |
|--------|-------------|----------|
| `scripts/load-test/mixed.js` | Primary realistic workload: 70% reads and 30% writes. Read traffic covers balance inquiry and transaction status inquiry, with a hot-read pool so Redis cache behavior shows up in metrics. | Baseline vs optimized comparison, Grafana dashboard validation, SLO demo. |
| `scripts/load-test/optimized.js` | Write-only ramping arrival-rate test for `POST /api/v1/transactions`, peaking at 1000 req/s. | Async queue and write-path latency demo. |
| `scripts/load-test/rampup.js` | Write-only gradual ramp with configurable rate step and stage duration. | Finding the approximate throughput ceiling. |
| `scripts/load-test/spike.js` | Write-only short spike designed to trigger protection layers. | Rate limiter and circuit breaker behavior, including HTTP 429/503. |
| `scripts/load-test/sustained.js` | Write-only constant high load, default 800 req/s for 30 minutes. | Long-duration stability of PgBouncer, RabbitMQ, and DB writes. |
| `scripts/load-test/full.js` | Write-only ramp-up, spike, and sustained phases in one run. | A heavier stress rehearsal after the focused scripts pass. |

Common overrides:

```bash
RATE=300 DURATION=5m k6 run scripts/load-test/mixed.js
BASE_URL=http://localhost:8080 RATE=300 DURATION=5m k6 run scripts/load-test/mixed.js
nix develop -c k6 run scripts/load-test/mixed.js
```

## Dummy Data

Seed script generates:
- 100K accounts with random balances (1M-100M IDR range)
- 1-5M historical transactions across those accounts
- Realistic distribution of transaction statuses (completed, pending, failed)

```bash
go run ./cmd/seeds/main.go
nix develop -c go run ./cmd/seeds/main.go
```
