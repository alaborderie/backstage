import type {
  ComponentType,
  DatabaseEngine,
  Labels,
  Repository,
  WorkloadKind,
} from './model';

export interface WorkloadFacts {
  kind: WorkloadKind;
  name: string;
  images: string[];
  hasService: boolean;
  routed: boolean;
}

export type Classification =
  | { kind: 'Component'; type: ComponentType }
  | { kind: 'Resource'; type: 'database'; engine: DatabaseEngine };

const DATABASE_IMAGES: Readonly<Record<string, DatabaseEngine>> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  redis: 'redis',
  valkey: 'redis',
  mysql: 'mysql',
  mariadb: 'mysql',
  mongo: 'mongodb',
  mongodb: 'mongodb',
};

const API_WORDS = ['api', 'backend', 'auth', 'server', 'router', 'gateway'];
const FRONTEND_WORDS = [
  'web',
  'frontend',
  'landing',
  'website',
  'www',
  'app',
  'ui',
  'dashboard',
  'site',
];

type Rule = readonly [
  ComponentType,
  (facts: WorkloadFacts, words: ReadonlySet<string>) => boolean,
];

/** First matching row wins; the last row always matches. */
const COMPONENT_RULES: readonly Rule[] = [
  ['cronjob', f => f.kind === 'CronJob'],
  ['job', f => f.kind === 'Job'],
  ['bot', (_, w) => w.has('bot')],
  ['api', (f, w) => f.hasService && API_WORDS.some(x => w.has(x))],
  ['frontend', (f, w) => f.routed && FRONTEND_WORDS.some(x => w.has(x))],
  ['worker', f => !f.hasService],
  ['service', () => true],
];

/** `ghcr.io/duscraft/garry-api:latest` → `garry-api`. */
export function imageName(image: string): string {
  const path = image.split('@')[0]!;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.split(':')[0]!;
}

export function databaseEngine(image: string): DatabaseEngine | undefined {
  return DATABASE_IMAGES[imageName(image).toLowerCase()];
}

function words(facts: WorkloadFacts): Set<string> {
  return new Set(
    [facts.name, ...facts.images.map(imageName)].flatMap(s =>
      s.toLowerCase().split(/[-_.]/),
    ),
  );
}

export function classifyWorkload(
  facts: WorkloadFacts,
  override?: ComponentType,
): Classification {
  if (override) return { kind: 'Component', type: override };
  if (facts.kind === 'Deployment' || facts.kind === 'StatefulSet') {
    const engine = facts.images.map(databaseEngine).find(Boolean);
    if (engine) return { kind: 'Resource', type: 'database', engine };
  }
  const w = words(facts);
  const [type] = COMPONENT_RULES.find(([, matches]) => matches(facts, w))!;
  return { kind: 'Component', type };
}

/**
 * Workloads that form one database share a key: the Helm release for Bitnami
 * charts (garry-redis-master and garry-redis-replicas → garry-redis), else the
 * workload name.
 */
export function databaseKey(workload: { name: string; labels: Labels }) {
  return workload.labels['app.kubernetes.io/instance'] ?? workload.name;
}

const DATABASE_SUFFIX =
  /-(postgresql|postgres|pg|redis|valkey|mysql|mariadb|mongodb|mongo|db|database)$/;

/** `garry-postgres` → `garry`; the prefix its applications share. */
export function databaseApplication(key: string): string {
  const stripped = key.replace(DATABASE_SUFFIX, '');
  return stripped === key ? key : databaseApplication(stripped);
}

export function usesDatabase(
  workload: { name: string; envValues: string[] },
  database: { key: string; serviceNames: string[] },
): boolean {
  const app = databaseApplication(database.key);
  if (workload.name === app || workload.name.startsWith(`${app}-`)) {
    return true;
  }
  return database.serviceNames.some(service => {
    const host = new RegExp(`(^|[/@])${escapeRegExp(service)}($|[.:/])`);
    return workload.envValues.some(value => host.test(value));
  });
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type RepositoryIndex = ReadonlyMap<string, Repository>;

export function indexRepositories(repos: Repository[]): RepositoryIndex {
  return new Map(
    repos.map(r => [`${r.owner}/${r.name}`.toLowerCase(), r] as const),
  );
}

/**
 * Maps `ghcr.io/<owner>/<image>` to a repository of that same owner, trying
 * the full image name, then dropping trailing `-segments`:
 * `matrixqc-web` → `matrixqc-web`, then `matrixqc`.
 */
export function repositoryForImages(
  images: string[],
  index: RepositoryIndex,
): Repository | undefined {
  for (const image of images) {
    const [registry, owner, first] = image.split('@')[0]!.split('/');
    if (registry !== 'ghcr.io' || !owner || !first) continue;
    const segments = first.split(':')[0]!.split('-');
    for (let n = segments.length; n > 0; n--) {
      const candidate = `${owner}/${segments.slice(0, n).join('-')}`;
      const repo = index.get(candidate.toLowerCase());
      if (repo) return repo;
    }
  }
  return undefined;
}
