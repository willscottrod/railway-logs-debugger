import { GraphQLClient, gql } from "graphql-request";
import type {
  MetricsResponse,
  MetricsQueryVariables,
  DeploymentsResponse,
  MetricMeasurement,
} from "../types/railway.js";
import { getToken } from "./auth.js";

const RAILWAY_API_ENDPOINT = "https://backboard.railway.com/graphql/v2";

let clientInstance: GraphQLClient | null = null;

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
