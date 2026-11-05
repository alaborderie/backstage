import {
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  type V1Container,
  type V1ObjectMeta,
  type V1PodTemplateSpec,
} from '@kubernetes/client-node';
import type {
  ClusterSnapshot,
  IngressRoute,
  Labels,
  Workload,
  WorkloadKind,
} from './model';

/** Lists only; the reader never writes and never reads Secrets. */
export type ClusterReader = () => Promise<ClusterSnapshot>;

function containersOf(template: V1PodTemplateSpec | undefined): V1Container[] {
  return template?.spec?.containers ?? [];
}

function toWorkload(
  kind: WorkloadKind,
  metadata: V1ObjectMeta | undefined,
  template: V1PodTemplateSpec | undefined,
  extra: Pick<Workload, 'replicas' | 'schedule'> = {},
): Workload {
  const containers = containersOf(template);
  return {
    kind,
    namespace: metadata?.namespace ?? 'default',
    name: metadata?.name ?? '',
    images: containers.flatMap(c => (c.image ? [c.image] : [])),
    labels: metadata?.labels ?? {},
    podLabels: template?.metadata?.labels ?? {},
    envValues: containers.flatMap(c =>
      (c.env ?? []).flatMap(e => (e.value ? [e.value] : [])),
    ),
    ownedByCronJob: (metadata?.ownerReferences ?? []).some(
      o => o.kind === 'CronJob',
    ),
    ...extra,
  };
}

const HOST = /Host\(([^)]*)\)/g;

/** Traefik IngressRoutes are untyped custom objects; parse defensively. */
function toIngressRoute(item: unknown): IngressRoute | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const { metadata, spec } = item as {
    metadata?: { name?: string; namespace?: string };
    spec?: {
      routes?: Array<{
        match?: string;
        services?: Array<{ name?: string; namespace?: string; kind?: string }>;
      }>;
    };
  };
  if (!metadata?.name || !metadata.namespace) return undefined;
  const namespace = metadata.namespace;
  const routes = spec?.routes ?? [];
  const hosts = routes.flatMap(r =>
    [...(r.match ?? '').matchAll(HOST)].flatMap(m =>
      [...m[1]!.matchAll(/`([^`]+)`/g)].map(h => h[1]!),
    ),
  );
  const services = routes.flatMap(r =>
    (r.services ?? []).flatMap(s =>
      s.name && (s.kind ?? 'Service') === 'Service'
        ? [{ namespace: s.namespace || namespace, name: s.name }]
        : [],
    ),
  );
  return {
    namespace,
    name: metadata.name,
    hosts: [...new Set(hosts)],
    services: services.filter(
      (s, i) =>
        services.findIndex(
          o => o.namespace === s.namespace && o.name === s.name,
        ) === i,
    ),
  };
}

export function kubernetesClusterReader(kubeConfig: KubeConfig): ClusterReader {
  const core = kubeConfig.makeApiClient(CoreV1Api);
  const apps = kubeConfig.makeApiClient(AppsV1Api);
  const batch = kubeConfig.makeApiClient(BatchV1Api);
  const custom = kubeConfig.makeApiClient(CustomObjectsApi);

  return async () => {
    const [
      namespaces,
      services,
      deployments,
      statefulSets,
      daemonSets,
      cronJobs,
      jobs,
      ingressRoutes,
    ] = await Promise.all([
      core.listNamespace(),
      core.listServiceForAllNamespaces(),
      apps.listDeploymentForAllNamespaces(),
      apps.listStatefulSetForAllNamespaces(),
      apps.listDaemonSetForAllNamespaces(),
      batch.listCronJobForAllNamespaces(),
      batch.listJobForAllNamespaces(),
      custom.listClusterCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        plural: 'ingressroutes',
      }) as Promise<{ items?: unknown[] }>,
    ]);

    const replicas = (desired?: number, ready?: number) => ({
      replicas: { desired: desired ?? 1, ready: ready ?? 0 },
    });
    return {
      namespaces: namespaces.items.flatMap(n =>
        n.metadata?.name ? [n.metadata.name] : [],
      ),
      services: services.items.map(s => ({
        namespace: s.metadata?.namespace ?? 'default',
        name: s.metadata?.name ?? '',
        selector: (s.spec?.selector ?? {}) as Labels,
      })),
      workloads: [
        ...deployments.items.map(d =>
          toWorkload(
            'Deployment',
            d.metadata,
            d.spec?.template,
            replicas(d.spec?.replicas, d.status?.readyReplicas),
          ),
        ),
        ...statefulSets.items.map(s =>
          toWorkload(
            'StatefulSet',
            s.metadata,
            s.spec?.template,
            replicas(s.spec?.replicas, s.status?.readyReplicas),
          ),
        ),
        ...daemonSets.items.map(d =>
          toWorkload(
            'DaemonSet',
            d.metadata,
            d.spec?.template,
            replicas(d.status?.desiredNumberScheduled, d.status?.numberReady),
          ),
        ),
        ...cronJobs.items.map(c =>
          toWorkload(
            'CronJob',
            c.metadata,
            c.spec?.jobTemplate.spec?.template,
            c.spec?.schedule ? { schedule: c.spec.schedule } : {},
          ),
        ),
        ...jobs.items.map(j => toWorkload('Job', j.metadata, j.spec?.template)),
      ],
      ingressRoutes: (ingressRoutes.items ?? []).flatMap(
        item => toIngressRoute(item) ?? [],
      ),
    };
  };
}

/** KUBECONFIG, then ~/.kube/config, then the in-cluster ServiceAccount. */
export function defaultClusterReader(): ClusterReader {
  try {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    return kubernetesClusterReader(kubeConfig);
  } catch (error) {
    return () => Promise.reject(error);
  }
}
