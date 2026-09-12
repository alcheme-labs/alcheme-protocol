export function isExternalActionCandidatePickerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.GOVERNANCE_EXTERNAL_ACTION_CANDIDATE_PICKER_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

export function isExternalActionIntakeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.GOVERNANCE_EXTERNAL_ACTION_INTAKE_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}
