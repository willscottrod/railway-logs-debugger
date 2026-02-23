import { GraphQLClient, gql } from "graphql-request";
import type {
  MetricsResponse,
  MetricsQueryVariables,
  DeploymentsResponse,
  MetricMeasurement,
  HttpMetricsResponse,
  LogEntry,
} from "../types/railway.js";
import { getToken } from "./auth.js";

const RAILWAY_API_ENDPOINT = "https://backboard.railway.com/graphql/v2";
const RAILWAY_INTERNAL_ENDPOINT =
  "https://backboard.railway.com/graphql/internal?q=httpServiceTabMetrics";

let clientInstance: GraphQLClient | null = null;
let internalClientInstance: GraphQLClient | null = null;

async function getClient(): Promise<GraphQLClient> {
  if (clientInstance) return clientInstance;

  const token = await getToken();
  clientInstance = new GraphQLClient(RAILWAY_API_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return clientInstance;
}

async function getInternalClient(): Promise<GraphQLClient> {
  if (internalClientInstance) return internalClientInstance;

  const token = await getToken();
  internalClientInstance = new GraphQLClient(RAILWAY_INTERNAL_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return internalClientInstance;
}

const METRICS_QUERY = gql`
  query metrics(
    $environmentId: String!
    $serviceId: String
    $startDate: DateTime!
    $endDate: DateTime
    $sampleRateSeconds: Int
    $averagingWindowSeconds: Int
    $groupBy: [MetricTag!]
    $measurements: [MetricMeasurement!]!
  ) {
    metrics(
      environmentId: $environmentId
      serviceId: $serviceId
      startDate: $startDate
      endDate: $endDate
      sampleRateSeconds: $sampleRateSeconds
      averagingWindowSeconds: $averagingWindowSeconds
      groupBy: $groupBy
      measurements: $measurements
    ) {
      measurement
      tags {
        deploymentInstanceId
        deploymentId
        serviceId
        region
      }
      values {
        ts
        value
      }
    }
  }
`;

const DEPLOYMENTS_QUERY = gql`
  query deployments(
    $projectId: String!
    $environmentId: String!
    $serviceId: String!
    $first: Int
  ) {
    deployments(
      first: $first
      input: {
        projectId: $projectId
        environmentId: $environmentId
        serviceId: $serviceId
      }
    ) {
      edges {
        node {
          id
          status
          createdAt
          updatedAt
          staticUrl
        }
      }
    }
  }
`;

const PROJECT_QUERY = gql`
  query project($id: String!) {
    project(id: $id) {
      id
      name
      services {
        edges {
          node {
            id
            name
          }
        }
      }
      environments {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`;

const HTTP_METRICS_QUERY = gql`
  query httpServiceTabMetrics(
    $serviceId: String!
    $environmentId: String!
    $startDate: DateTime!
    $endDate: DateTime!
    $stepSeconds: Int
    $statusCode: Int
    $method: String
    $path: String
  ) {
    httpDurationMetrics(
      serviceId: $serviceId
      environmentId: $environmentId
      startDate: $startDate
      endDate: $endDate
      stepSeconds: $stepSeconds
      statusCode: $statusCode
      method: $method
      path: $path
    ) {
      samples {
        ...HttpDurationMetricsSampleFields
      }
    }
    httpMetricsGroupedByStatus(
      serviceId: $serviceId
      environmentId: $environmentId
      startDate: $startDate
      endDate: $endDate
      stepSeconds: $stepSeconds
      method: $method
      path: $path
    ) {
      statusCode
      samples {
        ...HttpMetricsSampleFields
      }
    }
  }

  fragment HttpDurationMetricsSampleFields on HttpDurationMetricsSample {
    ts
    p50
    p90
    p95
    p99
  }

  fragment HttpMetricsSampleFields on HttpMetricsSample {
    ts
    value
  }
`;

/**
 * Fetch metrics for a service in a given time range.
 */
export async function fetchMetrics(
  variables: MetricsQueryVariables
): Promise<MetricsResponse> {
  const client = await getClient();
  return client.request<MetricsResponse>(METRICS_QUERY, variables);
}

/**
 * Fetch all resource metrics (CPU, memory, network) for a service.
 */
export async function fetchAllMetrics(
  environmentId: string,
  serviceId: string,
  startDate: string,
  endDate: string,
  sampleRateSeconds?: number
): Promise<MetricsResponse> {
  const measurements: MetricMeasurement[] = [
    "CPU_USAGE",
    "CPU_LIMIT",
    "MEMORY_USAGE_GB",
    "MEMORY_LIMIT_GB",
    "NETWORK_RX_GB",
    "NETWORK_TX_GB",
    "DISK_USAGE_GB",
  ];

  return fetchMetrics({
    environmentId,
    serviceId,
    startDate,
    endDate,
    sampleRateSeconds,
    measurements,
    groupBy: ["DEPLOYMENT_ID"],
  });
}

/**
 * Fetch recent deployments for a service.
 */
export async function fetchDeployments(
  projectId: string,
  environmentId: string,
  serviceId: string,
  first: number = 10
): Promise<DeploymentsResponse> {
  const client = await getClient();
  return client.request<DeploymentsResponse>(DEPLOYMENTS_QUERY, {
    projectId,
    environmentId,
    serviceId,
    first,
  });
}

/**
 * Fetch HTTP latency and status code metrics from Railway's internal API.
 */
export async function fetchHttpMetrics(
  environmentId: string,
  serviceId: string,
  startDate: string,
  endDate: string,
  stepSeconds?: number
): Promise<HttpMetricsResponse> {
  const client = await getInternalClient();
  return client.request<HttpMetricsResponse>(HTTP_METRICS_QUERY, {
    serviceId,
    environmentId,
    startDate,
    endDate,
    stepSeconds,
  });
}

/**
 * Fetch project details including services and environments.
 */
export async function fetchProject(
  projectId: string
): Promise<{
  project: {
    id: string;
    name: string;
    services: { edges: Array<{ node: { id: string; name: string } }> };
    environments: { edges: Array<{ node: { id: string; name: string } }> };
  };
}> {
  const client = await getClient();
  return client.request(PROJECT_QUERY, { id: projectId });
}

const DEPLOYMENT_LOGS_QUERY = gql`
  query deploymentLogs($deploymentId: String!, $limit: Int) {
    deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
      timestamp
      message
      severity
    }
  }
`;

const BUILD_LOGS_QUERY = gql`
  query buildLogs($deploymentId: String!, $limit: Int) {
    buildLogs(deploymentId: $deploymentId, limit: $limit) {
      timestamp
      message
      severity
    }
  }
`;

interface GqlLogEntry {
  timestamp: string;
  message: string;
  severity?: string;
}

/**
 * Fetch deployment logs via GraphQL API for a single deployment.
 */
export async function fetchDeploymentLogs(
  deploymentId: string,
  limit: number = 500
): Promise<LogEntry[]> {
  const client = await getClient();
  const data = await client.request<{ deploymentLogs: GqlLogEntry[] }>(
    DEPLOYMENT_LOGS_QUERY,
    { deploymentId, limit }
  );
  return data.deploymentLogs.map((l) => ({
    timestamp: l.timestamp,
    message: l.message,
    severity: l.severity || "info",
  }));
}

/**
 * Fetch build logs via GraphQL API for a single deployment.
 */
export async function fetchBuildLogs(
  deploymentId: string,
  limit: number = 500
): Promise<LogEntry[]> {
  const client = await getClient();
  const data = await client.request<{ buildLogs: GqlLogEntry[] }>(
    BUILD_LOGS_QUERY,
    { deploymentId, limit }
  );
  return data.buildLogs.map((l) => ({
    timestamp: l.timestamp,
    message: l.message,
    severity: l.severity || "info",
  }));
}
