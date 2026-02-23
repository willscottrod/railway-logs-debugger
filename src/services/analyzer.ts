import Anthropic from "@anthropic-ai/sdk";
import type { ServiceHealthReport } from "../types/railway.js";
import { formatDuration } from "../utils/time.js";

const MODEL = "claude-sonnet-4-20250514";

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

  return `You are a DevOps and infrastructure health analyst. Analyze the following Railway service health data and provide a comprehensive health assessment.

## Service Information
- **Service**: ${report.service.name} (ID: ${report.service.id})
- **Environment**: ${report.service.environment}
- **Analysis Period**: ${duration} (${report.period.start} to ${report.period.end})

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

1. **Overall Health Score** (0-100) with a brief justification
2. **Resource Utilization Assessment**
   - CPU analysis and trends
   - Memory analysis and trends
   - Network traffic patterns
3. **Deployment Health**
   - Deployment success rate
   - Any concerning patterns
4. **Log Analysis**
   - Error patterns and root causes
   - Warning patterns
   - Notable events
5. **Recommendations**
   - Immediate actions needed (if any)
   - Performance optimization suggestions
   - Monitoring suggestions
6. **Risk Assessment**
   - Current risks
   - Potential future issues based on trends

Be specific, actionable, and reference actual data points from the metrics and logs.`;
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
