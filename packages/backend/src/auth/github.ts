import { createBackendModule } from '@backstage/backend-plugin-api';
import { NotAllowedError } from '@backstage/errors';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
  SignInResolver,
  OAuthAuthenticatorResult,
} from '@backstage/plugin-auth-node';
import {
  githubAuthenticator,
  GithubProfile,
} from '@backstage/plugin-auth-backend-module-github-provider';

export const githubSignInResolver: SignInResolver<
  OAuthAuthenticatorResult<GithubProfile>
> = async (info, ctx) => {
  if (info.result.fullProfile.username?.toLowerCase() !== 'alaborderie') {
    throw new NotAllowedError('Only alaborderie may sign in');
  }
  return ctx.signInWithCatalogUser({ entityRef: 'user:default/alaborderie' });
};

export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'github-owner-sign-in',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'github',
          factory: createOAuthProviderFactory({
            authenticator: githubAuthenticator,
            signInResolver: githubSignInResolver,
          }),
        });
      },
    });
  },
});
