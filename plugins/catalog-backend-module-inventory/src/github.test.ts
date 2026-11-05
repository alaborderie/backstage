import type {
  GithubCredentials,
  GithubCredentialsProvider,
} from '@backstage/integration';
import { readRepositories, type GithubRepositories } from './github';
import type { Repository } from './model';

const repo = (owner: string, name: string, isPrivate = false): Repository => ({
  owner,
  name,
  url: `https://github.com/${owner}/${name}`,
  defaultBranch: 'main',
  archived: false,
  fork: false,
  private: isPrivate,
  topics: [],
});

const publicRepos: Record<string, Repository[]> = {
  alaborderie: [repo('alaborderie', 'sfg-bot')],
  duscraft: ['garry', 'tanzia', 'vivematcher', 'duscraft-landing'].map(n =>
    repo('duscraft', n),
  ),
};
const installationRepos: Record<string, Repository[]> = {
  'alaborderie-token': [
    repo('alaborderie', 'keyroll', true),
    repo('alaborderie', 'sfg-bot'),
  ],
  'duscraft-token': [
    repo('duscraft', 'pensee', true),
    repo('duscraft', 'garry'),
  ],
};

function fakeGithub() {
  const publicCalls: Array<[string, string | undefined]> = [];
  const github: GithubRepositories = {
    listInstallationRepositories: async token => installationRepos[token] ?? [],
    listPublicRepositories: async (owner, token) => {
      publicCalls.push([owner, token]);
      return publicRepos[owner] ?? [];
    },
  };
  return { github, publicCalls };
}

function credentialsFor(installed: string[]): GithubCredentialsProvider {
  return {
    async getCredentials({ url }): Promise<GithubCredentials> {
      const owner = url.split('/').pop()!;
      return installed.includes(owner)
        ? { type: 'app', token: `${owner}-token`, headers: {} }
        : { type: 'token' };
    },
  };
}

const slugs = (repos: Repository[]) =>
  repos.map(r => `${r.owner}/${r.name}`).sort();

describe('readRepositories', () => {
  it('lists private repos of an installed owner and public repos of the others', async () => {
    const { github, publicCalls } = fakeGithub();
    const read = await readRepositories({
      owners: ['alaborderie', 'duscraft'],
      credentials: credentialsFor(['alaborderie']),
      github,
    });
    expect(slugs(read.repositories)).toEqual([
      'alaborderie/keyroll',
      'alaborderie/sfg-bot',
      'duscraft/duscraft-landing',
      'duscraft/garry',
      'duscraft/tanzia',
      'duscraft/vivematcher',
    ]);
    expect(read.ownersWithoutInstallation).toEqual(['duscraft']);
    expect(publicCalls).toContainEqual(['duscraft', 'alaborderie-token']);
  });

  it('picks up private repos once the App is installed on the owner', async () => {
    const read = await readRepositories({
      owners: ['alaborderie', 'duscraft'],
      credentials: credentialsFor(['alaborderie', 'duscraft']),
      github: fakeGithub().github,
    });
    expect(slugs(read.repositories)).toContain('duscraft/pensee');
    expect(read.ownersWithoutInstallation).toEqual([]);
  });

  it('falls back to unauthenticated public listing without any App', async () => {
    const { github, publicCalls } = fakeGithub();
    const read = await readRepositories({
      owners: ['alaborderie', 'duscraft'],
      credentials: credentialsFor([]),
      github,
    });
    expect(slugs(read.repositories)).not.toContain('alaborderie/keyroll');
    expect(read.ownersWithoutInstallation).toEqual(['alaborderie', 'duscraft']);
    expect(publicCalls).toEqual([
      ['alaborderie', undefined],
      ['duscraft', undefined],
    ]);
  });

  it('drops repositories of owners it was not asked about', async () => {
    const github: GithubRepositories = {
      listInstallationRepositories: async () => [repo('someone', 'else')],
      listPublicRepositories: async () => [],
    };
    const read = await readRepositories({
      owners: ['alaborderie'],
      credentials: credentialsFor(['alaborderie']),
      github,
    });
    expect(read.repositories).toEqual([]);
  });
});
