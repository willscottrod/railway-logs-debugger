import type {
  MetricResult,
  MetricSummary,
  MetricValue,
  ServiceHealthReport,
  LogEntry,
  DeploymentNode,
} from "../types/railway.js";
import { fetchAllMetrics, fetchDeployments } from "./railway-client.js";
import { fetchAllLogs } from "./logs.js";
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

  // Fetch metrics and deployments in parallel
  const [metricsResponse, deploymentsResponse] = await Promise.all([
    fetchAllMetrics(environmentId, serviceId, startDate, endDate, sampleRate),
    fetchDeployments(projectId, environmentId, serviceId, 10),
  ]);

  // Fetch logs via CLI
  let deployLogs: LogEntry[] = [];
  let buildLogs: LogEntry[] = [];
  try {
    const logs = fetchAllLogs({
      serviceName,
      environmentName,
      since: startDate,
      until: endDate,
      lines: logLines || 500,
      filter: logFilter,
    });
    deployLogs = logs.deployLogs;
    buildLogs = logs.buildLogs;
  } catch {
    // Logs may fail if CLI is not configured for this service
  }

  const allLogs = [...buildLogs, ...deployLogs];
  const metrics = metricsResponse.metrics;
  const deployments = deploymentsResponse.deployments.edges.map((e) => e.node);

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
      cpu: summarizeMetric("CPU_USAGE", findMetric(metrics, "CPU_USAGE")),
      memory: summarizeMetric(
        "MEMORY_USAGE_GB",
        findMetric(metrics, "MEMORY_USAGE_GB")
      ),
      networkRx: summarizeMetric(
        "NETWORK_RX_GB",
        findMetric(metrics, "NETWORK_RX_GB")
      ),
      networkTx: summarizeMetric(
        "NETWORK_TX_GB",
        findMetric(metrics, "NETWORK_TX_GB")
      ),
    },
    deployments,
    logs: allLogs,
  };
}
