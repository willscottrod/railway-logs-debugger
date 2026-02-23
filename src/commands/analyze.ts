import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { getLinkedStatus, verifyAuth, isCliInstalled } from "../services/auth.js";
import { collectServiceHealth } from "../services/metrics.js";
import { analyzeWithClaude, buildRawReport } from "../services/analyzer.js";
import { parsePeriod } from "../utils/time.js";

interface AnalyzeOptions {
  period: string;
  service?: string;
  environment?: string;
  lines?: string;
  filter?: string;
  raw?: boolean;
  json?: boolean;
  output?: string;
}

export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze")
    .description(
      "Analyze service health by collecting metrics, logs, and deployment data, then passing it to Claude for analysis"
    )
    .option(
      "-p, --period <period>",
      "Time period to analyze (e.g., 1h, 6h, 24h, 7d, 2w)",
      "1h"
    )
    .option("-s, --service <name>", "Service name or ID (uses linked service if omitted)")
    .option("-e, --environment <name>", "Environment name or ID (uses linked environment if omitted)")
    .option("-n, --lines <count>", "Number of log lines to fetch", "500")
    .option("-f, --filter <query>", "Log filter query (Railway filter syntax)")
    .option("--raw", "Show raw metrics without Claude analysis")
    .option("--json", "Output the raw health report as JSON")
    .option("-o, --output <file>", "Write the report to a file")
    .action(async (options: AnalyzeOptions) => {
      await runAnalysis(options);
    });
}

async function runAnalysis(options: AnalyzeOptions): Promise<void> {
  const spinner = ora();

  try {
    // Step 1: Verify prerequisites
    spinner.start("Checking Railway CLI...");

    if (!isCliInstalled()) {
      spinner.fail("Railway CLI not found");
      console.log(
        chalk.yellow(
          "\nInstall the Railway CLI:\n  npm install -g @railway/cli\n\nThen authenticate:\n  railway login"
        )
      );
      process.exit(1);
    }
    spinner.succeed("Railway CLI found");

    spinner.start("Verifying authentication...");
    const user = verifyAuth();
    spinner.succeed(`Authenticated as ${chalk.cyan(user)}`);

    // Step 2: Get linked project context
    spinner.start("Getting project context...");
    const status = getLinkedStatus();

    if (!status.project?.id || !status.environment?.id) {
      spinner.fail("No linked project");
      console.log(
        chalk.yellow(
          "\nLink a Railway project first:\n  railway link\n\nThen select a service:\n  railway service"
        )
      );
      process.exit(1);
    }

    const serviceId = options.service || status.service?.id;
    const serviceName = options.service || status.service?.name;
    const environmentId = options.environment || status.environment?.id;
    const environmentName = options.environment || status.environment?.name || "production";

    if (!serviceId) {
      spinner.fail("No service specified");
      console.log(
        chalk.yellow(
          "\nLink a service or specify one:\n  railway service\n  railway-metrics analyze --service <name>"
        )
      );
      process.exit(1);
    }

    spinner.succeed(
      `Project: ${chalk.cyan(status.project.name)} | Environment: ${chalk.cyan(environmentName)} | Service: ${chalk.cyan(serviceName || serviceId)}`
    );

    // Step 3: Parse time period
    const { start, end } = parsePeriod(options.period);
    console.log(
      chalk.dim(`\nAnalysis period: ${start} to ${end} (${options.period})`)
    );

    // Step 4: Collect health data
    spinner.start("Fetching metrics (CPU, memory, network)...");
    const report = await collectServiceHealth({
      projectId: status.project.id,
      environmentId,
      environmentName,
      serviceId,
      serviceName: serviceName || serviceId,
      startDate: start,
      endDate: end,
      logLines: options.lines ? parseInt(options.lines, 10) : 500,
      logFilter: options.filter,
    });
    spinner.succeed(
      `Collected ${report.metrics.cpu.dataPoints} metric data points, ${report.deployments.length} deployments, ${report.logs.length} log entries`
    );

    // Step 5: Output based on mode
    if (options.json) {
      const jsonOutput = JSON.stringify(report, null, 2);
      if (options.output) {
        const { writeFileSync } = await import("fs");
        writeFileSync(options.output, jsonOutput);
        console.log(chalk.green(`\nJSON report written to ${options.output}`));
      } else {
        console.log(jsonOutput);
      }
      return;
    }

    if (options.raw) {
      const rawReport = buildRawReport(report);
      if (options.output) {
        const { writeFileSync } = await import("fs");
        writeFileSync(options.output, rawReport);
        console.log(chalk.green(`\nRaw report written to ${options.output}`));
      } else {
        console.log(rawReport);
      }
      return;
    }

    // Step 6: Analyze with Claude
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(
        chalk.yellow(
          "\nANTHROPIC_API_KEY not set. Showing raw report instead.\n" +
            "Set it with: export ANTHROPIC_API_KEY=your-key\n"
        )
      );
      console.log(buildRawReport(report));
      return;
    }

    spinner.start("Analyzing service health with Claude...");
    const analysis = await analyzeWithClaude(report);
    spinner.succeed("Analysis complete");

    if (options.output) {
      const { writeFileSync } = await import("fs");
      writeFileSync(options.output, analysis);
      console.log(chalk.green(`\nAnalysis written to ${options.output}`));
    } else {
      console.log(`\n${analysis}`);
    }
  } catch (err) {
    spinner.fail("Error");
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n${message}`));
    process.exit(1);
  }
}
