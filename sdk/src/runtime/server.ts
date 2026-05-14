export interface BuildAppRoomClaimPayloadInput {
  externalAppId: string;
  roomType: string;
  externalRoomId: string;
  walletPubkeys: string[];
  roles?: Record<string, string>;
  expiresAt: string;
  nonce: string;
}

export interface AppRoomClaimPayload {
  externalAppId: string;
  roomType: string;
  externalRoomId: string;
  walletPubkeys: string[];
  roles?: Record<string, string>;
  expiresAt: string;
  nonce: string;
}

export interface AppRoomClaim {
  payload: string;
  signature: string;
}

export type AppRoomClaimSigner = (payload: string) => Promise<string>;

export function buildAppRoomClaimPayload(
  input: BuildAppRoomClaimPayloadInput,
): AppRoomClaimPayload {
  return {
    externalAppId: input.externalAppId.trim().toLowerCase(),
    roomType: input.roomType.trim().toLowerCase(),
    externalRoomId: input.externalRoomId.trim(),
    walletPubkeys: input.walletPubkeys.map((pubkey) => pubkey.trim()).filter(Boolean),
    ...(input.roles ? { roles: input.roles } : {}),
    expiresAt: input.expiresAt,
    nonce: input.nonce,
  };
}

export function encodeAppRoomClaimPayload(payload: AppRoomClaimPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export async function signAppRoomClaim(
  input: BuildAppRoomClaimPayloadInput,
  signer: AppRoomClaimSigner,
): Promise<AppRoomClaim> {
  const payload = encodeAppRoomClaimPayload(buildAppRoomClaimPayload(input));
  return {
    payload,
    signature: await signer(payload),
  };
}
