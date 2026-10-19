import type { ProjectHubApi } from '@project-hub/contracts';

declare global {
  interface Window {
    /** API do preload (seção 13.3). Só existe dentro do aplicativo. */
    projectHub: ProjectHubApi;
  }
}

export {};
