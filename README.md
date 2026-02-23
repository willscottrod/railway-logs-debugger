# railway-metrics-cli

CLI tool that connects to the [Railway GraphQL API](https://docs.railway.com/integrations/api) to fetch service metrics (CPU, memory, network), deployment history, and logs, then consolidates all data and passes it to Claude AI for service health analysis.

## Prerequisites

- **Node.js** >= 18
- **Railway CLI** installed and authenticated
- **Anthropic API key** (for Claude analysis)

### Install Railway CLI

```bash
npm install -g @railway/cli
```

### Authenticate

```bash
railway login
```

### Link a project

```bash
railway link
railway service  # select the service to monitor
```

### Set Anthropic API key

```bash
export ANTHROPIC_API_KEY=your-api-key
```

## Installation

```bash
cd railway-metrics-cli
npm install
npm run build
```

Or run directly in development:

```bash
npm run dev -- analyze --period 1h
```

## Commands

### `analyze` - Full health analysis with Claude

Collects metrics, logs, and deployment data then sends it to Claude for comprehensive health analysis.

```bash
# Analyze last hour (default)
railway-metrics analyze

# Analyze last 24 hours
railway-metrics analyze --period 24h

# Analyze last 7 days
railway-metrics analyze --period 7d

# Specify a service
railway-metrics analyze --service my-api --period 6h

# Filter logs for errors only
railway-metrics analyze --filter "@level:error" --period 12h

# Raw report without Claude analysis
railway-metrics analyze --raw --period 1h

# Export as JSON
railway-metrics analyze --json --period 24h

# Write report to file
railway-metrics analyze --period 7d --output report.md
```

### `metrics` - View resource metrics

Fetch and display CPU, memory, network, and disk metrics.

```bash
railway-metrics metrics --period 1h
railway-metrics metrics --period 24h --json
railway-metrics metrics --service my-api --period 6h
```

### `logs` - View service logs

Fetch and display deploy or build logs.

```bash
# Deploy logs (last hour)
railway-metrics logs --period 1h

# Build logs
railway-metrics logs --period 1h --build

# Filter for errors
railway-metrics logs --filter "@level:error" --lines 200

# Last 7 days of logs
railway-metrics logs --period 7d --lines 1000
```

### `status` - Project status

Show the current project, services, environments, and recent deployments.

```bash
railway-metrics status
railway-metrics status --json
```

## Metrics Collected

| Metric | Description |
|--------|-------------|
| CPU_USAGE | CPU usage in cores |
| CPU_LIMIT | CPU limit in cores |
| MEMORY_USAGE_GB | Memory usage |
| MEMORY_LIMIT_GB | Memory limit |
| NETWORK_RX_GB | Network received (ingress) |
| NETWORK_TX_GB | Network transmitted (egress) |
| DISK_USAGE_GB | Disk usage |

## Claude Analysis Output

When using the `analyze` command with an Anthropic API key, Claude provides:

1. **Overall Health Score** (0-100) with justification
2. **Resource Utilization Assessment** - CPU, memory, and network analysis with trends
3. **Deployment Health** - Success rate and concerning patterns
4. **Log Analysis** - Error patterns, root causes, and notable events
5. **Recommendations** - Immediate actions, optimizations, and monitoring suggestions
6. **Risk Assessment** - Current risks and potential future issues

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude analysis |
| `RAILWAY_TOKEN` | Railway API token (alternative to CLI login) |

## Architecture

```
src/
  index.ts                 # CLI entry point
  commands/
    analyze.ts             # Full health analysis command
    metrics-cmd.ts         # Quick metrics view command
    logs-cmd.ts            # Logs view command
    status.ts              # Project status command
  services/
    auth.ts                # Railway authentication
    railway-client.ts      # GraphQL client for Railway API
    metrics.ts             # Metrics collection & processing
    logs.ts                # Log fetching via Railway CLI
    analyzer.ts            # Claude AI health analysis
  types/
    railway.ts             # TypeScript type definitions
  utils/
    time.ts                # Time period parsing utilities
```

## How It Works

1. **Authentication**: Reads the Railway CLI config (`~/.railway/config.json`) for the API token, or uses the `RAILWAY_TOKEN` environment variable
2. **Context**: Uses `railway status --json` to get the linked project, environment, and service IDs
3. **Metrics**: Queries the Railway GraphQL API (`https://backboard.railway.com/graphql/v2`) for CPU, memory, network, and disk metrics
4. **Logs**: Uses the Railway CLI (`railway logs --json`) to fetch deploy and build logs with time-based filtering
5. **Deployments**: Queries the GraphQL API for recent deployment history and status
6. **Analysis**: Consolidates all data into a structured report and sends it to Claude for health analysis

## References

- [Railway Public API](https://docs.railway.com/integrations/api)
- [Railway GraphQL Overview](https://docs.railway.com/integrations/api/graphql-overview)
- [Railway Metrics](https://docs.railway.com/observability/metrics)
- [Railway Logs](https://docs.railway.com/observability/logs)
- [Railway CLI Logs](https://docs.railway.com/cli/logs)
- [Railway API Cookbook](https://docs.railway.com/integrations/api/api-cookbook)
