export const WORKLOAD_KINDS = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'CronJob',
  'Job',
] as const;
export type WorkloadKind = (typeof WORKLOAD_KINDS)[number];

export const COMPONENT_TYPES = [
  'api',
  'frontend',
  'bot',
  'job',
  'cronjob',
  'worker',
  'service',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export type DatabaseEngine = 'postgres' | 'redis' | 'mysql' | 'mongodb';

export type Labels = Readonly<Record<string, string>>;

export interface Workload {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  images: string[];
  labels: Labels;
  /** Labels on the pods the workload creates; Services select on these. */
  podLabels: Labels;
  /** Literal env values, used to spot references to database Services. */
  envValues: string[];
  replicas?: { desired: number; ready: number };
  schedule?: string;
  ownedByCronJob: boolean;
}

export interface Service {
  namespace: string;
  name: string;
  selector: Labels;
}

export interface IngressRoute {
  namespace: string;
  name: string;
  hosts: string[];
  services: Array<{ namespace: string; name: string }>;
}

export interface ClusterSnapshot {
  namespaces: string[];
  workloads: Workload[];
  services: Service[];
  ingressRoutes: IngressRoute[];
}

export interface Repository {
  owner: string;
  name: string;
  description?: string;
  url: string;
  defaultBranch: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
  topics: string[];
  homepage?: string;
  language?: string;
}

export interface WorkloadOverride {
  type?: ComponentType;
  /** `owner/name` of the GitHub repository the workload is built from. */
  repository?: string;
}

export interface InventorySettings {
  owners: ReadonlyArray<{ login: string; entityRef: string }>;
  defaultOwner: string;
  hiddenNamespaces: ReadonlySet<string>;
  skipNamespaces: ReadonlySet<string>;
  skipCronJobRuns: boolean;
  /** Keyed by `<k3s namespace>/<workload name>`. */
  overrides: ReadonlyMap<string, WorkloadOverride>;
}
