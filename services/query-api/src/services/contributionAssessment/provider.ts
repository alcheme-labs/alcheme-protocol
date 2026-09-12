import type {
    ContributionAssessmentSuggestion,
    ContributionEvidencePackage,
    ContributionProviderMode,
} from './types';
import { serviceConfig } from '../../config/services';

export interface ContributionAssessmentProvider {
    readonly mode: ContributionProviderMode;
    assessDraftContribution(input: ContributionEvidencePackage): Promise<ContributionAssessmentSuggestion | null>;
}

export function getConfiguredContributionAssessmentProviderMode(): ContributionProviderMode {
    return serviceConfig.contributionAssessment.providerMode;
}

export function createDisabledContributionAssessmentProvider(): ContributionAssessmentProvider {
    return {
        mode: 'disabled',
        async assessDraftContribution() {
            return null;
        },
    };
}
