import {
  lockAssertClockExternalProgramRuntimeApp,
  ExternalProgramRuntimeAuthorizationError,
} from "./runtimeAuthorizationGate";
import { externalAppRegistryModeFromEnv } from "./chainRegistryProjection";

export function isSandboxExternalAppEnvironment(environment: unknown): boolean {
  return String(environment || "").trim().toLowerCase() === "sandbox";
}

/**
 * Direct sandbox writes require BOTH locked App and Binding to still be sandbox.
 * Never trust denormalized Binding.environment alone after App upgrade.
 */
export async function assertSandboxDirectCircleBindingWriteAllowed(
  tx: any,
  input: {
    binding: { id: string; externalAppId?: string | null; environment?: string | null };
    now?: Date;
  },
): Promise<{ app: any; binding: any; authorityNow: Date }> {
  const externalAppId = String(input.binding.externalAppId || "").trim();
  if (!externalAppId) {
    throw new ExternalProgramRuntimeAuthorizationError("external_app_not_found", 404);
  }
  const { app, authorityNow } = await lockAssertClockExternalProgramRuntimeApp(tx, {
    externalAppId,
    now: input.now,
    registryMode: externalAppRegistryModeFromEnv(),
  });
  if (typeof tx.$queryRawUnsafe === "function") {
    await tx.$queryRawUnsafe(
      `SELECT id FROM external_app_circle_bindings WHERE id = $1 FOR UPDATE`,
      input.binding.id,
    );
  }
  const binding = await tx.externalAppCircleBinding.findUnique({
    where: { id: input.binding.id },
  });
  if (!binding) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_not_found",
      404,
    );
  }
  if (
    !isSandboxExternalAppEnvironment(app.environment)
    || !isSandboxExternalAppEnvironment(binding.environment)
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_sandbox_direct_write_unavailable",
      409,
    );
  }
  return { app, binding, authorityNow };
}

/** Quarantine/revoke sandbox bindings when App leaves sandbox. Same txn as env upgrade. */
export async function quarantineSandboxCircleBindingsForEnvironmentUpgrade(
  tx: any,
  input: {
    externalAppId: string;
    authorityNow: Date;
    reason?: string;
  },
): Promise<number> {
  const externalAppId = String(input.externalAppId || "").trim();
  if (!externalAppId || typeof tx.externalAppCircleBinding?.updateMany !== "function") {
    return 0;
  }
  // Status/source only — do not clobber frozen application metadata.
  const result = await tx.externalAppCircleBinding.updateMany({
    where: {
      externalAppId,
      environment: "sandbox",
      status: { in: ["pending", "active"] },
    },
    data: {
      status: "revoked",
      revokedAt: input.authorityNow,
      source: "environment_upgrade_quarantine",
    },
  });
  return Number(result?.count || 0);
}
