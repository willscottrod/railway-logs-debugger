import Anthropic from "@anthropic-ai/sdk";
import type { ServiceHealthReport, TimelineWindow } from "../types/railway.js";
import { formatDuration } from "../utils/time.js";

const MODEL = "claude-sonnet-4-20250514";

function formatTimelineTable(timeline: TimelineWindow[]): string {
  const header = "| Time | CPU (cores) | Memory (MB) | p99 (ms) | Requests | 5xx | Error Logs | Anomaly |";
  const sep =    "|------|-------------|-------------|----------|----------|-----|------------|---------|";
  const rows = timeline.map((w) => {
    const time = new Date(w.start).toISOString().slice(11, 16);
    const anomaly = w.isAnomaly ? "**YES**" : "";
    return `| ${time} | ${w.cpu.toFixed(3)} | ${w.memoryMb.toFixed(0)} | ${w.p99.toFixed(0)} | ${w.requests} | ${w.errors5xx} | ${w.errorLogs} | ${anomaly} |`;
  });
  return [header, sep, ...rows].join("\n");
}

function formatAnomalySummary(timeline: TimelineWindow[]): string {
  const anomalies = timeline.filter((w) => w.isAnomaly);
  if (anomalies.length === 0) return "No anomalous time windows detected.";

  return anomalies.map((w) => {
    const start = new Date(w.start).toISOString().slice(11, 16);
    const end = new Date(w.end).toISOString().slice(11, 16);
    const signals: string[] = [];
    if (w.cpu > 0) signals.push(`CPU ${w.cpu.toFixed(3)} cores`);
    if (w.memoryMb > 0) signals.push(`Memory ${w.memoryMb.toFixed(0)} MB`);
    if (w.p99 > 0) signals.push(`p99 ${w.p99.toFixed(0)} ms`);
    if (w.errors5xx > 0) signals.push(`${w.errors5xx} 5xx errors`);
    if (w.errorLogs > 0) signals.push(`${w.errorLogs} error logs`);
    return `- **${start}–${end}**: ${signals.join(", ")}`;
  }).join("\n");
}

function buildAnalysisPrompt(report: ServiceHealthReport): string {
  const duration = formatDuration(report.period.start, report.period.end);

  const errorLogs = report.logs.filter(
    (l) =>
      l.severity === "error" ||
      l.severity === "ERROR" ||
      l.message.toLowerCase().includes("error") ||
      l.message.toLowerCase().includes("exception") ||
      l.message.toLowerCase().includes("fatal")
  );

  const warningLogs = report.logs.filter(
    (l) =>
      l.severity === "warn" ||
      l.severity === "WARNING" ||
      l.message.toLowerCase().includes("warn")
  );

  // Limit logs for the prompt to avoid exceeding token limits
  const recentErrorLogs = errorLogs.slice(-50);
  const recentWarningLogs = warningLogs.slice(-20);
  const recentLogs = report.logs.slice(-100);

  const failedDeployments = report.deployments.filter(
    (d) => d.status === "FAILED" || d.status === "CRASHED"
  );

  // Build HTTP performance section if available
  let httpSection = "";
  if (report.metrics.http) {
    const http = report.metrics.http;
    const lat = http.latency;
    const hasHighP99 = lat.p99.max > 1000;
    const has5xx = http.statusCodes.find((b) => b.bucket === "5xx");

    httpSection = `
## HTTP Performance (Primary Focus)

### Latency Percentiles (ms)
| Percentile | Avg | Min | Max | Latest | Samples |
|------------|-----|-----|-----|--------|---------|
| p50 | ${lat.p50.avg.toFixed(1)} | ${lat.p50.min.toFixed(1)} | ${lat.p50.max.toFixed(1)} | ${lat.p50.latest.toFixed(1)} | ${lat.p50.dataPoints} |
| p90 | ${lat.p90.avg.toFixed(1)} | ${lat.p90.min.toFixed(1)} | ${lat.p90.max.toFixed(1)} | ${lat.p90.latest.toFixed(1)} | ${lat.p90.dataPoints} |
| p95 | ${lat.p95.avg.toFixed(1)} | ${lat.p95.min.toFixed(1)} | ${lat.p95.max.toFixed(1)} | ${lat.p95.latest.toFixed(1)} | ${lat.p95.dataPoints} |
| p99 | ${lat.p99.avg.toFixed(1)} | ${lat.p99.min.toFixed(1)} | ${lat.p99.max.toFixed(1)} | ${lat.p99.latest.toFixed(1)} | ${lat.p99.dataPoints} |
${hasHighP99 ? "\n**WARNING**: p99 latency exceeds 1000ms (peak: " + lat.p99.max.toFixed(1) + "ms)" : ""}

### HTTP Status Code Distribution
- Total Requests: ${http.totalRequests}
${http.statusCodes.map((b) => `- ${b.bucket}: ${b.count} requests${Object.entries(b.codes).map(([code, count]) => ` (${code}: ${count})`).join("")}`).join("\n")}
${has5xx ? "\n**WARNING**: " + has5xx.count + " server errors (5xx) detected" : ""}
`;
  }

  // Build correlation timeline section if available
  let correlationSection = "";
  if (report.timeline && report.timeline.length > 0) {
    const anomalies = report.timeline.filter((w) => w.isAnomaly);
    correlationSection = `
## Correlation Timeline (Cross-Signal View)

This table shows all metrics aligned by time window. Use it to identify **which resource constraints correlate with latency degradation** and **map error logs to latency/status anomalies**.

${formatTimelineTable(report.timeline)}

## Detected Anomalies (${anomalies.length} windows)

${formatAnomalySummary(report.timeline)}
`;
  }

  return `You are a DevOps and infrastructure health analyst. Analyze the following Railway service health data and provide a comprehensive health assessment.${report.metrics.http ? " **Prioritize HTTP performance analysis** — latency percentiles and error rates are the primary concern." : ""}${report.timeline && report.timeline.length > 0 ? " **Use the Correlation Timeline to identify cross-signal patterns** — determine root cause chains (e.g., memory pressure → GC pauses → latency spike → 5xx)." : ""}

## Service Information
- **Service**: ${report.service.name} (ID: ${report.service.id})
- **Environment**: ${report.service.environment}
- **Analysis Period**: ${duration} (${report.period.start} to ${report.period.end})
${httpSection}${correlationSection}
## Resource Metrics

### CPU Usage
- Average: ${report.metrics.cpu.avg.toFixed(4)} cores
- Min: ${report.metrics.cpu.min.toFixed(4)} cores
- Max: ${report.metrics.cpu.max.toFixed(4)} cores
- Latest: ${report.metrics.cpu.latest.toFixed(4)} cores
- Data Points: ${report.metrics.cpu.dataPoints}

### Memory Usage
- Average: ${(report.metrics.memory.avg * 1024).toFixed(1)} MB
- Min: ${(report.metrics.memory.min * 1024).toFixed(1)} MB
- Max: ${(report.metrics.memory.max * 1024).toFixed(1)} MB
- Latest: ${(report.metrics.memory.latest * 1024).toFixed(1)} MB
- Data Points: ${report.metrics.memory.dataPoints}

### Network Ingress (RX)
- Average: ${(report.metrics.networkRx.avg * 1024).toFixed(2)} MB
- Total Data Points: ${report.metrics.networkRx.dataPoints}
- Latest: ${(report.metrics.networkRx.latest * 1024).toFixed(2)} MB

### Network Egress (TX)
- Average: ${(report.metrics.networkTx.avg * 1024).toFixed(2)} MB
- Total Data Points: ${report.metrics.networkTx.dataPoints}
- Latest: ${(report.metrics.networkTx.latest * 1024).toFixed(2)} MB

## Deployments (last 10)
Total: ${report.deployments.length}
Failed/Crashed: ${failedDeployments.length}
${report.deployments
  .map(
    (d) =>
      `- ${d.id.substring(0, 8)}... | Status: ${d.status} | Created: ${d.createdAt}`
  )
  .join("\n")}

## Logs Summary
- Total log entries: ${report.logs.length}
- Error logs: ${errorLogs.length}
- Warning logs: ${warningLogs.length}

### Recent Error Logs (last ${recentErrorLogs.length})
${
  recentErrorLogs.length > 0
    ? recentErrorLogs
        .map((l) => `[${l.timestamp}] ${l.message}`)
        .join("\n")
    : "No error logs found."
}

### Recent Warning Logs (last ${recentWarningLogs.length})
${
  recentWarningLogs.length > 0
    ? recentWarningLogs
        .map((l) => `[${l.timestamp}] ${l.message}`)
        .join("\n")
    : "No warning logs found."
}

### Recent Logs (last ${recentLogs.length})
${recentLogs.map((l) => `[${l.timestamp}] [${l.severity}] ${l.message}`).join("\n")}

---

Please provide your analysis in the following structure:

1. **Overall Health Score** (0-100) with a brief justification${report.metrics.http ? `
2. **HTTP Performance Assessment** (Primary Focus)
   - Latency analysis: p50/p90/p95/p99 trends and whether they are acceptable
   - Status code analysis: error rates (4xx/5xx), success rates
   - Identify any latency spikes or elevated error rates
3. **Resource Utilization Assessment**` : `
2. **Resource Utilization Assessment**`}
   - CPU analysis and trends
   - Memory analysis and trends
   - Network traffic patterns
${report.timeline && report.timeline.length > 0 ? `${report.metrics.http ? "4" : "3"}. **Cross-Signal Correlation** (Key Section)
   - Identify which resource constraints (CPU, memory) correlate with latency degradation
   - Map error log timestamps to latency/status code anomalies
   - Determine root cause chains (e.g., memory pressure → GC pauses → latency spike → 5xx)
   - Call out any anomaly windows where multiple signals spike together
${report.metrics.http ? "5" : "4"}` : `${report.metrics.http ? "4" : "3"}`}. **Deployment Health**
   - Deployment success rate
   - Any concerning patterns
${report.timeline ? (report.metrics.http ? "6" : "5") : (report.metrics.http ? "5" : "4")}. **Log Analysis**
   - Error patterns and root causes
   - Warning patterns
   - Notable events
${report.timeline ? (report.metrics.http ? "7" : "6") : (report.metrics.http ? "6" : "5")}. **Recommendations**
   - Immediate actions needed (if any)
   - Performance optimization suggestions
   - Monitoring suggestions
${report.timeline ? (report.metrics.http ? "8" : "7") : (report.metrics.http ? "7" : "6")}. **Risk Assessment**
   - Current risks
   - Potential future issues based on trends

Be specific, actionable, and reference actual data points from the metrics and logs.${report.timeline && report.timeline.length > 0 ? " Use the Correlation Timeline to support your analysis — reference specific time windows when discussing patterns." : ""}`;
}

/**
 * Analyze a service health report using Claude.
 */
export async function analyzeWithClaude(
  report: ServiceHealthReport,
  apiKey?: string
): Promise<string> {
  const client = new Anthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
  });

  const prompt = buildAnalysisPrompt(report);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const textContent = message.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return textContent.text;
}

/**
 * Build a raw report summary without Claude (for --raw mode).
 */
export function buildRawReport(report: ServiceHealthReport): string {
  const lines: string[] = [];

  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`SERVICE HEALTH REPORT`);
  lines.push(`${"=".repeat(60)}`);
  lines.push(`Service: ${report.service.name} (${report.service.id})`);
  lines.push(`Environment: ${report.service.environment}`);
  lines.push(`Period: ${report.period.start} to ${report.period.end}`);
  lines.push(`Duration: ${formatDuration(report.period.start, report.period.end)}`);

  lines.push(`\n--- CPU Usage ---`);
  lines.push(`  Avg: ${report.metrics.cpu.avg.toFixed(4)} cores`);
  lines.push(`  Min: ${report.metrics.cpu.min.toFixed(4)} cores`);
  lines.push(`  Max: ${report.metrics.cpu.max.toFixed(4)} cores`);
  lines.push(`  Latest: ${report.metrics.cpu.latest.toFixed(4)} cores`);
  lines.push(`  Data Points: ${report.metrics.cpu.dataPoints}`);

  lines.push(`\n--- Memory Usage ---`);
  lines.push(`  Avg: ${(report.metrics.memory.avg * 1024).toFixed(1)} MB`);
  lines.push(`  Min: ${(report.metrics.memory.min * 1024).toFixed(1)} MB`);
  lines.push(`  Max: ${(report.metrics.memory.max * 1024).toFixed(1)} MB`);
  lines.push(`  Latest: ${(report.metrics.memory.latest * 1024).toFixed(1)} MB`);
  lines.push(`  Data Points: ${report.metrics.memory.dataPoints}`);

  lines.push(`\n--- Network Ingress (RX) ---`);
  lines.push(`  Avg: ${(report.metrics.networkRx.avg * 1024).toFixed(2)} MB`);
  lines.push(`  Latest: ${(report.metrics.networkRx.latest * 1024).toFixed(2)} MB`);
  lines.push(`  Data Points: ${report.metrics.networkRx.dataPoints}`);

  lines.push(`\n--- Network Egress (TX) ---`);
  lines.push(`  Avg: ${(report.metrics.networkTx.avg * 1024).toFixed(2)} MB`);
  lines.push(`  Latest: ${(report.metrics.networkTx.latest * 1024).toFixed(2)} MB`);
  lines.push(`  Data Points: ${report.metrics.networkTx.dataPoints}`);

  if (report.metrics.http) {
    const http = report.metrics.http;
    const lat = http.latency;

    lines.push(`\n--- HTTP Latency (ms) ---`);
    lines.push(`  p50:  Avg: ${lat.p50.avg.toFixed(1)}  Min: ${lat.p50.min.toFixed(1)}  Max: ${lat.p50.max.toFixed(1)}  Latest: ${lat.p50.latest.toFixed(1)}  (${lat.p50.dataPoints} samples)`);
    lines.push(`  p90:  Avg: ${lat.p90.avg.toFixed(1)}  Min: ${lat.p90.min.toFixed(1)}  Max: ${lat.p90.max.toFixed(1)}  Latest: ${lat.p90.latest.toFixed(1)}  (${lat.p90.dataPoints} samples)`);
    lines.push(`  p95:  Avg: ${lat.p95.avg.toFixed(1)}  Min: ${lat.p95.min.toFixed(1)}  Max: ${lat.p95.max.toFixed(1)}  Latest: ${lat.p95.latest.toFixed(1)}  (${lat.p95.dataPoints} samples)`);
    lines.push(`  p99:  Avg: ${lat.p99.avg.toFixed(1)}  Min: ${lat.p99.min.toFixed(1)}  Max: ${lat.p99.max.toFixed(1)}  Latest: ${lat.p99.latest.toFixed(1)}  (${lat.p99.dataPoints} samples)`);

    lines.push(`\n--- HTTP Status Codes ---`);
    lines.push(`  Total Requests: ${http.totalRequests}`);
    for (const bucket of http.statusCodes) {
      const codeDetails = Object.entries(bucket.codes)
        .map(([code, count]) => `${code}: ${count}`)
        .join(", ");
      lines.push(`  ${bucket.bucket}: ${bucket.count}  (${codeDetails})`);
    }
  }

  if (report.timeline && report.timeline.length > 0) {
    lines.push(`\n--- Correlation Timeline ---`);
    lines.push(`  ${"Time".padEnd(6)} ${"CPU".padStart(8)} ${"Mem MB".padStart(8)} ${"p99 ms".padStart(8)} ${"Reqs".padStart(6)} ${"5xx".padStart(5)} ${"ErrLog".padStart(7)} ${"Anomaly".padStart(8)}`);
    for (const w of report.timeline) {
      const time = new Date(w.start).toISOString().slice(11, 16);
      lines.push(`  ${time.padEnd(6)} ${w.cpu.toFixed(3).padStart(8)} ${w.memoryMb.toFixed(0).padStart(8)} ${w.p99.toFixed(0).padStart(8)} ${String(w.requests).padStart(6)} ${String(w.errors5xx).padStart(5)} ${String(w.errorLogs).padStart(7)} ${(w.isAnomaly ? "YES" : "").padStart(8)}`);
    }

    const anomalies = report.timeline.filter((w) => w.isAnomaly);
    lines.push(`\n--- Detected Anomalies (${anomalies.length} windows) ---`);
    if (anomalies.length === 0) {
      lines.push(`  No anomalous time windows detected.`);
    } else {
      for (const w of anomalies) {
        const start = new Date(w.start).toISOString().slice(11, 16);
        const end = new Date(w.end).toISOString().slice(11, 16);
        const signals: string[] = [];
        if (w.cpu > 0) signals.push(`CPU ${w.cpu.toFixed(3)}`);
        if (w.memoryMb > 0) signals.push(`Mem ${w.memoryMb.toFixed(0)}MB`);
        if (w.p99 > 0) signals.push(`p99 ${w.p99.toFixed(0)}ms`);
        if (w.errors5xx > 0) signals.push(`${w.errors5xx} 5xx`);
        if (w.errorLogs > 0) signals.push(`${w.errorLogs} errors`);
        lines.push(`  ${start}-${end}: ${signals.join(", ")}`);
      }
    }
  }

  lines.push(`\n--- Deployments ---`);
  lines.push(`  Total: ${report.deployments.length}`);
  for (const d of report.deployments) {
    lines.push(`  - ${d.id.substring(0, 12)} | ${d.status} | ${d.createdAt}`);
  }

  const errorCount = report.logs.filter(
    (l) =>
      l.severity === "error" ||
      l.severity === "ERROR" ||
      l.message.toLowerCase().includes("error")
  ).length;

  lines.push(`\n--- Logs ---`);
  lines.push(`  Total entries: ${report.logs.length}`);
  lines.push(`  Errors: ${errorCount}`);

  if (errorCount > 0) {
    lines.push(`\n  Recent errors:`);
    const errors = report.logs
      .filter(
        (l) =>
          l.severity === "error" ||
          l.severity === "ERROR" ||
          l.message.toLowerCase().includes("error")
      )
      .slice(-10);
    for (const e of errors) {
      lines.push(`    [${e.timestamp}] ${e.message}`);
    }
  }

  lines.push(`\n${"=".repeat(60)}`);

  return lines.join("\n");
}
