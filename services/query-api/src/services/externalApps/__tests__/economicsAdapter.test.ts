import { createExternalAppEconomicsAdapter } from "../economicsAdapter";

describe("external app V3B economics adapter", () => {
  const baseConfig = {
    mode: "required" as const,
    programId: "5YUcL1ysdx9busDkvMGjiXNbugFAAWPLby5hoe2hQHAJ",
    rpcUrl: "http://127.0.0.1:8899",
    cluster: "localnet",
  };

  it("skips all custody submission when disabled", async () => {
    const adapter = createExternalAppEconomicsAdapter({ mode: "disabled" });

    await expect(
      adapter.openChallengeCase({
        externalAppId: "game-1",
        appIdHash: "01".repeat(32),
        caseId: "02".repeat(32),
        evidenceHash: "03".repeat(32),
        challengeType: 1,
        mint: "Mint111111111111111111111111111111111111",
        amountRaw: "10",
      }),
    ).resolves.toMatchObject({
      mode: "disabled",
      status: "skipped",
      reason: "external_app_economics_mode_disabled",
    });
  });

  it("requires program and submitter config in required mode", async () => {
    const adapter = createExternalAppEconomicsAdapter({ mode: "required" });

    await expect(
      adapter.openOwnerBondVault({
        externalAppId: "game-1",
        appIdHash: "01".repeat(32),
        ownerPubkey: "Owner111111111111111111111111111111111",
        mint: "Mint111111111111111111111111111111111111",
      }),
    ).rejects.toThrow("external_app_economics_program_id_required");
  });

  it("submits through an injected signer and returns receipt evidence", async () => {
    const submitter = {
      openOwnerBondVault: jest.fn(async () => ({
        txSignature: "tx-owner",
        accountPda: "vault-pda",
      })),
      openChallengeCase: jest.fn(),
      executeBondSettlement: jest.fn(),
    };
    const adapter = createExternalAppEconomicsAdapter(baseConfig, { submitter });

    await expect(
      adapter.openOwnerBondVault({
        externalAppId: "game-1",
        appIdHash: "01".repeat(32),
        ownerPubkey: "Owner111111111111111111111111111111111",
        mint: "Mint111111111111111111111111111111111111",
      }),
    ).resolves.toMatchObject({
      mode: "required",
      status: "submitted",
      txSignature: "tx-owner",
      accountPda: "vault-pda",
    });
    expect(submitter.openOwnerBondVault).toHaveBeenCalledTimes(1);
  });
});
