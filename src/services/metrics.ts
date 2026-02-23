import type {
  MetricResult,
  MetricSummary,
  MetricValue,
  ServiceHealthReport,
  LogEntry,
  DeploymentNode,
  HttpMetricsResponse,
  HttpMetrics,
  HttpLatencySummary,
  HttpDurationSample,
  HttpStatusBucket,
  TimelineWindow,
} from "../types/railway.js";
import { fetchAllMetrics, fetchDeployments, fetchHttpMetrics, fetchDeploymentLogs, fetchBuildLogs } from "./railway-client.js";
import { calculateSampleRate } from "../utils/time.js";

/**
 * Summarize a list of metric values into a MetricSummary.
 */
function summarizeMetric(
  measurement: string,
  values: MetricValue[]
): MetricSummary {
  if (values.length === 0) {
    return {
      measurement,
      avg: 0,
      min: 0,
      max: 0,
      latest: 0,
      dataPoints: 0,
      values: [],
    };
  }

  const nums = values.map((v) => v.value);
  const sum = nums.reduce((a, b) => a + b, 0);

  return {
    measurement,
    avg: sum / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    latest: nums[nums.length - 1],
    dataPoints: nums.length,
    values,
  };
}

function findMetric(
  metrics: MetricResult[],
  measurement: string
): MetricValue[] {
  const found = metrics.find((m) => m.measurement === measurement);
  return found?.values ?? [];
}

/**
 * Summarize a single latency percentile from duration samples.
 */
function summarizePercentile(
  samples: HttpDurationSample[],
  key: keyof Pick<HttpDurationSample, "p50" | "p90" | "p95" | "p99">
): HttpLatencySummary {
  if (samples.length === 0) {
    return { avg: 0, min: 0, max: 0, latest: 0, dataPoints: 0 };
  }

  const values = samples.map((s) => s[key]);
  const sum = values.reduce((a, b) => a + b, 0);

  return {
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    latest: values[values.length - 1],
    dataPoints: values.length,
  };
}

/**
 * Summarize HTTP metrics into latency percentiles and status code buckets.
 */
function summarizeHttpMetrics(response: HttpMetricsResponse): HttpMetrics {
  const samples = response.httpDurationMetrics.samples;

  // Aggregate status codes into buckets (2xx, 3xx, 4xx, 5xx)
  const bucketMap = new Map<string, { count: number; codes: Record<number, number> }>();

  let totalRequests = 0;
  for (const group of response.httpMetricsGroupedByStatus) {
    const code = group.statusCode;
    const bucket = `${Math.floor(code / 100)}xx`;
    const total = group.samples.reduce((sum, s) => sum + s.value, 0);
    totalRequests += total;

    if (!bucketMap.has(bucket)) {
      bucketMap.set(bucket, { count: 0, codes: {} });
    }
    const entry = bucketMap.get(bucket)!;
    entry.count += total;
    entry.codes[code] = (entry.codes[code] || 0) + total;
  }

  const statusCodes: HttpStatusBucket[] = Array.from(bucketMap.entries())
    .map(([bucket, data]) => ({ bucket, count: data.count, codes: data.codes }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Build flat status code samples for timeline correlation
  const statusCodeSamples: Array<{ ts: number; statusCode: number; count: number }> = [];
  for (const group of response.httpMetricsGroupedByStatus) {
    for (const s of group.samples) {
      statusCodeSamples.push({ ts: s.ts, statusCode: group.statusCode, count: s.value });
    }
  }

  return {
    latency: {
      p50: summarizePercentile(samples, "p50"),
      p90: summarizePercentile(samples, "p90"),
      p95: summarizePercentile(samples, "p95"),
      p99: summarizePercentile(samples, "p99"),
    },
    statusCodes,
    totalRequests,
    latencySamples: samples,
    statusCodeSamples,
  };
}

/**
 * Build a correlated timeline by dividing the analysis period into windows
 * and aggregating all signal types per window.
 */
export function buildCorrelationTimeline(
  startDate: string,
  endDate: string,
  cpuValues: MetricValue[],
  memoryValues: MetricValue[],
  http: HttpMetrics | undefined,
  logs: LogEntry[]
): TimelineWindow[] {
  // All Railway API timestamps are epoch seconds
  const startSec = Math.floor(new Date(startDate).getTime() / 1000);
  const endSec = Math.floor(new Date(endDate).getTime() / 1000);
  const rangeSec = endSec - startSec;
  if (rangeSec <= 0) return [];

  // Auto-size to ~10-20 buckets
  const bucketCount = Math.min(20, Math.max(10, Math.ceil(rangeSec / (5 * 60))));
  const windowSec = rangeSec / bucketCount;

  // Pre-filter error logs
  const errorLogs = logs.filter(
    (l) =>
      l.severity === "error" ||
      l.severity === "ERROR" ||
      l.message.toLowerCase().includes("error") ||
      l.message.toLowerCase().includes("exception") ||
      l.message.toLowerCase().includes("fatal")
  );

  // Build windows
  const windows: TimelineWindow[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const wStart = startSec + i * windowSec;
    const wEnd = wStart + windowSec;

    // CPU: average in window (MetricValue.ts is epoch seconds)
    const cpuInWindow = cpuValues.filter((v) => v.ts >= wStart && v.ts < wEnd);
    const cpu =
      cpuInWindow.length > 0
        ? cpuInWindow.reduce((s, v) => s + v.value, 0) / cpuInWindow.length
        : 0;

    // Memory: max in window (convert GB → MB; ts is epoch seconds)
    const memInWindow = memoryValues.filter((v) => v.ts >= wStart && v.ts < wEnd);
    const memoryMb =
      memInWindow.length > 0
        ? Math.max(...memInWindow.map((v) => v.value)) * 1024
        : 0;

    // HTTP p99: max in window (HttpDurationSample.ts is epoch seconds)
    let p99 = 0;
    let requests = 0;
    let errors5xx = 0;
    if (http) {
      const latInWindow = http.latencySamples.filter(
        (s) => s.ts >= wStart && s.ts < wEnd
      );
      p99 = latInWindow.length > 0 ? Math.max(...latInWindow.map((s) => s.p99)) : 0;

      // Status code samples in window (ts is epoch seconds)
      for (const s of http.statusCodeSamples) {
        if (s.ts >= wStart && s.ts < wEnd) {
          requests += s.count;
          if (s.statusCode >= 500 && s.statusCode < 600) {
            errors5xx += s.count;
          }
        }
      }
    }

    // Error logs in window (log timestamps are ISO strings)
    const errorLogCount = errorLogs.filter((l) => {
      const t = new Date(l.timestamp).getTime() / 1000;
      return t >= wStart && t < wEnd;
    }).length;

    windows.push({
      start: new Date(wStart * 1000).toISOString(),
      end: new Date(wEnd * 1000).toISOString(),
      cpu,
      memoryMb,
      p99,
      requests,
      errors5xx,
      errorLogs: errorLogCount,
      isAnomaly: false, // will be set below
    });
  }

  // Detect anomalies: any metric > mean + 2*stddev
  const metricsToCheck: Array<keyof Pick<TimelineWindow, "cpu" | "memoryMb" | "p99" | "errors5xx" | "errorLogs">> = [
    "cpu", "memoryMb", "p99", "errors5xx", "errorLogs",
  ];

  for (const key of metricsToCheck) {
    const vals = windows.map((w) => w[key] as number);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const stddev = Math.sqrt(variance);
    const threshold = mean + 2 * stddev;

    if (stddev > 0) {
      for (const w of windows) {
        if ((w[key] as number) > threshold) {
          w.isAnomaly = true;
        }
      }
    }
  }

  return windows;
}

/**
 * Collect all service health data: metrics, deployments, and logs.
 */
export async function collectServiceHealth(options: {
  projectId: string;
  environmentId: string;
  environmentName: string;
  serviceId: string;
  serviceName: string;
  startDate: string;
  endDate: string;
  logLines?: number;
  logFilter?: string;
}): Promise<ServiceHealthReport> {
  const {
    projectId,
    environmentId,
    environmentName,
    serviceId,
    serviceName,
    startDate,
    endDate,
    logLines,
    logFilter,
  } = options;

  const sampleRate = calculateSampleRate(startDate, endDate);

  // Fetch metrics, deployments, and HTTP metrics in parallel
  const [metricsResponse, deploymentsResponse, httpMetricsResponse] = await Promise.all([
    fetchAllMetrics(environmentId, serviceId, startDate, endDate, sampleRate),
    fetchDeployments(projectId, environmentId, serviceId, 10),
    fetchHttpMetrics(environmentId, serviceId, startDate, endDate, sampleRate).catch(() => null),
  ]);

  // Fetch logs via GraphQL API using deployment IDs
  let allLogs: LogEntry[] = [];
  const relevantDeployments = deploymentsResponse.deployments.edges
    .map((e) => e.node)
    .filter((d) => {
      const created = new Date(d.createdAt).getTime();
      return created <= new Date(endDate).getTime();
    });

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const limit = logLines || 500;

  for (const deployment of relevantDeployments) {
    try {
      const logs = await fetchDeploymentLogs(deployment.id, limit);
      allLogs.push(...logs);
    } catch {
      // Individual deployment log fetch may fail — continue
    }
    try {
      const logs = await fetchBuildLogs(deployment.id, limit);
      allLogs.push(...logs);
    } catch {
      // Build logs may not be available
    }
  }

  // Filter to analysis period and apply text filter
  allLogs = allLogs.filter((l) => {
    const t = new Date(l.timestamp).getTime();
    return t >= startMs && t <= endMs;
  });
  if (logFilter) {
    const filterLower = logFilter.toLowerCase();
    allLogs = allLogs.filter((l) =>
      l.message.toLowerCase().includes(filterLower)
    );
  }

  // Sort by timestamp
  allLogs.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const metrics = metricsResponse.metrics;
  const deployments = deploymentsResponse.deployments.edges.map((e) => e.node);

  // Summarize HTTP metrics if available
  const http = httpMetricsResponse ? summarizeHttpMetrics(httpMetricsResponse) : undefined;

  const cpuValues = findMetric(metrics, "CPU_USAGE");
  const memoryValues = findMetric(metrics, "MEMORY_USAGE_GB");

  // Build correlation timeline
  const timeline = buildCorrelationTimeline(
    startDate,
    endDate,
    cpuValues,
    memoryValues,
    http,
    allLogs
  );

  return {
    service: {
      name: serviceName,
      id: serviceId,
      environment: environmentName,
    },
    period: {
      start: startDate,
      end: endDate,
    },
    metrics: {
      cpu: summarizeMetric("CPU_USAGE", cpuValues),
      memory: summarizeMetric("MEMORY_USAGE_GB", memoryValues),
      networkRx: summarizeMetric(
        "NETWORK_RX_GB",
        findMetric(metrics, "NETWORK_RX_GB")
      ),
      networkTx: summarizeMetric(
        "NETWORK_TX_GB",
        findMetric(metrics, "NETWORK_TX_GB")
      ),
      http,
    },
    deployments,
    logs: allLogs,
    timeline: timeline.length > 0 ? timeline : undefined,
  };
}
