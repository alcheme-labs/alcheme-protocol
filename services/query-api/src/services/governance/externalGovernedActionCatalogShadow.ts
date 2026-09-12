import type { GovernedActionDefinition } from './actionRegistry';
import {
  evaluateExternalGovernedActionReadiness,
  type ExternalGovernedActionReadinessResult,
} from './externalGovernedActionReadiness';
import type { GovernanceProfileWorkPin } from './governanceProfileLifecycle';

export type ExternalGovernedActionUserReadiness =
  | 'configurable'
  | 'pending_authorization'
  | 'ready_for_case'
  | 'service_unavailable'
  | 'network_mismatch'
  | 'historical_read_only';

export type ExternalGovernedActionCatalogShadowCompare = {
  actionType: string;
  legacyProfileCatalogMatched: boolean;
  genericDiscoveryState: ExternalGovernedActionReadinessResult['state'];
  agreement: boolean;
  userReadiness: ExternalGovernedActionUserReadiness;
  nextStep?: 'configure_governance_binding' | 'select_subject' | 'open_case';
  reasonCode?: string;
};

export function mapExternalGovernedActionUserReadiness(
  result: ExternalGovernedActionReadinessResult,
): {
  userReadiness: ExternalGovernedActionUserReadiness;
  nextStep?: ExternalGovernedActionCatalogShadowCompare['nextStep'];
  reasonCode?: string;
} {
  switch (result.state) {
    case 'ready':
      return { userReadiness: 'ready_for_case', nextStep: 'open_case' };
    case 'discoverable':
      return {
        userReadiness: result.nextStep === 'select_subject'
          ? 'pending_authorization'
          : 'configurable',
        nextStep: result.nextStep,
      };
    case 'not_bound':
    case 'authority_not_ready':
      return {
        userReadiness: 'pending_authorization',
        nextStep: 'configure_governance_binding',
        reasonCode: result.reasonCode,
      };
    case 'adapter_unavailable':
      return {
        userReadiness: 'service_unavailable',
        reasonCode: result.reasonCode,
      };
    case 'network_mismatch':
      return {
        userReadiness: 'network_mismatch',
        reasonCode: result.reasonCode,
      };
    case 'historical_read_only':
      return {
        userReadiness: 'historical_read_only',
        reasonCode: result.reasonCode,
      };
    default:
      return { userReadiness: 'service_unavailable' };
  }
}

export function compareExternalGovernedActionCatalogShadow(input: {
  home: { homeType: string; homeRef: string };
  profilePin: GovernanceProfileWorkPin;
  actionDefinition: GovernedActionDefinition;
  adapterAvailability?: { deployed: boolean; enabled: boolean };
}): ExternalGovernedActionCatalogShadowCompare {
  const discovery = evaluateExternalGovernedActionReadiness({
    phase: 'discovery',
    home: input.home,
    profilePin: input.profilePin,
    actionDefinition: input.actionDefinition,
    adapterAvailability: input.adapterAvailability ?? { deployed: true, enabled: true },
  });
  const legacyProfileCatalogMatched = input.profilePin.definition.actionCatalog.some((entry) =>
    entry === input.actionDefinition.actionType
    || (
      entry.endsWith('.*')
      && (
        input.actionDefinition.actionType === entry.slice(0, -2)
        || input.actionDefinition.actionType.startsWith(`${entry.slice(0, -2)}.`)
      )
    ));
  const mapped = mapExternalGovernedActionUserReadiness(discovery);
  const genericVisible = discovery.state === 'discoverable' || discovery.state === 'ready';
  return {
    actionType: input.actionDefinition.actionType,
    legacyProfileCatalogMatched,
    genericDiscoveryState: discovery.state,
    agreement: legacyProfileCatalogMatched === genericVisible,
    userReadiness: mapped.userReadiness,
    nextStep: mapped.nextStep,
    reasonCode: mapped.reasonCode,
  };
}
