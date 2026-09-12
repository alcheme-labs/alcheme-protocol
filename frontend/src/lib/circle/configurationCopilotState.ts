export interface ConfigurationRequestKeyTransitionInput {
  currentRequestKey: string;
  nextRequestKey: string;
  pendingLocalApplyCount: number;
}

export interface ConfigurationRequestKeyTransition {
  shouldClearProposal: boolean;
  nextStoredRequestKey: string;
  nextPendingLocalApplyCount: number;
}

export interface ConfigurationSettingsDirtyState {
  ghostDirty: boolean;
  draftLifecycleDirty: boolean;
  draftWorkflowDirty: boolean;
}

export interface ConfigurationUndoEntryWithDirtyState {
  dirtyState?: ConfigurationSettingsDirtyState;
}

export function resolveConfigurationRequestKeyTransition(
  input: ConfigurationRequestKeyTransitionInput,
): ConfigurationRequestKeyTransition {
  if (!input.currentRequestKey || input.currentRequestKey === input.nextRequestKey) {
    return {
      shouldClearProposal: false,
      nextStoredRequestKey: input.currentRequestKey,
      nextPendingLocalApplyCount: input.currentRequestKey === input.nextRequestKey
        ? 0
        : input.pendingLocalApplyCount,
    };
  }

  if (input.pendingLocalApplyCount > 0) {
    return {
      shouldClearProposal: false,
      nextStoredRequestKey: input.nextRequestKey,
      nextPendingLocalApplyCount: 0,
    };
  }

  return {
    shouldClearProposal: true,
    nextStoredRequestKey: input.currentRequestKey,
    nextPendingLocalApplyCount: input.pendingLocalApplyCount,
  };
}

export function restoreConfigurationSettingsDirtyState(
  undoStack: ConfigurationUndoEntryWithDirtyState[],
  currentDirtyState: ConfigurationSettingsDirtyState,
): ConfigurationSettingsDirtyState {
  return undoStack[0]?.dirtyState ?? currentDirtyState;
}
