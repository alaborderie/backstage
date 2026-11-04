import { createApp } from '@backstage/frontend-defaults';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import {
  configApiRef,
  githubAuthApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { SignInPage } from '@backstage/core-components';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import cloudAgentsPlugin from '@alaborderie/plugin-cloud-agents';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';

const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => props => {
      const config = useApi(configApiRef);
      return (
        <SignInPage
          {...props}
          auto
          providers={[
            ...(config.has('auth.providers.guest') ? ['guest' as const] : []),
            {
              id: 'github-auth-provider',
              title: 'GitHub',
              message: 'Sign in with GitHub',
              apiRef: githubAuthApiRef,
            },
          ]}
        />
      );
    },
  },
});

export default createApp({
  features: [
    catalogPlugin,
    cloudAgentsPlugin,
    navModule,
    homeModule,
    createFrontendModule({ pluginId: 'app', extensions: [signInPage] }),
  ],
});
