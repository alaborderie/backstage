import { NotAllowedError } from '@backstage/errors';
import { AuthResolverContext } from '@backstage/plugin-auth-node';
import { githubSignInResolver } from './github';

function identity(username?: string) {
  return {
    profile: { email: 'alaborderie@example.com', displayName: 'alaborderie' },
    result: {
      fullProfile: {
        id: '123',
        provider: 'github',
        displayName: 'alaborderie',
        username,
      },
      session: { accessToken: 'test', tokenType: 'bearer', scope: '' },
    },
  };
}

describe('GitHub sign-in allowlist', () => {
  const ctx: AuthResolverContext = {
    signInWithCatalogUser: jest
      .fn()
      .mockResolvedValue({ token: 'owner-token' }),
    issueToken: jest.fn(),
    findCatalogUser: jest.fn(),
    resolveOwnershipEntityRefs: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it.each(['someone-else', '', undefined])(
    'rejects a non-owner login %s even with an owner-like display name and email',
    async username => {
      await expect(
        githubSignInResolver(identity(username), ctx),
      ).rejects.toThrow(NotAllowedError);
      expect(ctx.signInWithCatalogUser).not.toHaveBeenCalled();
      expect(ctx.issueToken).not.toHaveBeenCalled();
    },
  );

  it.each(['alaborderie', 'ALaborderie'])(
    'signs in the owner %s through the catalog',
    async username => {
      await expect(
        githubSignInResolver(identity(username), ctx),
      ).resolves.toEqual({ token: 'owner-token' });
      expect(ctx.signInWithCatalogUser).toHaveBeenCalledWith({
        entityRef: 'user:default/alaborderie',
      });
    },
  );
});
