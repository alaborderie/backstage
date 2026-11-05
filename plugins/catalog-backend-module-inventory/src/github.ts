import type { GithubCredentialsProvider } from '@backstage/integration';
import { Octokit } from '@octokit/rest';
import type { Repository } from './model';

export interface GithubRepositories {
  /** Every repository an App installation token can read, private included. */
  listInstallationRepositories(token: string): Promise<Repository[]>;
  listPublicRepositories(owner: string, token?: string): Promise<Repository[]>;
}

interface GithubRepoPayload {
  name: string;
  owner: { login: string } | null;
  description?: string | null;
  html_url: string;
  default_branch?: string;
  archived?: boolean;
  fork: boolean;
  private: boolean;
  topics?: string[];
  homepage?: string | null;
  language?: string | null;
}

function toRepository(r: GithubRepoPayload): Repository {
  return {
    owner: r.owner?.login ?? '',
    name: r.name,
    url: r.html_url,
    defaultBranch: r.default_branch ?? 'main',
    archived: r.archived ?? false,
    fork: r.fork,
    private: r.private,
    topics: r.topics ?? [],
    ...(r.description ? { description: r.description } : {}),
    ...(r.homepage ? { homepage: r.homepage } : {}),
    ...(r.language ? { language: r.language } : {}),
  };
}

export function octokitRepositories(): GithubRepositories {
  return {
    async listInstallationRepositories(token) {
      const octokit = new Octokit({ auth: token });
      const repos = await octokit.paginate('GET /installation/repositories', {
        per_page: 100,
      });
      return repos.map(toRepository);
    },
    async listPublicRepositories(owner, token) {
      const octokit = new Octokit(token ? { auth: token } : {});
      const repos = await octokit.paginate('GET /users/{username}/repos', {
        username: owner,
        type: 'owner',
        per_page: 100,
      });
      return repos.map(toRepository);
    },
  };
}

export interface RepositoryRead {
  repositories: Repository[];
  /** Owners the GitHub App is not installed on; only public repos listed. */
  ownersWithoutInstallation: string[];
}

export async function readRepositories(options: {
  owners: string[];
  credentials: GithubCredentialsProvider;
  github: GithubRepositories;
}): Promise<RepositoryRead> {
  const { owners, credentials, github } = options;
  const resolved = await Promise.all(
    owners.map(async owner => ({
      owner,
      ...(await credentials.getCredentials({
        url: `https://github.com/${owner}`,
      })),
    })),
  );
  const installed = (c: (typeof resolved)[number]) =>
    c.type === 'app' && Boolean(c.token);
  const fallbackToken =
    resolved.find(installed)?.token ?? resolved.find(c => c.token)?.token;

  const lists = await Promise.all(
    resolved.map(async c => {
      if (!installed(c)) {
        return github.listPublicRepositories(c.owner, c.token ?? fallbackToken);
      }
      const [all, open] = await Promise.all([
        github.listInstallationRepositories(c.token!),
        github.listPublicRepositories(c.owner, c.token),
      ]);
      return [...all, ...open];
    }),
  );

  const byOwner = new Set(owners.map(o => o.toLowerCase()));
  const unique = new Map<string, Repository>();
  for (const repo of lists.flat()) {
    if (!byOwner.has(repo.owner.toLowerCase())) continue;
    unique.set(`${repo.owner}/${repo.name}`.toLowerCase(), repo);
  }
  return {
    repositories: [...unique.values()],
    ownersWithoutInstallation: resolved
      .filter(c => !installed(c))
      .map(c => c.owner),
  };
}
