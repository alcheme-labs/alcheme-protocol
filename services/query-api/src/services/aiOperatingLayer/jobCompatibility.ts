import type { AiJobType } from '../aiJobs/types';
import { resolveTaskCatalogEntryForAiJobType } from './taskCatalog';
import type { AiJobCompatibility } from './types';

export function classifyAiJobCompatibility(jobType: AiJobType): AiJobCompatibility {
    if (jobType === 'crystal_asset_issue') {
        return {
            jobType,
            modelTask: false,
            asyncDomainTask: true,
            taskType: null,
            taskCatalogVersion: null,
            executionStrategy: 'domain_async',
            requiredCapabilities: [],
        };
    }

    const catalogEntry = resolveTaskCatalogEntryForAiJobType(jobType);
    if (!catalogEntry) {
        return {
            jobType,
            modelTask: false,
            asyncDomainTask: false,
            taskType: null,
            taskCatalogVersion: null,
            executionStrategy: 'deterministic_only',
            requiredCapabilities: [],
        };
    }

    return {
        jobType,
        modelTask: catalogEntry.requiredCapabilities.length > 0 && catalogEntry.executionStrategy !== 'deterministic_only',
        asyncDomainTask: false,
        taskType: catalogEntry.taskType,
        taskCatalogVersion: catalogEntry.catalogVersion,
        executionStrategy: catalogEntry.executionStrategy,
        requiredCapabilities: [...catalogEntry.requiredCapabilities],
    };
}
