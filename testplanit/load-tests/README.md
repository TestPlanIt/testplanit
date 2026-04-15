# TestPlanIt Load Testing Suite

Performance and load testing for TestPlanIt using [k6](https://grafana.com/docs/k6/).

## Prerequisites

Install k6:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
  sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Setup

### 1. Create an API Token

1. Log in to TestPlanIt as an admin user
2. Go to Admin > Users > edit the test user > enable **API Access**
3. Go to user profile > **API Tokens** > create a new token
4. Copy the `tpi_...` token — it's only shown once

### 2. Seed Test Data

Before running load tests, populate the environment with realistic data:

```bash
k6 run --env BASE_URL=http://your-instance:3000 \
       --env API_TOKEN=tpi_your_token \
       --env SEED_PROJECTS=10 \
       --env SEED_CASES_PER_PROJECT=500 \
       --env SEED_FOLDERS_PER_PROJECT=20 \
       --env SEED_RUNS_PER_PROJECT=10 \
       seed.js
```

For BBVA-scale testing (millions of tests), increase the counts:

```bash
k6 run --env BASE_URL=http://your-instance:3000 \
       --env API_TOKEN=tpi_your_token \
       --env SEED_PROJECTS=100 \
       --env SEED_CASES_PER_PROJECT=10000 \
       --env SEED_FOLDERS_PER_PROJECT=50 \
       --env SEED_RUNS_PER_PROJECT=50 \
       seed.js
```

### 3. Note the Project ID

After seeding, pick a project ID to use for single-project tests. You can find IDs
in the seed output or via the app.

## Running Tests

### Individual Scenarios

Each scenario tests a specific use case in isolation:

```bash
# Browse project hierarchy
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 scenarios/01-browse-hierarchy.js

# Test case CRUD and versioning
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 scenarios/02-versioning-crud.js

# Test run lifecycle (create, execute, complete)
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 scenarios/03-test-lifecycle.js

# Search with filters and typeahead
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 scenarios/04-search.js

# Cross-project reporting and analytics
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 scenarios/05-reporting.js

# CI/CD JUnit result ingestion
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 scenarios/06-cicd-ingestion.js
```

### Mixed Workload (Primary Test)

Combines all scenarios with realistic traffic distribution:

```bash
k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
       --env PROJECT_ID=1 --env PROFILE=load mixed-workload.js
```

### Load Profiles

Control the VU ramp pattern via the `PROFILE` env var:

| Profile    | VUs    | Duration | Purpose                             |
| ---------- | ------ | -------- | ----------------------------------- |
| `smoke`    | 5      | 2 min    | Verify scripts work correctly       |
| `baseline` | 10     | 5 min    | Single-user response time baselines |
| `load`     | 50-100 | 16 min   | Normal expected traffic             |
| `stress`   | 50-500 | 16 min   | Find the breaking point             |
| `soak`     | 100    | 2+ hrs   | Memory leaks, connection exhaustion |

```bash
# Smoke test first
k6 run --env PROFILE=smoke --env BASE_URL=http://... --env API_TOKEN=tpi_... mixed-workload.js

# Then baseline
k6 run --env PROFILE=baseline --env BASE_URL=http://... --env API_TOKEN=tpi_... mixed-workload.js

# Then load
k6 run --env PROFILE=load --env BASE_URL=http://... --env API_TOKEN=tpi_... mixed-workload.js

# Then stress (find ceiling)
k6 run --env PROFILE=stress --env BASE_URL=http://... --env API_TOKEN=tpi_... mixed-workload.js
```

## Environment Variables

| Variable                   | Required | Default                 | Description                         |
| -------------------------- | -------- | ----------------------- | ----------------------------------- |
| `BASE_URL`                 | Yes      | `http://localhost:3000` | TestPlanIt instance URL             |
| `API_TOKEN`                | Yes      | —                       | API token (`tpi_...`)               |
| `PROJECT_ID`               | No       | `1`                     | Project ID for single-project tests |
| `PROFILE`                  | No       | `smoke`                 | Load profile name                   |
| `SEED_PROJECTS`            | No       | `10`                    | Seeding: number of projects         |
| `SEED_CASES_PER_PROJECT`   | No       | `500`                   | Seeding: cases per project          |
| `SEED_FOLDERS_PER_PROJECT` | No       | `20`                    | Seeding: folders per project        |
| `SEED_RUNS_PER_PROJECT`    | No       | `10`                    | Seeding: runs per project           |

## Output and Reporting

### Console Output

k6 prints a summary with key metrics after each run:

- `http_req_duration` — response time percentiles (p50, p90, p95, p99)
- `http_req_failed` — error rate
- `http_reqs` — total requests and throughput (req/s)
- Per-scenario metrics tagged by `scenario` name

### JSON Output

Export results for post-processing:

```bash
k6 run --out json=results.json --env PROFILE=load ... mixed-workload.js
```

### Grafana Dashboard (Real-Time)

For live monitoring during tests, stream metrics to InfluxDB + Grafana:

```bash
k6 run --out influxdb=http://localhost:8086/k6 --env PROFILE=load ... mixed-workload.js
```

## File Structure

```
load-tests/
├── config.js                       # Configuration, profiles, thresholds
├── helpers/
│   ├── api.js                      # ZenStack CRUD API wrappers
│   └── data.js                     # Test data generators
├── scenarios/
│   ├── 01-browse-hierarchy.js      # UC1: Organization & Hierarchy
│   ├── 02-versioning-crud.js       # UC2: Versioning & Reusability
│   ├── 03-test-lifecycle.js        # UC3: End-to-End Test Lifecycle
│   ├── 04-search.js                # Search performance
│   ├── 05-reporting.js             # UC5: Analytics & Reporting
│   └── 06-cicd-ingestion.js        # CI/CD JUnit ingestion
├── mixed-workload.js               # Combined realistic traffic
├── seed.js                         # Data seeding script
└── README.md                       # This file
```

## Interpreting Results

### Key Metrics to Watch

| Metric                | Good        | Warning      | Critical   |
| --------------------- | ----------- | ------------ | ---------- |
| p95 latency (browse)  | < 500ms     | 500ms-1s     | > 1s       |
| p95 latency (search)  | < 300ms     | 300ms-1s     | > 1s       |
| p95 latency (CRUD)    | < 1s        | 1s-2s        | > 2s       |
| p95 latency (reports) | < 3s        | 3s-5s        | > 5s       |
| Error rate            | < 0.1%      | 0.1%-1%      | > 1%       |
| Throughput            | > 100 req/s | 50-100 req/s | < 50 req/s |

### Common Bottlenecks

1. **Database connections exhausted** — errors spike suddenly at a specific VU count.
   Fix: Increase `connection_limit` in DATABASE_URL or add PgBouncer.

2. **Response times degrade linearly** — CPU-bound on app server.
   Fix: Scale horizontally (more app replicas).

3. **Search latency increases with data** — Elasticsearch heap pressure.
   Fix: Increase ES heap (`-Xms2g -Xmx2g`), add nodes for sharding.

4. **Report queries timeout** — cross-project aggregation too heavy.
   Fix: Add database indexes, cache report results, limit project count.

5. **CI/CD imports queue up** — worker processing can't keep up.
   Fix: Increase worker concurrency, scale worker processes.
