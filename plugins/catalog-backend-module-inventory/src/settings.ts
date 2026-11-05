import {
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
  type SchedulerServiceTaskScheduleDefinition,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import {
  COMPONENT_TYPES,
  type ComponentType,
  type InventorySettings,
  type WorkloadOverride,
} from './model';

const DEFAULT_SCHEDULE: SchedulerServiceTaskScheduleDefinition = {
  frequency: { minutes: 15 },
  timeout: { minutes: 5 },
  initialDelay: { seconds: 15 },
};

const DEFAULT_HIDDEN_NAMESPACES = ['kube-public', 'kube-node-lease'];
const DEFAULT_SKIP_NAMESPACES = [
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'cloud-agents',
  'yourdevteam-runs',
];

function isComponentType(value: string): value is ComponentType {
  return (COMPONENT_TYPES as readonly string[]).includes(value);
}

function readOverride(config: Config): [string, WorkloadOverride] {
  const workload = config.getString('workload');
  if (!/^[^/]+\/[^/]+$/.test(workload)) {
    throw new Error(
      `inventory.kubernetes.overrides workload '${workload}' must be <namespace>/<name>`,
    );
  }
  const type = config.getOptionalString('type');
  if (type !== undefined && !isComponentType(type)) {
    throw new Error(
      `inventory.kubernetes.overrides type '${type}' must be one of ${COMPONENT_TYPES.join(
        ', ',
      )}`,
    );
  }
  const repository = config.getOptionalString('repository');
  if (repository !== undefined && !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error(
      `inventory.kubernetes.overrides repository '${repository}' must be <owner>/<name>`,
    );
  }
  return [
    workload,
    { ...(type ? { type } : {}), ...(repository ? { repository } : {}) },
  ];
}

export function readSettings(root: Config): {
  settings: InventorySettings;
  schedule: SchedulerServiceTaskScheduleDefinition;
} {
  const config = root.getOptionalConfig('inventory');
  const kubernetes = config?.getOptionalConfig('kubernetes');
  const schedule = config?.has('schedule')
    ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
        config.getConfig('schedule'),
      )
    : DEFAULT_SCHEDULE;
  return {
    schedule,
    settings: {
      owners: (config?.getOptionalConfigArray('github.owners') ?? []).map(
        o => ({
          login: o.getString('login'),
          entityRef: o.getString('entityRef'),
        }),
      ),
      defaultOwner:
        kubernetes?.getOptionalString('owner') ?? 'user:default/alaborderie',
      hiddenNamespaces: new Set(
        kubernetes?.getOptionalStringArray('hiddenNamespaces') ??
          DEFAULT_HIDDEN_NAMESPACES,
      ),
      skipNamespaces: new Set(
        kubernetes?.getOptionalStringArray('skipNamespaces') ??
          DEFAULT_SKIP_NAMESPACES,
      ),
      skipCronJobRuns:
        kubernetes?.getOptionalBoolean('skipCronJobRuns') ?? true,
      overrides: new Map(
        (kubernetes?.getOptionalConfigArray('overrides') ?? []).map(
          readOverride,
        ),
      ),
    },
  };
}
