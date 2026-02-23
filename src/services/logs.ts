import { execSync } from "child_process";
import type { LogEntry } from "../types/railway.js";

export interface FetchLogsOptions {
  serviceId?: string;
  serviceName?: string;
  environmentId?: string;
  environmentName?: string;
  since?: string;
  until?: string;
  lines?: number;
  filter?: string;
  build?: boolean;
}

/**
 * Fetch logs using the Railway CLI.
 *
 * The Railway GraphQL API has known limitations with deploymentLogs and buildLogs,
 * so the recommended approach is to use the CLI directly.
 */
export function fetchLogs(options: FetchLogsOptions): LogEntry[] {
  const args: string[] = ["railway", "logs"];

  if (options.lines) {
    args.push("--lines", String(options.lines));
  } else {
    args.push("--lines", "500");
  }

  if (options.serviceName) {
    args.push("--service", options.serviceName);
  } else if (options.serviceId) {
    args.push("--service", options.serviceId);
  }

  if (options.environmentName) {
    args.push("--environment", options.environmentName);
  } else if (options.environmentId) {
    args.push("--environment", options.environmentId);
  }

  if (options.since) {
    args.push("--since", options.since);
  }

  if (options.until) {
    args.push("--until", options.until);
  }

  if (options.filter) {
    args.push("--filter", options.filter);
  }

  if (options.build) {
    args.push("--build");
  }

  args.push("--json");

  try {
    const output = execSync(args.join(" "), {
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 30_000,
    });

    return parseLogOutput(output);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error fetching logs";

    // If the CLI fails, return an empty array with a note
    if (message.includes("No logs found") || message.includes("No deployments")) {
      return [];
    }

    throw new Error(`Failed to fetch logs via Railway CLI: ${message}`);
  }
}

/**
 * Fetch deploy logs and build logs, returning them combined.
 */
export function fetchAllLogs(options: Omit<FetchLogsOptions, "build">): {
  deployLogs: LogEntry[];
  buildLogs: LogEntry[];
} {
  const deployLogs = fetchLogs({ ...options, build: false });
  let buildLogs: LogEntry[] = [];

  try {
    buildLogs = fetchLogs({ ...options, build: true });
  } catch {
    // Build logs may not be available for all deployments
  }

  return { deployLogs, buildLogs };
}

function parseLogOutput(output: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = output.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      entries.push({
        timestamp: parsed.timestamp || parsed.ts || new Date().toISOString(),
        message: parsed.message || parsed.msg || parsed.log || line,
        severity: parsed.severity || parsed.level || "info",
        attributes: parsed,
      });
    } catch {
      // Non-JSON log line
      entries.push({
        timestamp: new Date().toISOString(),
        message: line,
        severity: "info",
      });
    }
  }

  return entries;
}
