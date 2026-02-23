import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { verifyAuth } from "../services/auth.js";
import { collectServiceHealth } from "../services/metrics.js";
import { analyzeWithClaude, buildRawReport } from "../services/analyzer.js";
import { parsePeriod } from "../utils/time.js";
import { fetchProject } from "../services/railway-client.js";

interface AnalyzeOptions {
  period: string;
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
    .option("-n, --lines <count>", "Number of log lines to fetch", "500")
    .option("-f, --filter <query>", "Log filter query (Railway filter syntax)")
    .option("--raw", "Show raw metrics without Claude analysis")
    .option("--json", "Output the raw health report as JSON")
    .option("-o, --output <file>", "Write the report to a file")
    .action(async (options: AnalyzeOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals();
      const projectId: string = globals.projectId;
      const environmentId: string = globals.environmentId;
      const serviceId: string | undefined = globals.serviceId;

      await runAnalysis(options, projectId, environmentId, serviceId);
    });
}

async function runAnalysis(
  options: AnalyzeOptions,
  projectId: string,
  environmentId: string,
  serviceId?: string
): Promise<void> {
  const spinner = ora();

  try {
    spinner.start("Verifying authentication...");
    const authSource = await verifyAuth();
    spinner.succeed(`Authenticated via ${chalk.cyan(authSource)}`);

    if (!serviceId) {
      spinner.fail("No service specified");
      console.log(
        chalk.yellow("\nProvide --service-id <id> to specify the service.")
      );
      process.exit(1);
    }

    // Resolve human-readable names from project metadata
    spinner.start("Resolving project details...");
    let serviceName = serviceId;
    let environmentName = environmentId;
    try {
      const { project } = await fetchProject(projectId);
      const svc = project.services.edges.find((e) => e.node.id === serviceId);
      if (svc) serviceName = svc.node.name;
      const env = project.environments.edges.find((e) => e.node.id === environmentId);
      if (env) environmentName = env.node.name;
    } catch {
      // Fall back to IDs if project query fails
    }

    spinner.succeed(
      `Project: ${chalk.cyan(projectId)} | Environment: ${chalk.cyan(environmentName)} | Service: ${chalk.cyan(serviceName)}`
    );

    const { start, end } = parsePeriod(options.period);
    console.log(
      chalk.dim(`\nAnalysis period: ${start} to ${end} (${options.period})`)
    );

    spinner.start("Fetching metrics (CPU, memory, network, HTTP)...");
    const report = await collectServiceHealth({
      projectId,
      environmentId,
      environmentName,
      serviceId,
      serviceName,
      startDate: start,
      endDate: end,
      logLines: options.lines ? parseInt(options.lines, 10) : 500,
      logFilter: options.filter,
    });
    const httpInfo = report.metrics.http
      ? `, ${report.metrics.http.totalRequests} HTTP requests`
      : "";
    spinner.succeed(
      `Collected ${report.metrics.cpu.dataPoints} metric data points, ${report.deployments.length} deployments, ${report.logs.length} log entries${httpInfo}`
    );

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
