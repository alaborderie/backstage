import {
  classifyWorkload,
  databaseApplication,
  indexRepositories,
  repositoryForImages,
  usesDatabase,
  type WorkloadFacts,
} from './classify';
import type { Repository } from './model';

const deployment = (
  name: string,
  image: string,
  exposure: Partial<Pick<WorkloadFacts, 'hasService' | 'routed'>> = {},
): WorkloadFacts => ({
  kind: 'Deployment',
  name,
  images: [image],
  hasService: false,
  routed: false,
  ...exposure,
});
const routed = { hasService: true, routed: true };

describe('classifyWorkload', () => {
  it.each<[string, WorkloadFacts, string]>([
    [
      'garry-api',
      deployment('garry-api', 'ghcr.io/duscraft/garry-api:latest', routed),
      'api',
    ],
    [
      'tanzia-api behind a Service only',
      deployment('tanzia-api', 'x/tanzia-api', { hasService: true }),
      'api',
    ],
    [
      'garry-web',
      deployment('garry-web', 'ghcr.io/duscraft/garry-web:latest', routed),
      'frontend',
    ],
    [
      'matrixqc by image',
      deployment('matrixqc', 'ghcr.io/alaborderie/matrixqc-web:latest', routed),
      'frontend',
    ],
    [
      'sfg-bot',
      deployment('sfg-bot', 'ghcr.io/alaborderie/sfg-bot:latest', {
        hasService: true,
      }),
      'bot',
    ],
    [
      'dragonwilds with no Service',
      deployment('dragonwilds', 'cm2network/steamcmd@sha256:45f6', {}),
      'worker',
    ],
    [
      'keyroll',
      deployment('keyroll', 'ghcr.io/alaborderie/keyroll:latest', routed),
      'service',
    ],
    [
      'an unrouted web',
      deployment('docs-web', 'x/docs-web', { hasService: true }),
      'service',
    ],
    [
      'pensee-transcriber',
      deployment('pensee-transcriber', 'ghcr.io/duscraft/pensee-transcriber', {
        hasService: true,
      }),
      'service',
    ],
  ])('%s', (_, facts, type) => {
    expect(classifyWorkload(facts)).toEqual({ kind: 'Component', type });
  });

  it('types CronJobs and Jobs by kind, whatever their name', () => {
    const backup = {
      ...deployment('placette-postgres-backup', 'rclone/rclone:1.75.2'),
      kind: 'CronJob' as const,
    };
    expect(classifyWorkload(backup)).toEqual({
      kind: 'Component',
      type: 'cronjob',
    });
    expect(classifyWorkload({ ...backup, kind: 'Job' })).toEqual({
      kind: 'Component',
      type: 'job',
    });
  });

  it.each([
    ['postgres:17-alpine', 'postgres'],
    ['registry-1.docker.io/bitnami/postgresql:latest', 'postgres'],
    ['registry-1.docker.io/bitnami/redis:latest', 'redis'],
  ])('makes %s a %s database', (image, engine) => {
    expect(
      classifyWorkload(deployment('db', image, { hasService: true })),
    ).toEqual({
      kind: 'Resource',
      type: 'database',
      engine,
    });
  });

  it('does not take a CronJob running a database image for a database', () => {
    const dump = {
      ...deployment('dump', 'postgres:17'),
      kind: 'CronJob' as const,
    };
    expect(classifyWorkload(dump)).toEqual({
      kind: 'Component',
      type: 'cronjob',
    });
  });

  it('lets a config override win', () => {
    expect(
      classifyWorkload(deployment('keyroll', 'x/keyroll', routed), 'frontend'),
    ).toEqual({ kind: 'Component', type: 'frontend' });
  });
});

describe('databases', () => {
  it.each([
    ['garry-postgres', 'garry'],
    ['backstage-postgres', 'backstage'],
    ['sfg-bot-postgresql', 'sfg-bot'],
    ['garry-redis', 'garry'],
    ['postgres', 'postgres'],
  ])('%s belongs to %s', (key, app) => {
    expect(databaseApplication(key)).toBe(app);
  });

  const garryPostgres = {
    key: 'garry-postgres',
    serviceNames: ['garry-postgres-postgresql'],
  };

  it('links workloads by name prefix', () => {
    expect(
      usesDatabase({ name: 'garry-api', envValues: [] }, garryPostgres),
    ).toBe(true);
    expect(usesDatabase({ name: 'garryx', envValues: [] }, garryPostgres)).toBe(
      false,
    );
  });

  it('links workloads whose env names the database Service', () => {
    const db = {
      key: 'coc-prep-postgres',
      serviceNames: ['coc-prep-postgres'],
    };
    for (const value of [
      'coc-prep-postgres',
      'coc-prep-postgres.default.svc.cluster.local',
      'postgres://u@coc-prep-postgres:5432/db',
    ]) {
      expect(
        usesDatabase({ name: 'f-0902-coc-prep-fr', envValues: [value] }, db),
      ).toBe(true);
    }
    expect(
      usesDatabase(
        { name: 'f-0902-coc-prep-fr', envValues: ['coc-prep-postgres-old'] },
        db,
      ),
    ).toBe(false);
  });
});

describe('repositoryForImages', () => {
  const repo = (owner: string, name: string): Repository => ({
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
    defaultBranch: 'main',
    archived: false,
    fork: false,
    private: false,
    topics: [],
  });
  const index = indexRepositories([
    repo('duscraft', 'garry'),
    repo('alaborderie', 'matrixqc'),
    repo('alaborderie', 'sfg-bot'),
    repo('alaborderie', 'keyroll'),
    repo('duscraft', 'tanzia-front'),
  ]);
  const map = (...images: string[]) => {
    const found = repositoryForImages(images, index);
    return found && `${found.owner}/${found.name}`;
  };

  it('drops trailing segments until a repository of the owner matches', () => {
    expect(map('ghcr.io/duscraft/garry-api:latest')).toBe('duscraft/garry');
    expect(map('ghcr.io/alaborderie/matrixqc-web:latest')).toBe(
      'alaborderie/matrixqc',
    );
  });

  it('prefers the full image name', () => {
    expect(map('ghcr.io/alaborderie/sfg-bot:latest')).toBe(
      'alaborderie/sfg-bot',
    );
    expect(map('ghcr.io/duscraft/tanzia-front')).toBe('duscraft/tanzia-front');
  });

  it('reads tags and digests', () => {
    expect(map('ghcr.io/alaborderie/keyroll:sha-72@sha256:142e')).toBe(
      'alaborderie/keyroll',
    );
  });

  it('never guesses across owners or registries', () => {
    expect(map('ghcr.io/duscraft/keyroll:latest')).toBeUndefined();
    expect(map('docker.io/alaborderie/keyroll')).toBeUndefined();
    expect(map('ghcr.io/anomalyco/opencode:latest')).toBeUndefined();
  });

  it('tries every container image', () => {
    expect(map('rclone/rclone:1', 'ghcr.io/duscraft/garry-worker')).toBe(
      'duscraft/garry',
    );
  });
});
