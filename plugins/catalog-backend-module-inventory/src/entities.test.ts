import {
  componentEntityV1alpha1Validator,
  DefaultNamespaceEntityPolicy,
  EntityPolicies,
  FieldFormatEntityPolicy,
  getCompoundEntityRef,
  NoForeignRootFieldsEntityPolicy,
  resourceEntityV1alpha1Validator,
  SchemaValidEntityPolicy,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import { ConfigReader } from '@backstage/config';
import {
  buildClusterEntities,
  buildRepositoryEntities,
  toEntityName,
} from './entities';
import type { ClusterSnapshot, Repository, Workload } from './model';
import { readSettings } from './settings';

const { settings } = readSettings(
  new ConfigReader({
    inventory: {
      github: {
        owners: [
          { login: 'alaborderie', entityRef: 'user:default/alaborderie' },
          { login: 'duscraft', entityRef: 'group:default/duscraft' },
        ],
      },
      kubernetes: {
        owner: 'user:default/alaborderie',
        overrides: [
          {
            workload: 'default/opencode-web',
            type: 'frontend',
            repository: 'alaborderie/opencode',
          },
        ],
      },
    },
  }),
);

const repo = (
  owner: string,
  name: string,
  extra: Partial<Repository> = {},
): Repository => ({
  owner,
  name,
  url: `https://github.com/${owner}/${name}`,
  defaultBranch: 'main',
  archived: false,
  fork: false,
  private: false,
  topics: [],
  ...extra,
});

const repositories = [
  repo('duscraft', 'garry', { topics: ['rust', 'game'] }),
  repo('alaborderie', 'keyroll', { private: true }),
  repo('alaborderie', 'sfg-bot', { language: 'TypeScript' }),
  repo('alaborderie', 'old-thing', { archived: true }),
  repo('alaborderie', 'swagger-codegen', { fork: true }),
  repo('alaborderie', '.github'),
];

const workload = (w: Partial<Workload> & Pick<Workload, 'name'>): Workload => ({
  kind: 'Deployment',
  namespace: 'default',
  images: [`ghcr.io/alaborderie/${w.name}:latest`],
  labels: {},
  podLabels: { app: w.name },
  envValues: [],
  replicas: { desired: 1, ready: 1 },
  ownedByCronJob: false,
  ...w,
});
const bitnami = (name: string, instance: string, image: string) =>
  workload({
    name,
    kind: 'StatefulSet',
    images: [image],
    labels: { 'app.kubernetes.io/instance': instance },
    podLabels: {
      'app.kubernetes.io/instance': instance,
      'app.kubernetes.io/component': name.split('-').pop()!,
    },
  });

const snapshot: ClusterSnapshot = {
  namespaces: [
    'default',
    'headlamp',
    'kube-system',
    'kube-public',
    'kube-node-lease',
    'cloud-agents',
  ],
  workloads: [
    workload({
      name: 'garry-api',
      images: ['ghcr.io/duscraft/garry-api:latest'],
    }),
    workload({
      name: 'garry-web',
      images: ['ghcr.io/duscraft/garry-web:latest'],
    }),
    workload({ name: 'keyroll' }),
    workload({ name: 'sfg-bot' }),
    workload({
      name: 'opencode-web',
      images: ['ghcr.io/anomalyco/opencode:latest'],
    }),
    workload({ name: 'backstage', envValues: ['backstage-postgres'] }),
    workload({ name: 'backstage-postgres', images: ['postgres:17-alpine'] }),
    bitnami('garry-redis-master', 'garry-redis', 'bitnami/redis:latest'),
    bitnami('garry-redis-replicas', 'garry-redis', 'bitnami/redis:latest'),
    bitnami(
      'garry-postgres-postgresql',
      'garry-postgres',
      'bitnami/postgresql:latest',
    ),
    workload({
      name: 'placette-postgres-backup',
      kind: 'CronJob',
      images: ['rclone/rclone:1.75.2'],
      schedule: '0 3 * * *',
    }),
    workload({
      name: 'placette-postgres-backup-29897415',
      kind: 'Job',
      images: ['rclone/rclone:1.75.2'],
      ownedByCronJob: true,
    }),
    workload({
      name: 'migrate',
      kind: 'Job',
      images: ['ghcr.io/alaborderie/keyroll:latest'],
    }),
    workload({
      name: 'headlamp',
      namespace: 'headlamp',
      images: ['ghcr.io/headlamp-k8s/headlamp:v0.46.0'],
    }),
    workload({
      name: 'traefik',
      namespace: 'kube-system',
      images: ['traefik:3'],
    }),
    workload({ name: 'run-1', namespace: 'cloud-agents', kind: 'Job' }),
  ],
  services: [
    {
      namespace: 'default',
      name: 'garry-api-service',
      selector: { app: 'garry-api' },
    },
    {
      namespace: 'default',
      name: 'garry-web-service',
      selector: { app: 'garry-web' },
    },
    { namespace: 'default', name: 'keyroll', selector: { app: 'keyroll' } },
    { namespace: 'default', name: 'backstage', selector: { app: 'backstage' } },
    {
      namespace: 'default',
      name: 'backstage-postgres',
      selector: { app: 'backstage-postgres' },
    },
    {
      namespace: 'default',
      name: 'opencode-web-service',
      selector: { app: 'opencode-web' },
    },
    {
      namespace: 'default',
      name: 'garry-redis-master',
      selector: {
        'app.kubernetes.io/instance': 'garry-redis',
        'app.kubernetes.io/component': 'master',
      },
    },
    { namespace: 'default', name: 'kubernetes', selector: {} },
    { namespace: 'headlamp', name: 'headlamp', selector: { app: 'headlamp' } },
  ],
  ingressRoutes: [
    {
      namespace: 'default',
      name: 'garry-api-route',
      hosts: ['garry-api.antoinelaborderie.com'],
      services: [{ namespace: 'default', name: 'garry-api-service' }],
    },
    {
      namespace: 'default',
      name: 'garry-web-route',
      hosts: ['garry-app.antoinelaborderie.com'],
      services: [{ namespace: 'default', name: 'garry-web-service' }],
    },
    {
      namespace: 'default',
      name: 'keyroll-ingressroute',
      hosts: ['keyroll.antoinelaborderie.com'],
      services: [{ namespace: 'default', name: 'keyroll' }],
    },
    {
      namespace: 'default',
      name: 'headlamp-route',
      hosts: ['headlamp.antoinelaborderie.com'],
      services: [{ namespace: 'headlamp', name: 'headlamp' }],
    },
    {
      namespace: 'default',
      name: 'hvisla-api-route',
      hosts: ['api.hvisla.com'],
      services: [{ namespace: 'default', name: 'hvisla-api-service' }],
    },
    {
      namespace: 'kube-system',
      name: 'traefik-dashboard',
      hosts: ['traefik.antoinelaborderie.com'],
      services: [],
    },
  ],
};

const cluster = buildClusterEntities(snapshot, repositories, settings);
const byRef = new Map(cluster.map(e => [stringifyEntityRef(e), e]));
const get = (ref: string) => {
  const entity = byRef.get(ref);
  if (!entity)
    throw new Error(`missing ${ref}; have ${[...byRef.keys()].join(', ')}`);
  return entity;
};
const spec = (ref: string) => get(ref).spec as Record<string, unknown>;

const policy = EntityPolicies.allOf([
  new DefaultNamespaceEntityPolicy(),
  new NoForeignRootFieldsEntityPolicy(),
  new FieldFormatEntityPolicy(),
  new SchemaValidEntityPolicy(),
]);

async function expectValid(entities: Entity[]) {
  for (const entity of entities) {
    await expect(policy.enforce(entity)).resolves.toBeDefined();
    const validator =
      entity.kind === 'Component'
        ? componentEntityV1alpha1Validator
        : resourceEntityV1alpha1Validator;
    await expect(validator.check(entity)).resolves.toBe(true);
  }
}

describe('buildClusterEntities', () => {
  it('emits entities the catalog accepts, with unique refs', async () => {
    await expectValid(cluster);
    expect(byRef.size).toBe(cluster.length);
  });

  it('lists namespaces, hiding kube-public and kube-node-lease', () => {
    const namespaces = cluster
      .filter(e => e.spec?.type === 'namespace')
      .map(e => e.metadata.title);
    expect(namespaces.sort()).toEqual([
      'cloud-agents',
      'default',
      'headlamp',
      'kube-system',
    ]);
  });

  it('skips system and ephemeral workloads and CronJob runs', () => {
    const titles = cluster.map(e => e.metadata.title);
    expect(titles).not.toContain('traefik');
    expect(titles).not.toContain('run-1');
    expect(titles).not.toContain('traefik-dashboard');
    expect(titles).not.toContain('placette-postgres-backup-29897415');
    expect(spec('component:default/migrate').type).toBe('job');
    expect(spec('component:default/placette-postgres-backup').type).toBe(
      'cronjob',
    );
  });

  it('types components from the classification table and config overrides', () => {
    expect(spec('component:default/garry-api').type).toBe('api');
    expect(spec('component:default/garry-web').type).toBe('frontend');
    expect(spec('component:default/sfg-bot').type).toBe('bot');
    expect(spec('component:default/keyroll').type).toBe('service');
    expect(spec('component:default/opencode-web').type).toBe('frontend');
  });

  it('links deployed components to their repository', () => {
    const garry = get('component:default/garry-api');
    expect(garry.metadata.annotations?.['github.com/project-slug']).toBe(
      'duscraft/garry',
    );
    expect(spec('component:default/garry-api')).toMatchObject({
      subcomponentOf: 'component:duscraft/garry',
      owner: 'group:default/duscraft',
    });
    expect(spec('component:default/keyroll').subcomponentOf).toBe(
      'component:alaborderie/keyroll',
    );
    expect(spec('component:default/opencode-web').subcomponentOf).toBe(
      'component:alaborderie/opencode',
    );
    expect(spec('component:headlamp/headlamp').subcomponentOf).toBeUndefined();
    expect(spec('component:headlamp/headlamp').owner).toBe(
      'user:default/alaborderie',
    );
  });

  it('folds Bitnami master and replicas into one database', () => {
    const databases = cluster
      .filter(e => e.spec?.type === 'database')
      .map(e => stringifyEntityRef(e));
    expect(databases.sort()).toEqual([
      'resource:default/backstage-postgres',
      'resource:default/garry-postgres',
      'resource:default/garry-redis',
    ]);
  });

  it('relates components to their databases and namespace', () => {
    expect(spec('component:default/garry-api').dependsOn).toEqual(
      expect.arrayContaining([
        'resource:default/default',
        'resource:default/garry-redis',
        'resource:default/garry-postgres',
      ]),
    );
    expect(spec('component:default/backstage').dependsOn).toContain(
      'resource:default/backstage-postgres',
    );
    expect(spec('component:default/keyroll').dependsOn).toEqual([
      'resource:default/default',
    ]);
    expect(spec('resource:default/garry-redis').dependsOn).toEqual([
      'resource:default/default',
    ]);
  });

  it('makes ingress routes a dependency of the components behind their Services', () => {
    expect(spec('resource:default/garry-api-route')).toMatchObject({
      type: 'ingress-route',
      dependencyOf: ['component:default/garry-api'],
      dependsOn: ['resource:default/default'],
    });
    expect(spec('resource:default/headlamp-route').dependencyOf).toEqual([
      'component:headlamp/headlamp',
    ]);
    expect(spec('resource:default/hvisla-api-route').dependencyOf).toEqual([]);
    expect(get('component:default/garry-api').metadata.links).toEqual([
      {
        url: 'https://garry-api.antoinelaborderie.com',
        title: 'garry-api.antoinelaborderie.com',
        icon: 'web',
      },
    ]);
  });

  it('points the Kubernetes tab at the pods', () => {
    expect(
      get('component:default/garry-api').metadata.annotations,
    ).toMatchObject({
      'backstage.io/kubernetes-namespace': 'default',
      'backstage.io/kubernetes-label-selector': 'app=garry-api',
    });
  });

  it('is stable across refreshes and input order', () => {
    const shuffled: ClusterSnapshot = {
      namespaces: [...snapshot.namespaces].reverse(),
      workloads: [...snapshot.workloads].reverse(),
      services: [...snapshot.services].reverse(),
      ingressRoutes: [...snapshot.ingressRoutes].reverse(),
    };
    const again = buildClusterEntities(
      shuffled,
      [...repositories].reverse(),
      settings,
    );
    const refs = (es: Entity[]) => es.map(e => stringifyEntityRef(e)).sort();
    expect(refs(again)).toEqual(refs(cluster));
  });

  it('keeps refs unique when a Deployment and a CronJob share a name', async () => {
    const entities = buildClusterEntities(
      {
        namespaces: ['default'],
        services: [],
        ingressRoutes: [],
        workloads: [
          workload({ name: 'report', kind: 'CronJob', schedule: '@daily' }),
          workload({ name: 'report' }),
        ],
      },
      [],
      settings,
    );
    await expectValid(entities);
    const components = entities.filter(e => e.kind === 'Component');
    expect(components.map(e => getCompoundEntityRef(e).name).sort()).toEqual([
      'report',
      'report-cronjob',
    ]);
  });
});

describe('buildRepositoryEntities', () => {
  const entities = buildRepositoryEntities(repositories, settings);
  const repoEntity = (ref: string) =>
    entities.find(e => stringifyEntityRef(e) === ref)!;

  it('emits valid repository components namespaced by owner', async () => {
    await expectValid(entities);
    expect(entities.map(e => stringifyEntityRef(e)).sort()).toEqual([
      'component:alaborderie/github',
      'component:alaborderie/keyroll',
      'component:alaborderie/old-thing',
      'component:alaborderie/sfg-bot',
      'component:alaborderie/swagger-codegen',
      'component:duscraft/garry',
    ]);
  });

  it('carries owner, slug, source and GitHub link', () => {
    const garry = repoEntity('component:duscraft/garry');
    expect(garry.spec).toEqual({
      type: 'repository',
      lifecycle: 'production',
      owner: 'group:default/duscraft',
    });
    expect(garry.metadata.annotations).toMatchObject({
      'github.com/project-slug': 'duscraft/garry',
      'backstage.io/source-location':
        'url:https://github.com/duscraft/garry/tree/main/',
    });
    expect(garry.metadata.links).toEqual([
      {
        url: 'https://github.com/duscraft/garry',
        title: 'GitHub',
        icon: 'github',
      },
    ]);
    expect(garry.metadata.tags).toEqual(['rust', 'game']);
  });

  it('marks archived repos deprecated and forks with a tag', () => {
    expect(repoEntity('component:alaborderie/old-thing').spec?.lifecycle).toBe(
      'deprecated',
    );
    expect(
      repoEntity('component:alaborderie/swagger-codegen').metadata.tags,
    ).toContain('fork');
    expect(repoEntity('component:alaborderie/keyroll').metadata.tags).toContain(
      'private',
    );
    expect(repoEntity('component:alaborderie/keyroll').spec?.owner).toBe(
      'user:default/alaborderie',
    );
  });
});

describe('toEntityName', () => {
  it.each([
    ['garry-api', 'garry-api'],
    ['.github', 'github'],
    ['a--b', 'a-b'],
    ['MineDodger', 'MineDodger'],
  ])('%s → %s', (raw, name) => {
    expect(toEntityName(raw)).toBe(name);
  });

  it('shortens long names deterministically', () => {
    const name = toEntityName('x'.repeat(80));
    expect(name).toHaveLength(63);
    expect(toEntityName('x'.repeat(80))).toBe(name);
  });
});
