import { createHash } from 'node:crypto';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
  ANNOTATION_SOURCE_LOCATION,
  parseEntityRef,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import {
  classifyWorkload,
  databaseKey,
  indexRepositories,
  repositoryForImages,
  usesDatabase,
  type Classification,
  type RepositoryIndex,
} from './classify';
import {
  WORKLOAD_KINDS,
  type ClusterSnapshot,
  type InventorySettings,
  type Labels,
  type Repository,
  type Service,
  type Workload,
} from './model';

const PREFIX = 'k3s.antoinelaborderie.com';
const PROJECT_SLUG = 'github.com/project-slug';
const KUBERNETES_NAMESPACE = 'backstage.io/kubernetes-namespace';
const KUBERNETES_SELECTOR = 'backstage.io/kubernetes-label-selector';

/** Coerces a Kubernetes or GitHub name into a valid, stable entity name. */
export function toEntityName(raw: string): string {
  const name = raw
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/([._-])[._-]+/g, '$1')
    .replace(/^[._-]+|[._-]+$/g, '');
  if (!name) return 'unnamed';
  if (name.length <= 63) return name;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${name.slice(0, 54).replace(/[._-]+$/, '')}-${hash}`;
}

function toTag(raw: string): string | undefined {
  const tag = raw
    .toLowerCase()
    .replace(/[^a-z0-9:+#]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return tag || undefined;
}

/**
 * Hands out entity names unique per kind and namespace. Claims happen in a
 * fixed order, so a clash resolves to the same names on every refresh.
 */
class EntityNames {
  readonly #taken = new Set<string>();

  claim(kind: string, namespace: string, raw: string, discriminator: string) {
    const base = toEntityName(raw);
    for (const candidate of [
      base,
      toEntityName(`${raw}-${discriminator}`),
      ...Array.from({ length: 100 }, (_, i) =>
        toEntityName(`${raw}-${discriminator}-${i + 2}`),
      ),
    ]) {
      const key = `${kind}:${namespace}/${candidate}`.toLowerCase();
      if (!this.#taken.has(key)) {
        this.#taken.add(key);
        return candidate;
      }
    }
    throw new Error(`Cannot name ${kind} ${namespace}/${raw}`);
  }
}

function managedBy(location: string) {
  return {
    [ANNOTATION_LOCATION]: location,
    [ANNOTATION_ORIGIN_LOCATION]: location,
  };
}

function ownerRef(settings: InventorySettings, login: string) {
  return settings.owners.find(
    o => o.login.toLowerCase() === login.toLowerCase(),
  )?.entityRef;
}

export function buildRepositoryEntities(
  repositories: Repository[],
  settings: InventorySettings,
): Entity[] {
  const refs = repositoryRefs(repositories);
  return repositories.map(repo => {
    const ref = parseEntityRef(refs.get(slugOf(repo).toLowerCase())!);
    const tags = [
      ...repo.topics,
      ...(repo.language ? [repo.language] : []),
      ...(repo.fork ? ['fork'] : []),
      ...(repo.private ? ['private'] : []),
      ...(repo.archived ? ['archived'] : []),
    ].flatMap(t => toTag(t) ?? []);
    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: ref.name,
        namespace: ref.namespace,
        title: repo.name,
        ...(repo.description ? { description: repo.description } : {}),
        annotations: {
          ...managedBy(`url:${repo.url}`),
          [PROJECT_SLUG]: slugOf(repo),
          [ANNOTATION_SOURCE_LOCATION]: `url:${repo.url}/tree/${repo.defaultBranch}/`,
        },
        links: [
          { url: repo.url, title: 'GitHub', icon: 'github' },
          ...(repo.homepage
            ? [{ url: repo.homepage, title: 'Homepage', icon: 'web' }]
            : []),
        ],
        tags: [...new Set(tags)],
      },
      spec: {
        type: 'repository',
        lifecycle: repo.archived ? 'deprecated' : 'production',
        owner: ownerRef(settings, repo.owner) ?? settings.defaultOwner,
      },
    };
  });
}

function matches(selector: Labels, labels: Labels) {
  const entries = Object.entries(selector);
  return entries.length > 0 && entries.every(([k, v]) => labels[k] === v);
}

function workloadKey(w: { namespace: string; name: string }) {
  return `${w.namespace}/${w.name}`;
}

interface DatabaseGroup {
  namespace: string;
  key: string;
  engine: string;
  workloads: Workload[];
  serviceNames: string[];
}

export function buildClusterEntities(
  snapshot: ClusterSnapshot,
  repositories: Repository[],
  settings: InventorySettings,
): Entity[] {
  const names = new EntityNames();
  const index: RepositoryIndex = indexRepositories(repositories);
  const refs = repositoryRefs(repositories);
  const visible = (ns: string) => !settings.skipNamespaces.has(ns);

  const namespaces = [...snapshot.namespaces]
    .filter(ns => !settings.hiddenNamespaces.has(ns))
    .sort();
  const namespaceRefs = new Map(
    namespaces.map(ns => {
      const entityNs = toEntityName(ns);
      const name = names.claim('Resource', entityNs, ns, 'namespace');
      return [ns, `resource:${entityNs}/${name}`] as const;
    }),
  );
  const namespaceRef = (ns: string) => namespaceRefs.get(ns);

  const services = snapshot.services.filter(s => visible(s.namespace));
  const routes = snapshot.ingressRoutes
    .filter(r => visible(r.namespace))
    .sort((a, b) => workloadKey(a).localeCompare(workloadKey(b)));
  const workloads = snapshot.workloads
    .filter(w => visible(w.namespace))
    .filter(w => !(settings.skipCronJobRuns && w.ownedByCronJob))
    .sort(
      (a, b) =>
        a.namespace.localeCompare(b.namespace) ||
        WORKLOAD_KINDS.indexOf(a.kind) - WORKLOAD_KINDS.indexOf(b.kind) ||
        a.name.localeCompare(b.name),
    );

  const servicesOf = (w: Workload): Service[] =>
    services.filter(
      s => s.namespace === w.namespace && matches(s.selector, w.podLabels),
    );
  const routesTo = (svcs: Service[]) =>
    routes.filter(r =>
      r.services.some(rs =>
        svcs.some(s => s.namespace === rs.namespace && s.name === rs.name),
      ),
    );

  const classified = workloads.map(w => {
    const svcs = servicesOf(w);
    const override = settings.overrides.get(workloadKey(w));
    const classification: Classification = classifyWorkload(
      {
        kind: w.kind,
        name: w.name,
        images: w.images,
        hasService: svcs.length > 0,
        routed: routesTo(svcs).length > 0,
      },
      override?.type,
    );
    return { workload: w, services: svcs, override, classification };
  });

  const groups = new Map<string, DatabaseGroup>();
  for (const { workload, services: svcs, classification } of classified) {
    if (classification.kind !== 'Resource') continue;
    const key = databaseKey(workload);
    const id = `${workload.namespace}/${key}`;
    const group = groups.get(id) ?? {
      namespace: workload.namespace,
      key,
      engine: classification.engine,
      workloads: [],
      serviceNames: [],
    };
    group.workloads.push(workload);
    group.serviceNames.push(...svcs.map(s => s.name));
    groups.set(id, group);
  }
  const databases = [...groups.values()].map(group => {
    const entityNs = toEntityName(group.namespace);
    const name = names.claim('Resource', entityNs, group.key, 'database');
    return { ...group, name, ref: `resource:${entityNs}/${name}` };
  });

  const routeNames = new Map(
    routes.map(r => {
      const entityNs = toEntityName(r.namespace);
      return [
        workloadKey(r),
        names.claim('Resource', entityNs, r.name, 'ingress-route'),
      ] as const;
    }),
  );

  const components = classified
    .filter(c => c.classification.kind === 'Component')
    .map(c => {
      const entityNs = toEntityName(c.workload.namespace);
      const name = names.claim(
        'Component',
        entityNs,
        c.workload.name,
        c.workload.kind.toLowerCase(),
      );
      return { ...c, ref: `component:${entityNs}/${name}`, name, entityNs };
    });

  const resource = (
    namespace: string,
    name: string,
    location: string,
    metadata: Partial<Entity['metadata']>,
    spec: Record<string, unknown>,
  ): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name,
      namespace: toEntityName(namespace),
      ...metadata,
      annotations: { ...managedBy(location), ...metadata.annotations },
    },
    spec: {
      owner: settings.defaultOwner,
      ...spec,
      dependsOn: [namespaceRef(namespace) ?? []].flat(),
    },
  });

  const entities: Entity[] = [];

  for (const ns of namespaces) {
    const ref = namespaceRefs.get(ns)!;
    entities.push({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {
        name: ref.slice(ref.indexOf('/') + 1),
        namespace: toEntityName(ns),
        title: ns,
        description: `k3s namespace ${ns}`,
        annotations: managedBy(`k3s:namespace/${ns}`),
      },
      spec: { type: 'namespace', owner: settings.defaultOwner },
    });
  }

  for (const db of databases) {
    const images = [...new Set(db.workloads.flatMap(w => w.images))];
    entities.push(
      resource(
        db.namespace,
        db.name,
        `k3s:database/${db.namespace}/${db.key}`,
        {
          title: db.key,
          description: `${db.engine} · ${db.workloads
            .map(w => `${w.kind} ${w.name}`)
            .join(', ')} · ${images.join(', ')}`,
          annotations: {
            [`${PREFIX}/engine`]: db.engine,
            [`${PREFIX}/workloads`]: db.workloads
              .map(w => `${w.kind}/${w.name}`)
              .join(','),
            [`${PREFIX}/images`]: images.join(','),
            [`${PREFIX}/services`]: [...new Set(db.serviceNames)].join(','),
          },
          tags: [db.engine],
        },
        { type: 'database' },
      ),
    );
  }

  for (const route of routes) {
    const behind = components.filter(c =>
      c.services.some(s =>
        route.services.some(
          rs => rs.namespace === s.namespace && rs.name === s.name,
        ),
      ),
    );
    entities.push(
      resource(
        route.namespace,
        routeNames.get(workloadKey(route))!,
        `k3s:ingressroute/${route.namespace}/${route.name}`,
        {
          title: route.name,
          ...(route.hosts.length
            ? { description: route.hosts.join(', ') }
            : {}),
          annotations: {
            [`${PREFIX}/hosts`]: route.hosts.join(','),
            [`${PREFIX}/services`]: route.services
              .map(s => `${s.namespace}/${s.name}`)
              .join(','),
          },
          links: route.hosts.map(h => ({
            url: `https://${h}`,
            title: h,
            icon: 'web',
          })),
        },
        {
          type: 'ingress-route',
          dependencyOf: [...new Set(behind.map(c => c.ref))],
        },
      ),
    );
  }

  for (const c of components) {
    const w = c.workload;
    const found = c.override?.repository
      ? index.get(c.override.repository.toLowerCase()) ??
        slugParts(c.override.repository)
      : repositoryForImages(w.images, index);
    const repo = found && linkTo(found.owner, found.name, refs);
    const hosts = [...new Set(routesTo(c.services).flatMap(r => r.hosts))];
    const dbRefs = databases
      .filter(db => db.namespace === w.namespace && usesDatabase(w, db))
      .map(db => db.ref);
    const selector = Object.entries(w.podLabels)
      .filter(([k]) => k !== 'pod-template-hash')
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const status = w.schedule
      ? `schedule ${w.schedule}`
      : w.replicas && `${w.replicas.ready}/${w.replicas.desired} ready`;
    entities.push({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: c.name,
        namespace: c.entityNs,
        title: w.name,
        description: [w.kind, status, w.images.join(', ')]
          .filter(Boolean)
          .join(' · '),
        annotations: {
          ...managedBy(`k3s:${w.kind.toLowerCase()}/${w.namespace}/${w.name}`),
          [KUBERNETES_NAMESPACE]: w.namespace,
          ...(selector ? { [KUBERNETES_SELECTOR]: selector } : {}),
          ...(repo
            ? {
                [PROJECT_SLUG]: repo.slug,
                [ANNOTATION_SOURCE_LOCATION]: `url:https://github.com/${repo.slug}/`,
              }
            : {}),
          [`${PREFIX}/kind`]: w.kind,
          [`${PREFIX}/images`]: w.images.join(','),
          ...(w.replicas
            ? {
                [`${PREFIX}/replicas`]: `${w.replicas.ready}/${w.replicas.desired}`,
              }
            : {}),
          ...(w.schedule ? { [`${PREFIX}/schedule`]: w.schedule } : {}),
        },
        links: hosts.map(h => ({
          url: `https://${h}`,
          title: h,
          icon: 'web',
        })),
        tags: [w.kind.toLowerCase()],
      },
      spec: {
        type: c.classification.type,
        lifecycle: 'production',
        owner:
          (repo && ownerRef(settings, repo.owner)) ?? settings.defaultOwner,
        ...(repo ? { subcomponentOf: repo.ref } : {}),
        dependsOn: [namespaceRef(w.namespace) ?? [], ...dbRefs].flat(),
      },
    });
  }

  return entities;
}

interface RepositoryLink {
  owner: string;
  slug: string;
  ref: string;
}

function slugOf(repo: { owner: string; name: string }) {
  return `${repo.owner}/${repo.name}`;
}

/** Entity refs of repository components, keyed by lowercased `owner/name`. */
function repositoryRefs(repositories: Repository[]): Map<string, string> {
  const names = new EntityNames();
  return new Map(
    [...repositories]
      .sort((a, b) => slugOf(a).localeCompare(slugOf(b)))
      .map(repo => {
        const namespace = toEntityName(repo.owner.toLowerCase());
        const name = names.claim('Component', namespace, repo.name, 'repo');
        return [
          slugOf(repo).toLowerCase(),
          stringifyEntityRef({ kind: 'Component', namespace, name }),
        ] as const;
      }),
  );
}

function linkTo(
  owner: string,
  name: string,
  refs: Map<string, string>,
): RepositoryLink {
  const slug = `${owner}/${name}`;
  return {
    owner,
    slug,
    ref:
      refs.get(slug.toLowerCase()) ??
      stringifyEntityRef({
        kind: 'Component',
        namespace: toEntityName(owner.toLowerCase()),
        name: toEntityName(name),
      }),
  };
}

function slugParts(slug: string) {
  const [owner, name] = slug.split('/') as [string, string];
  return { owner, name };
}
