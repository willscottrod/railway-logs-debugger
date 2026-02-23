import { execSync } from "child_process";
import type { LogEntry } from "../types/railway.js";

export interface FetchLogsOptions {
  serviceId?: string;
  serviceName?: string;
  environmentId?: string;
  environmentName?: string;
  deploymentId?: string;
  since?: string;
  until?: string;
  lines?: number;
  filter?: string;
  build?: boolean;
}

/**
 * Fetch logs using the Railway CLI.
 *
 * Supported CLI flags: --service, --environment, --build, --json, [DEPLOYMENT_ID]
 * The CLI does NOT support --lines, --since, --until, or --filter, so those
 * are handled client-side after fetching.
 */
export function fetchLogs(options: FetchLogsOptions): LogEntry[] {
  const args: string[] = ["railway", "logs"];

  // Positional deployment ID — scopes logs to a specific deployment
  if (options.deploymentId) {
    args.push(options.deploymentId);
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

  if (options.build) {
    args.push("--build");
  }

  args.push("--json");

  try {
    const output = execSync(args.join(" "), {
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 30_000,
      env: process.env,
    });

    let entries = parseLogOutput(output);

    // Client-side time filtering (CLI doesn't support --since/--until)
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
    }
    if (options.until) {
      const untilMs = new Date(options.until).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() <= untilMs);
    }

    // Client-side text filtering (CLI doesn't support --filter)
    if (options.filter) {
      const filterLower = options.filter.toLowerCase();
      entries = entries.filter((e) =>
        e.message.toLowerCase().includes(filterLower)
      );
    }

    // Client-side line limit (CLI doesn't support --lines)
    if (options.lines && entries.length > options.lines) {
      entries = entries.slice(-options.lines);
    }

    return entries;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error fetching logs";

    // If the CLI fails with "no logs" type messages, return empty
    if (message.includes("No logs found") || message.includes("No deployments")) {
      return [];
    }

    throw new Error(`Failed to fetch logs via Railway CLI: ${message}`);
  }
}

/**
 * Fetch logs for specific deployment IDs, combining results.
 */
export function fetchLogsForDeployments(
  deploymentIds: string[],
  options?: { build?: boolean; since?: string; until?: string }
): LogEntry[] {
  const allEntries: LogEntry[] = [];

  for (const id of deploymentIds) {
    try {
      const entries = fetchLogs({
        deploymentId: id,
        build: options?.build,
        since: options?.since,
        until: options?.until,
      });
      allEntries.push(...entries);
    } catch {
      // Individual deployment log fetch may fail — continue with others
    }
  }

  // Sort by timestamp and deduplicate
  allEntries.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return allEntries;
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
