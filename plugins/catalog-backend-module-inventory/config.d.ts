import type { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

export interface Config {
  /** Catalog entities derived from the k3s cluster and GitHub. */
  inventory?: {
    /** Refresh schedule; defaults to every 15 minutes. */
    schedule?: SchedulerServiceTaskScheduleDefinitionConfig;
    github?: {
      /** GitHub users or organizations whose repositories become components. */
      owners?: Array<{
        login: string;
        /** Owner of the repository components, such as group:default/duscraft. */
        entityRef: string;
      }>;
    };
    kubernetes?: {
      /** Owner of cluster entities not linked to a repository. */
      owner?: string;
      /** Namespaces with no namespace resource. */
      hiddenNamespaces?: string[];
      /** Namespaces whose workloads and ingress routes are not listed. */
      skipNamespaces?: string[];
      /** Skip Jobs created by a CronJob. Defaults to true. */
      skipCronJobRuns?: boolean;
      overrides?: Array<{
        /** `<k3s namespace>/<workload name>`. */
        workload: string;
        type?:
          | 'api'
          | 'frontend'
          | 'bot'
          | 'job'
          | 'cronjob'
          | 'worker'
          | 'service';
        /** `<owner>/<name>` of the repository the workload is built from. */
        repository?: string;
      }>;
    };
  };
}
