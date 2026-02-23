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
  ts: string;
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
  };
  deployments: DeploymentNode[];
  logs: LogEntry[];
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
