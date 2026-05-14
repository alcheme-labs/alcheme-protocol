import {
  createExternalAppRegistryAdapter,
  type ExternalAppChainRegistrationPayload,
} from "../chainRegistryAdapter";

const payload: ExternalAppChainRegistrationPayload = {
  externalAppId: "demo-game",
  appIdHash: "a".repeat(64),
  ownerPubkey: "11111111111111111111111111111111",
  serverKeyHash: "b".repeat(64),
  manifestHashHex: "c".repeat(64),
  ownerAssertionHash: "d".repeat(64),
  policyStateDigest: "e".repeat(64),
  reviewCircleId: 7,
  reviewPolicyDigest: "f".repeat(64),
  decisionDigest: "1".repeat(64),
  executionIntentDigest: "2".repeat(64),
};

describe("external app chain registry adapter", () => {
  it("skips chain registration in disabled mode", async () => {
    const adapter = createExternalAppRegistryAdapter({ mode: "disabled" });

    await expect(adapter.anchorExternalAppRegistration(payload)).resolves.toMatchObject({
      status: "skipped",
      reason: "registry_mode_disabled",
    });
  });

  it("does not swallow required-mode configuration errors", async () => {
    const adapter = createExternalAppRegistryAdapter({ mode: "required" });

    await expect(adapter.anchorExternalAppRegistration(payload)).rejects.toThrow(
      "external_app_registry_program_id_required",
    );
  });

  it("skips optional mode when config is incomplete", async () => {
    const adapter = createExternalAppRegistryAdapter({ mode: "optional" });

    await expect(adapter.anchorExternalAppRegistration(payload)).resolves.toMatchObject({
      status: "skipped",
      reason: "external_app_registry_program_id_required",
    });
  });

  it("uses injected submitter and returns submitted evidence", async () => {
    const adapter = createExternalAppRegistryAdapter(
      {
        mode: "required",
        programId: "FT4n9xkfEafYP2MSmqwur3xCeu361Vzrfpz8XNmaAG7J",
        rpcUrl: "http://127.0.0.1:8899",
        eventProgramId: "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC",
        authorityKeypairPath: "/tmp/dev-authority.json",
        nodeEnv: "development",
      },
      {
        submitter: {
          anchorExternalAppRegistration: jest.fn(async () => ({
            txSignature: "tx-1",
            recordPda: "record-pda",
          })),
          anchorExecutionReceipt: jest.fn(async () => ({
            txSignature: "tx-2",
            recordPda: "record-pda",
          })),
        },
      },
    );

    await expect(adapter.anchorExternalAppRegistration(payload)).resolves.toMatchObject({
      status: "submitted",
      txSignature: "tx-1",
      recordPda: "record-pda",
    });
  });

  it("rejects direct local keypair loading in required production mode", async () => {
    const adapter = createExternalAppRegistryAdapter({
      mode: "required",
      programId: "FT4n9xkfEafYP2MSmqwur3xCeu361Vzrfpz8XNmaAG7J",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      eventProgramId: "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC",
      authorityKeypairPath: "/secure/authority.json",
      nodeEnv: "production",
    });

    await expect(adapter.anchorExternalAppRegistration(payload)).rejects.toThrow(
      "external_app_registry_local_keypair_not_allowed_in_production_required_mode",
    );
  });
});
