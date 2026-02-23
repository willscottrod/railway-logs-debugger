export interface RailwayConfig {
  user?: {
    token?: string;
  };
}

export interface RailwayStatus {
  project?: {
    id: string;
    name: string;
  };
  environment?: {
    id: string;
    name: string;
  };
  service?: {
    id: string;
    name: string;
  };
}

export type MetricMeasurement =
  | "CPU_USAGE"
  | "CPU_LIMIT"
  | "MEMORY_USAGE_GB"
  | "MEMORY_LIMIT_GB"
  | "NETWORK_RX_GB"
  | "NETWORK_TX_GB"
  | "DISK_USAGE_GB"
  | "EPHEMERAL_DISK_USAGE_GB"
  | "BACKUP_USAGE_GB";

export type MetricTag =
  | "DEPLOYMENT_ID"
  | "DEPLOYMENT_INSTANCE_ID"
  | "REGION"
  | "SERVICE_ID";

export interface MetricValue {
  ts: number;
  value: number;
}

export interface MetricTags {
  deploymentInstanceId?: string;
  deploymentId?: string;
  serviceId?: string;
  region?: string;
}

export interface MetricResult {
  measurement: MetricMeasurement;
  tags: MetricTags;
  values: MetricValue[];
}

export interface MetricsQueryVariables {
  environmentId: string;
  serviceId?: string;
  startDate: string;
  endDate?: string;
  sampleRateSeconds?: number;
  averagingWindowSeconds?: number;
  groupBy?: MetricTag[];
  measurements: MetricMeasurement[];
}

export interface MetricsResponse {
  metrics: MetricResult[];
}

export interface DeploymentNode {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  staticUrl?: string;
}

export interface DeploymentsResponse {
  deployments: {
    edges: Array<{
      node: DeploymentNode;
    }>;
  };
}

export interface LogEntry {
  timestamp: string;
  message: string;
  severity?: string;
  attributes?: Record<string, unknown>;
}

export interface ServiceHealthReport {
  service: {
    name: string;
    id: string;
    environment: string;
  };
  period: {
    start: string;
    end: string;
  };
  metrics: {
    cpu: MetricSummary;
    memory: MetricSummary;
    networkRx: MetricSummary;
    networkTx: MetricSummary;
    http?: HttpMetrics;
  };
  deployments: DeploymentNode[];
  logs: LogEntry[];
  timeline?: TimelineWindow[];
}

export interface MetricSummary {
  measurement: string;
  avg: number;
  min: number;
  max: number;
  latest: number;
  dataPoints: number;
  values: MetricValue[];
}

// --- HTTP Metrics (from Railway internal API) ---

export interface HttpDurationSample {
  ts: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface HttpStatusGroup {
  statusCode: number;
  samples: Array<{ ts: number; value: number }>;
}

export interface HttpMetricsResponse {
  httpDurationMetrics: {
    samples: HttpDurationSample[];
  };
  httpMetricsGroupedByStatus: HttpStatusGroup[];
}

export interface HttpLatencySummary {
  avg: number;
  min: number;
  max: number;
  latest: number;
  dataPoints: number;
}

export interface HttpStatusBucket {
  bucket: string;
  count: number;
  codes: Record<number, number>;
}

export interface HttpMetrics {
  latency: {
    p50: HttpLatencySummary;
    p90: HttpLatencySummary;
    p95: HttpLatencySummary;
    p99: HttpLatencySummary;
  };
  statusCodes: HttpStatusBucket[];
  totalRequests: number;
  latencySamples: HttpDurationSample[];
  statusCodeSamples: Array<{ ts: number; statusCode: number; count: number }>;
}

export interface TimelineWindow {
  start: string;
  end: string;
  cpu: number;
  memoryMb: number;
  p99: number;
  requests: number;
  errors5xx: number;
  errorLogs: number;
  isAnomaly: boolean;
}
