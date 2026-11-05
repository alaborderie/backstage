import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import {
  DefaultGithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import {
  catalogProcessingExtensionPoint,
  type EntityProvider,
  type EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { defaultClusterReader } from './cluster';
import { buildClusterEntities, buildRepositoryEntities } from './entities';
import { octokitRepositories, readRepositories } from './github';
import type { Repository } from './model';
import { readSettings } from './settings';

/**
 * Each provider replaces its whole entity set, and only after a successful
 * read, so a failed read leaves the last good entities in the catalog.
 */
class SnapshotProvider implements EntityProvider {
  #connect!: (connection: EntityProviderConnection) => void;
  readonly #connection = new Promise<EntityProviderConnection>(resolve => {
    this.#connect = resolve;
  });

  constructor(private readonly name: string) {}

  getProviderName() {
    return this.name;
  }

  async connect(connection: EntityProviderConnection) {
    this.#connect(connection);
  }

  async replace(entities: Entity[]) {
    const connection = await this.#connection;
    await connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({ entity, locationKey: this.name })),
    });
  }
}

export const catalogModuleInventory = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'inventory',
  register(reg) {
    reg.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        const { settings, schedule } = readSettings(config);
        const credentials = DefaultGithubCredentialsProvider.fromIntegrations(
          ScmIntegrations.fromConfig(config),
        );
        const github = octokitRepositories();
        const readCluster = defaultClusterReader();
        const warnedOwners = new Set<string>();
        let repositories: Repository[] | undefined;
        const githubProvider = new SnapshotProvider('inventory-github');
        const clusterProvider = new SnapshotProvider('inventory-k3s');
        catalog.addEntityProvider(githubProvider, clusterProvider);

        const refresh = async () => {
          try {
            const read = await readRepositories({
              owners: settings.owners.map(o => o.login),
              credentials,
              github,
            });
            for (const owner of read.ownersWithoutInstallation) {
              if (warnedOwners.has(owner)) continue;
              warnedOwners.add(owner);
              logger.warn(
                `No GitHub App installation found for ${owner}; listing its public repositories only. Install the App on ${owner} to include its private repositories.`,
              );
            }
            await githubProvider.replace(
              buildRepositoryEntities(read.repositories, settings),
            );
            repositories = read.repositories;
            logger.info(
              `Inventory: ${read.repositories.length} GitHub repositories`,
            );
          } catch (error) {
            logger.warn(
              'Inventory: GitHub read failed; keeping the last repository entities',
              error as Error,
            );
          }
          if (!repositories) {
            logger.warn(
              'Inventory: no repository list yet; keeping the last cluster entities',
            );
            return;
          }
          try {
            const entities = buildClusterEntities(
              await readCluster(),
              repositories,
              settings,
            );
            await clusterProvider.replace(entities);
            logger.info(`Inventory: ${entities.length} cluster entities`);
          } catch (error) {
            logger.warn(
              'Inventory: cluster read failed; keeping the last cluster entities',
              error as Error,
            );
          }
        };

        await scheduler.scheduleTask({
          id: 'catalog-inventory-refresh',
          ...schedule,
          fn: refresh,
        });
      },
    });
  },
});
