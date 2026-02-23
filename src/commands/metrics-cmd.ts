import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { verifyAuth } from "../services/auth.js";
import { fetchAllMetrics, fetchHttpMetrics } from "../services/railway-client.js";
import { parsePeriod, calculateSampleRate } from "../utils/time.js";
import type { MetricResult, HttpMetricsResponse } from "../types/railway.js";

interface MetricsOptions {
  period: string;
  json?: boolean;
}

export function registerMetricsCommand(program: Command): void {
  program
    .command("metrics")
    .description("Fetch and display resource metrics for a Railway service")
    .option("-p, --period <period>", "Time period (e.g., 1h, 6h, 24h, 7d)", "1h")
    .option("--json", "Output as JSON")
    .action(async (options: MetricsOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals();
      const environmentId: string = globals.environmentId;
      const serviceId: string | undefined = globals.serviceId;
      const spinner = ora();

      try {
        spinner.start("Verifying authentication...");
        const authSource = await verifyAuth();
        spinner.succeed(`Authenticated via ${chalk.cyan(authSource)}`);

        if (!serviceId) {
          spinner.fail("No service specified");
          console.log(chalk.yellow("\nProvide --service-id <id> to specify the service."));
          process.exit(1);
        }

        const { start, end } = parsePeriod(options.period);
        const sampleRate = calculateSampleRate(start, end);

        spinner.start("Fetching metrics...");
        const [response, httpResponse] = await Promise.all([
          fetchAllMetrics(environmentId, serviceId, start, end, sampleRate),
          fetchHttpMetrics(environmentId, serviceId, start, end, sampleRate).catch(() => null),
        ]);
        spinner.succeed("Metrics fetched");

        if (options.json) {
          console.log(JSON.stringify({ ...response, http: httpResponse }, null, 2));
          return;
        }

        displayMetrics(response.metrics, options.period);
        if (httpResponse) {
          displayHttpMetrics(httpResponse, options.period);
        }
      } catch (err) {
        spinner.fail("Error");
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}

function displayMetrics(metrics: MetricResult[], period: string): void {
  console.log(chalk.bold(`\nResource Metrics (last ${period})\n`));

  const metricLabels: Record<string, { label: string; unit: string; multiplier: number }> = {
    CPU_USAGE: { label: "CPU Usage", unit: "cores", multiplier: 1 },
    CPU_LIMIT: { label: "CPU Limit", unit: "cores", multiplier: 1 },
    MEMORY_USAGE_GB: { label: "Memory Usage", unit: "MB", multiplier: 1024 },
    MEMORY_LIMIT_GB: { label: "Memory Limit", unit: "MB", multiplier: 1024 },
    NETWORK_RX_GB: { label: "Network RX", unit: "MB", multiplier: 1024 },
    NETWORK_TX_GB: { label: "Network TX", unit: "MB", multiplier: 1024 },
    DISK_USAGE_GB: { label: "Disk Usage", unit: "MB", multiplier: 1024 },
  };

  for (const metric of metrics) {
    const config = metricLabels[metric.measurement] || {
      label: metric.measurement,
      unit: "",
      multiplier: 1,
    };

    if (metric.values.length === 0) continue;

    const values = metric.values.map((v) => v.value * config.multiplier);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const latest = values[values.length - 1];

    console.log(chalk.cyan(`  ${config.label}:`));
    console.log(`    Latest: ${latest.toFixed(2)} ${config.unit}`);
    console.log(`    Avg:    ${avg.toFixed(2)} ${config.unit}`);
    console.log(`    Min:    ${min.toFixed(2)} ${config.unit}`);
    console.log(`    Max:    ${max.toFixed(2)} ${config.unit}`);
    console.log(`    Points: ${metric.values.length}`);
    console.log();
  }
}

function displayHttpMetrics(httpResponse: HttpMetricsResponse, period: string): void {
  const samples = httpResponse.httpDurationMetrics.samples;

  if (samples.length > 0) {
    console.log(chalk.bold(`\nHTTP Latency (last ${period})\n`));

    const percentiles = ["p50", "p90", "p95", "p99"] as const;
    for (const key of percentiles) {
      const values = samples.map((s) => s[key]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const latest = values[values.length - 1];

      console.log(chalk.cyan(`  ${key}:`));
      console.log(`    Latest: ${latest.toFixed(1)} ms`);
      console.log(`    Avg:    ${avg.toFixed(1)} ms`);
      console.log(`    Min:    ${min.toFixed(1)} ms`);
      console.log(`    Max:    ${max.toFixed(1)} ms`);
      console.log(`    Points: ${values.length}`);
      console.log();
    }
  }

  const statusGroups = httpResponse.httpMetricsGroupedByStatus;
  if (statusGroups.length > 0) {
    console.log(chalk.bold(`HTTP Status Codes (last ${period})\n`));

    const buckets = new Map<string, { count: number; codes: Map<number, number> }>();
    for (const group of statusGroups) {
      const bucket = `${Math.floor(group.statusCode / 100)}xx`;
      const total = group.samples.reduce((sum, s) => sum + s.value, 0);

      if (!buckets.has(bucket)) {
        buckets.set(bucket, { count: 0, codes: new Map() });
      }
      const entry = buckets.get(bucket)!;
      entry.count += total;
      entry.codes.set(group.statusCode, (entry.codes.get(group.statusCode) || 0) + total);
    }

    for (const [bucket, data] of Array.from(buckets.entries()).sort()) {
      const color = bucket === "5xx" ? chalk.red : bucket === "4xx" ? chalk.yellow : chalk.green;
      const codeDetails = Array.from(data.codes.entries())
        .map(([code, count]) => `${code}: ${count}`)
        .join(", ");
      console.log(color(`  ${bucket}: ${data.count} requests  (${codeDetails})`));
    }
    console.log();
  }
}
