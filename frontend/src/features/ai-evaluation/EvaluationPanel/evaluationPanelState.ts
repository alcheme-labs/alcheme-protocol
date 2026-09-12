export interface EvaluationStateArtifact {
  status?: string | null;
  visibility?: string | null;
}

export function canPublishEvaluation(artifact: EvaluationStateArtifact | null | undefined): boolean {
  return artifact?.status === 'ready' && artifact.visibility === 'private';
}

export function canRetractEvaluation(artifact: EvaluationStateArtifact | null | undefined): boolean {
  return artifact?.status === 'ready' && artifact.visibility === 'public';
}

export function isEvaluationActionDisabled(input: {
  allowed: boolean;
  panelBusy: boolean;
  hasPendingAction: boolean;
}): boolean {
  return !input.allowed || input.panelBusy || input.hasPendingAction;
}
