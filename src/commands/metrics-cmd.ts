import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { getLinkedStatus, verifyAuth, isCliInstalled } from "../services/auth.js";
import { fetchAllMetrics } from "../services/railway-client.js";
import { parsePeriod, calculateSampleRate } from "../utils/time.js";
import type { MetricResult } from "../types/railway.js";

interface MetricsOptions {
  period: string;
  service?: string;
  environment?: string;
  json?: boolean;
}

export function registerMetricsCommand(program: Command): void {
  program
    .command("metrics")
    .description("Fetch and display resource metrics for a Railway service")
    .option("-p, --period <period>", "Time period (e.g., 1h, 6h, 24h, 7d)", "1h")
    .option("-s, --service <name>", "Service name or ID")
    .option("-e, --environment <name>", "Environment name or ID")
    .option("--json", "Output as JSON")
    .action(async (options: MetricsOptions) => {
      const spinner = ora();

      try {
        if (!isCliInstalled()) {
          console.error(chalk.red("Railway CLI not found. Install: npm install -g @railway/cli"));
          process.exit(1);
        }

        spinner.start("Verifying authentication...");
        verifyAuth();
        spinner.succeed("Authenticated");

        spinner.start("Getting project context...");
        const status = getLinkedStatus();
        const environmentId = options.environment || status.environment?.id;
        const serviceId = options.service || status.service?.id;

        if (!environmentId || !serviceId) {
          spinner.fail("No service/environment linked");
          process.exit(1);
        }
        spinner.succeed("Project context loaded");

        const { start, end } = parsePeriod(options.period);
        const sampleRate = calculateSampleRate(start, end);

        spinner.start("Fetching metrics...");
        const response = await fetchAllMetrics(
          environmentId,
          serviceId,
          start,
          end,
          sampleRate
        );
        spinner.succeed("Metrics fetched");

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        displayMetrics(response.metrics, options.period);
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
