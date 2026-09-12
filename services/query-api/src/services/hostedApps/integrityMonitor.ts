export function assertVerifiedReleaseBundle(input: {
  expectedManifestHash: string;
  actualManifestHash: string;
  expectedBundleHash: string;
  actualBundleHash: string;
  developerSignatureValid: boolean;
  releaseStatus: string;
}): void {
  if (["revoked", "suspended", "expired"].includes(input.releaseStatus)) {
    throw new Error("hosted_app_release_not_active");
  }
  if (input.expectedManifestHash !== input.actualManifestHash) {
    throw new Error("hosted_app_manifest_hash_mismatch");
  }
  if (input.expectedBundleHash !== input.actualBundleHash) {
    throw new Error("hosted_app_bundle_hash_mismatch");
  }
  if (!input.developerSignatureValid) {
    throw new Error("hosted_app_developer_signature_invalid");
  }
}
