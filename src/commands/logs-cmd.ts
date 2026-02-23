import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { verifyAuth, isCliInstalled } from "../services/auth.js";
import { fetchLogs } from "../services/logs.js";
import { parsePeriod } from "../utils/time.js";

interface LogsOptions {
  period: string;
  lines?: string;
  filter?: string;
  build?: boolean;
  json?: boolean;
}

export function registerLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("Fetch and display logs for a Railway service (requires Railway CLI)")
    .option("-p, --period <period>", "Time period (e.g., 1h, 6h, 24h, 7d)", "1h")
    .option("-n, --lines <count>", "Number of log lines", "100")
    .option("-f, --filter <query>", "Log filter query (Railway filter syntax)")
    .option("-b, --build", "Show build logs instead of deploy logs")
    .option("--json", "Output as JSON")
    .action(async (options: LogsOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals();
      const serviceId: string | undefined = globals.serviceId;
      const spinner = ora();

      try {
        if (!isCliInstalled()) {
          console.error(
            chalk.red(
              "The logs command requires the Railway CLI.\n" +
                "Install: npm install -g @railway/cli\n\n" +
                "Other commands (analyze, metrics, status) work without the CLI."
            )
          );
          process.exit(1);
        }

        spinner.start("Verifying authentication...");
        await verifyAuth();
        spinner.succeed("Authenticated");

        const { start, end } = parsePeriod(options.period);

        spinner.start("Fetching logs...");
        const logs = fetchLogs({
          serviceId,
          since: start,
          until: end,
          lines: options.lines ? parseInt(options.lines, 10) : 100,
          filter: options.filter,
          build: options.build,
        });
        spinner.succeed(`Fetched ${logs.length} log entries`);

        if (options.json) {
          console.log(JSON.stringify(logs, null, 2));
          return;
        }

        if (logs.length === 0) {
          console.log(chalk.yellow("\nNo logs found for the specified period."));
          return;
        }

        console.log(chalk.bold(`\nLogs (last ${options.period})\n`));
        for (const entry of logs) {
          const ts = chalk.dim(entry.timestamp);
          const severity = formatSeverity(entry.severity || "info");
          console.log(`${ts} ${severity} ${entry.message}`);
        }

        const errors = logs.filter(
          (l) => l.severity === "error" || l.severity === "ERROR"
        ).length;
        const warnings = logs.filter(
          (l) => l.severity === "warn" || l.severity === "WARNING"
        ).length;

        console.log(chalk.dim(`\n--- ${logs.length} entries | ${errors} errors | ${warnings} warnings ---`));
      } catch (err) {
        spinner.fail("Error");
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}

function formatSeverity(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "error") return chalk.red("[ERROR]");
  if (s === "warn" || s === "warning") return chalk.yellow("[WARN] ");
  if (s === "debug") return chalk.gray("[DEBUG]");
  return chalk.blue("[INFO] ");
}
