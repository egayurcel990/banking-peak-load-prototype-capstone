# Observability Dashboard

Dashboard Grafana `Banking Peak Load Monitor` dipakai untuk demo kondisi baseline vs optimized saat load test. Panelnya fokus ke tanda-tanda sistem masih sanggup menerima peak load, proteksi aktif, dan bottleneck mulai terlihat.

## Cara Menjalankan

```bash
docker compose --profile optimized --profile observability up -d --build
nix develop -c k6 run scripts/load-test/mixed.js
```

- Grafana: <http://localhost:3000> (`admin` / `admin`)
- Prometheus: <http://localhost:9090>
- API metrics: <http://localhost:8080/metrics>

Gunakan `scripts/load-test/mixed.js` untuk demo utama dashboard karena traffic-nya mengikuti PRD: 70% read dan 30% write. Script ini mengisi panel read latency, write latency, Redis cache hit ratio, queue depth, throughput, error rate, dan dependency health secara bersamaan.

## Script Load Test

| Script | Deskripsi |
| --- | --- |
| `mixed.js` | Workload utama untuk observability: 70% read / 30% write, balance inquiry, transaction status inquiry, dan create transaction. Cocok untuk demo baseline vs optimized. |
| `optimized.js` | Write-only ramping load untuk menguji async queue, rate limiter, dan write latency pada konfigurasi optimized. |
| `rampup.js` | Write-only ramp bertahap untuk mencari titik jenuh throughput. |
| `spike.js` | Write-only spike singkat untuk melihat proteksi seperti HTTP 429 dan 503. |
| `sustained.js` | Write-only constant high load untuk stabilitas jangka panjang. |
| `full.js` | Gabungan write-only ramp-up, spike, dan sustained untuk stress rehearsal yang lebih berat. |

## Stat Panel / Gauge

| Panel | Target | Metric / Query |
| --- | --- | --- |
| Total Throughput (TPS) | `>= 278` transaksi/detik | `sum(rate(banking_api_requests_total{url!="/metrics"}[1m]))` |
| P95 Latency | `<= 2s` | `histogram_quantile(0.95, sum(rate(banking_api_request_duration_seconds_bucket{url!="/metrics"}[5m])) by (le))` |
| Global Error Rate | `< 1%` HTTP 5xx | 5xx rate dibagi total request rate |
| Uptime / Availability | `>= 99.9%` | `up{job="banking-api"}` untuk API dan `dependency_up{dependency="database"}` untuk DB |

## Time Series

| Panel | Target / Interpretasi | Metric / Query |
| --- | --- | --- |
| Rate Limiter Drops | Naik saat proteksi menolak request berlebih | `sum(rate(rate_limiter_drops_total[1m]))` |
| Redis Cache Hit Ratio | `> 70%` untuk read path | hit dibagi hit + miss dari `cache_hits_total` dan `cache_misses_total` |
| RabbitMQ Queue Depth | Stabil atau turun setelah burst | `queue_depth{queue="transactions"}` |
| Circuit Breaker Status | `0=Closed`, `1=Open`, `2=Half-open` | `circuit_breaker_state{dependency="api"}` |

## Time Series dan Bar Gauge

| Panel | Target / Interpretasi | Metric / Query |
| --- | --- | --- |
| PostgreSQL Active Connections | Jangan melewati 100 koneksi aktif | `db_connections_active` dengan garis batas `vector(100)` |
| CPU & Memory Utilization | Waspada saat `> 70%`, kritis saat `> 90%` | `app_cpu_utilization_ratio` dan `app_memory_utilization_ratio` |

## Catatan Implementasi

- HTTP metric berasal dari `echo-prometheus` dengan prefix `banking_api_*`.
- `rate_limiter_drops_total` naik ketika Echo rate limiter mengembalikan HTTP 429.
- `queue_depth` diambil langsung dari RabbitMQ lewat `QueueInspect`, jadi tidak butuh RabbitMQ exporter terpisah.
- `dependency_up` di-update periodik dari aplikasi: database lewat `PingContext`, Redis lewat `PING`, dan RabbitMQ lewat queue inspection.
- CPU/memory utilization adalah estimasi proses API. Memory ratio memakai limit container cgroup kalau tersedia, atau fallback `APP_MEMORY_LIMIT_BYTES` / `512MiB` untuk demo lokal.
