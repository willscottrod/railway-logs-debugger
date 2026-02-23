#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { registerAnalyzeCommand } from "./commands/analyze.js";
import { registerMetricsCommand } from "./commands/metrics-cmd.js";
import { registerLogsCommand } from "./commands/logs-cmd.js";
import { registerStatusCommand } from "./commands/status.js";

/**
 * Parse a Railway dashboard URL into project, service, and environment IDs.
 *
 * Supports:
 *   https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>
 *   https://railway.com/project/<projectId>/service/<serviceId>/...?environmentId=<envId>
 *   https://railway.com/project/<projectId>?environmentId=<envId>
 */
function parseRailwayUrl(raw: string): {
  projectId: string;
  serviceId?: string;
  environmentId?: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  // pathname like /project/<projectId>/service/<serviceId>/...
  const parts = url.pathname.split("/").filter(Boolean);

  const projectIdx = parts.indexOf("project");
  if (projectIdx === -1 || !parts[projectIdx + 1]) {
    throw new Error(
      `Could not find project ID in URL. Expected format:\n` +
        `  https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>`
    );
  }

  const projectId = parts[projectIdx + 1];

  let serviceId: string | undefined;
  const serviceIdx = parts.indexOf("service");
  if (serviceIdx !== -1 && parts[serviceIdx + 1]) {
    serviceId = parts[serviceIdx + 1];
  }

  const environmentId = url.searchParams.get("environmentId") ?? undefined;

  return { projectId, serviceId, environmentId };
}

const program = new Command();

program
  .name("railway-metrics")
  .description(
    "CLI tool to fetch Railway service metrics and logs, and analyze service health with Claude AI"
  )
  .version("1.0.0")
  .option("--url <url>", "Railway dashboard URL (extracts project, service, and environment IDs)")
  .option("--project-id <id>", "Railway project ID")
  .option("--environment-id <id>", "Railway environment ID")
  .option("--service-id <id>", "Railway service ID")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();

    // If --url is provided, parse it and fill in any missing IDs
    if (opts.url) {
      const parsed = parseRailwayUrl(opts.url);
      if (!opts.projectId) opts.projectId = parsed.projectId;
      if (!opts.serviceId && parsed.serviceId) opts.serviceId = parsed.serviceId;
      if (!opts.environmentId && parsed.environmentId) opts.environmentId = parsed.environmentId;
    }

    if (!opts.projectId) {
      console.error(
        "error: required option '--project-id <id>' or '--url <url>' not specified"
      );
      process.exit(1);
    }
    if (!opts.environmentId) {
      console.error(
        "error: required option '--environment-id <id>' or '--url <url>' with environmentId not specified"
      );
      process.exit(1);
    }
  });

registerAnalyzeCommand(program);
registerMetricsCommand(program);
registerLogsCommand(program);
registerStatusCommand(program);

program.parse();
