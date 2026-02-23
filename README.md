# railway-metrics-cli

CLI tool that connects to the [Railway GraphQL API](https://docs.railway.com/integrations/api) to fetch service metrics (CPU, memory, network), HTTP performance data (latency percentiles, status codes), deployment history, and logs — then correlates all signals across time and passes the consolidated report to Claude AI for root-cause analysis.

The key feature is **cross-signal correlation**: instead of showing metrics in isolation, the tool aligns CPU, memory, HTTP latency, error rates, and log entries into a unified timeline so you can see _why_ latency spikes happen (e.g., memory pressure at 02:23 correlating with p99 latency degradation and 5xx errors).

## Prerequisites

- **Node.js** >= 18
- **Railway API token** — create one at https://railway.com/account/tokens
- **Anthropic API key** — for Claude-powered analysis (optional; `--raw` mode works without it)

## Local Development Setup

```bash
# Clone and install
git clone <repo-url>
cd railway-metrics-cli
npm install

# Create .env file with your tokens
cp .env.example .env  # or create manually:
```

`.env`:
```
RAILWAY_TOKEN=your-railway-api-token
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Run in development using `npm run dev` with a Railway dashboard URL:

```bash
# Full Claude analysis (last 24 hours)
npm run dev -- --url "https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>" analyze --period 24h

# Raw report without Claude (no Anthropic key needed)
npm run dev -- --url "https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>" analyze --raw --period 24h

# JSON output
npm run dev -- --url "https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>" analyze --json --period 6h

# View metrics only
npm run dev -- --url "https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>" metrics --period 1h

# Project status
npm run dev -- --url "https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>" status
```

You can also pass IDs directly instead of a URL:

```bash
npm run dev -- --project-id <id> --environment-id <id> --service-id <id> analyze --period 24h
```

### Build and run as a standalone CLI

```bash
npm run build
node dist/index.js --url "..." analyze --period 24h
```

## Commands

### `analyze` — Full health analysis

Collects all metrics, logs, and deployment data, builds a cross-signal correlation timeline, then sends it to Claude for comprehensive health analysis.

```bash
# Analyze last hour (default)
npm run dev -- --url "..." analyze

# Analyze last 24 hours
npm run dev -- --url "..." analyze --period 24h

# Raw report without Claude
npm run dev -- --url "..." analyze --raw --period 24h

# Export as JSON
npm run dev -- --url "..." analyze --json --period 24h

# Write report to file
npm run dev -- --url "..." analyze --period 7d --output report.md

# Limit log lines fetched
npm run dev -- --url "..." analyze --lines 1000 --period 24h
```

### `metrics` — View resource metrics

Fetch and display CPU, memory, network, and disk metrics.

```bash
npm run dev -- --url "..." metrics --period 1h
npm run dev -- --url "..." metrics --period 24h --json
```

### `logs` — View service logs

Fetch and display deploy or build logs (requires Railway CLI installed and linked).

```bash
npm run dev -- --url "..." logs --period 1h
npm run dev -- --url "..." logs --period 1h --build
```

### `status` — Project status

Show the current project, services, environments, and recent deployments.

```bash
npm run dev -- --url "..." status
npm run dev -- --url "..." status --json
```

## What Gets Collected

### Infrastructure Metrics (via GraphQL API)

| Metric | Description |
|--------|-------------|
| CPU_USAGE | CPU usage in cores |
| CPU_LIMIT | CPU limit in cores |
| MEMORY_USAGE_GB | Memory usage |
| MEMORY_LIMIT_GB | Memory limit |
| NETWORK_RX_GB | Network received (ingress) |
| NETWORK_TX_GB | Network transmitted (egress) |
| DISK_USAGE_GB | Disk usage |

### HTTP Performance (via Railway Internal API)

| Metric | Description |
|--------|-------------|
| Latency p50/p90/p95/p99 | Response time percentiles (ms) |
| Status codes | Request counts grouped by 2xx/3xx/4xx/5xx |
| Total requests | Aggregate request volume |
| Latency time-series | Per-sample latency data for timeline correlation |
| Status code time-series | Per-sample status counts for timeline correlation |

### Logs (via GraphQL API)

Deployment and build logs are fetched per-deployment using the GraphQL `deploymentLogs` and `buildLogs` queries, filtered to the analysis period.

### Correlation Timeline

The tool divides the analysis period into 10–20 time windows and, for each window, aggregates:

| Column | Source |
|--------|--------|
| CPU | Average CPU cores in window |
| Memory (MB) | Peak memory in window |
| p99 (ms) | Peak p99 latency in window |
| Requests | Total HTTP requests in window |
| 5xx | Server error count in window |
| Error Logs | Error/exception/fatal log count in window |
| Anomaly | Flagged if any metric exceeds mean + 2 standard deviations |

## Claude Analysis Output

When using the `analyze` command with an Anthropic API key, Claude provides:

1. **Overall Health Score** (0-100) with justification
2. **HTTP Performance Assessment** — latency trends, error rates, spike identification
3. **Resource Utilization Assessment** — CPU, memory, and network analysis
4. **Cross-Signal Correlation** — root cause chains linking resource constraints to latency degradation and error logs (e.g., memory pressure → GC pauses → latency spike → 5xx)
5. **Deployment Health** — success rate and concerning patterns
6. **Log Analysis** — error patterns, root causes, and notable events
7. **Recommendations** — immediate actions, optimizations, and monitoring suggestions
8. **Risk Assessment** — current risks and potential future issues

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `RAILWAY_TOKEN` | Yes | Railway API token (user or team token) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for Claude analysis (not needed for `--raw` or `--json`) |

## Architecture

```
src/
  index.ts                 # CLI entry point, URL parsing
  commands/
    analyze.ts             # Full health analysis command
    metrics-cmd.ts         # Quick metrics view command
    logs-cmd.ts            # Logs view command
    status.ts              # Project status command
  services/
    auth.ts                # Railway authentication (token + CLI config)
    railway-client.ts      # GraphQL client for Railway API (metrics, deployments, logs)
    metrics.ts             # Metrics collection, HTTP summarization, correlation timeline
    logs.ts                # Log fetching via Railway CLI (fallback)
    analyzer.ts            # Claude AI prompt building and health analysis
  types/
    railway.ts             # TypeScript type definitions
  utils/
    time.ts                # Time period parsing utilities
```

## How It Works

1. **Authentication**: Uses the `RAILWAY_TOKEN` environment variable (loaded from `.env` via dotenv). Falls back to Railway CLI config (`~/.railway/config.json`) if available.
2. **Name Resolution**: Queries the Railway GraphQL API to resolve human-readable service and environment names from IDs.
3. **Parallel Data Fetch**: Fetches infrastructure metrics, HTTP performance metrics, and deployment history concurrently via the GraphQL API.
4. **Log Collection**: Fetches deployment and build logs via the GraphQL API (`deploymentLogs`/`buildLogs` queries) for each deployment in the analysis period.
5. **Correlation Timeline**: Divides the period into time windows and aggregates CPU, memory, p99 latency, 5xx count, and error log count per window. Flags anomaly windows using statistical outlier detection (mean + 2σ).
6. **Analysis**: Consolidates everything into a structured report. In `--raw` mode, prints directly. Otherwise, sends to Claude with a correlation-focused prompt that asks for root-cause chain identification.

## References

- [Railway Public API](https://docs.railway.com/integrations/api)
- [Railway GraphQL Overview](https://docs.railway.com/integrations/api/graphql-overview)
- [Railway Metrics](https://docs.railway.com/observability/metrics)
- [Railway Logs](https://docs.railway.com/observability/logs)
- [Railway API Cookbook](https://docs.railway.com/integrations/api/api-cookbook)
