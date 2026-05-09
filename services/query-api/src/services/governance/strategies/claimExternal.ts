import bs58 from "bs58";
import nacl from "tweetnacl";

export interface ExternalGovernanceClaim {
  payload: string;
  signature: string;
}

export interface ExternalGovernanceClaimPayload {
  issuerRef: string;
  claimType: string;
  actionType: string;
  scopeType: string;
  scopeRef: string;
  targetRef: string;
  actorPubkey?: string | null;
  expiresAt: string;
  nonce: string;
}

export function createExternalGovernanceClaim(
  payload: ExternalGovernanceClaimPayload,
): { payload: string } {
  return {
    payload: Buffer.from(
      JSON.stringify({
        issuerRef: payload.issuerRef,
        claimType: payload.claimType,
        actionType: payload.actionType,
        scopeType: payload.scopeType,
        scopeRef: payload.scopeRef,
        targetRef: payload.targetRef,
        actorPubkey: payload.actorPubkey ?? null,
        expiresAt: payload.expiresAt,
        nonce: payload.nonce,
      }),
    ).toString("base64url"),
  };
}

export function verifyExternalGovernanceClaim(input: {
  claim: ExternalGovernanceClaim;
  issuerPublicKey: string;
  expected: {
    issuerRef: string;
    claimType: string;
    actionType: string;
    scopeType: string;
    scopeRef: string;
    targetRef: string;
  };
  now: Date;
}): ExternalGovernanceClaimPayload {
  const publicKey = Uint8Array.from(bs58.decode(input.issuerPublicKey.trim()));
  const signature = Buffer.from(input.claim.signature, "base64");
  const message = Buffer.from(input.claim.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("external governance claim signature invalid");
  }

  const payload = JSON.parse(
    Buffer.from(input.claim.payload, "base64url").toString("utf8"),
  ) as ExternalGovernanceClaimPayload;

  if (
    payload.issuerRef !== input.expected.issuerRef ||
    payload.claimType !== input.expected.claimType ||
    payload.actionType !== input.expected.actionType ||
    payload.scopeType !== input.expected.scopeType ||
    payload.scopeRef !== input.expected.scopeRef ||
    payload.targetRef !== input.expected.targetRef
  ) {
    throw new Error("external governance claim mismatch");
  }

  if (new Date(payload.expiresAt).getTime() <= input.now.getTime()) {
    throw new Error("external governance claim expired");
  }
  if (!payload.nonce) {
    throw new Error("external governance claim nonce required");
  }

  return payload;
}
