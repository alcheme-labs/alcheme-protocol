import { expect } from "chai";
import path from "path";
import {
  permissionLabelToAnchorVariant,
  resolveContributionEngineRegistration,
  resolveProgramConfigPath,
} from "../../scripts/initialize-programs";

describe("initialize-programs config contract", () => {
  const repoRoot = process.cwd();
  const localnetConfigPath = path.join(repoRoot, "sdk", "localnet-config.json");
  const devnetConfigPath = path.join(repoRoot, "config", "devnet-program-ids.json");

  it("defaults to the canonical devnet program artifact instead of localnet IDs for devnet runs", () => {
    expect(resolveProgramConfigPath({ cluster: "devnet" })).to.equal(devnetConfigPath);
    expect(resolveProgramConfigPath({ rpcUrl: "https://api.devnet.solana.com" })).to.equal(devnetConfigPath);
  });

  it("keeps localnet as the only implicit fallback when no remote artifact was requested", () => {
    expect(resolveProgramConfigPath({ cluster: "localnet" })).to.equal(localnetConfigPath);
    expect(resolveProgramConfigPath({})).to.equal(localnetConfigPath);
  });

  it("requires an explicit program artifact for non-devnet remote clusters", () => {
    expect(() => resolveProgramConfigPath({ cluster: "testnet" })).to.throw(/explicit --program-ids/i);
    expect(() => resolveProgramConfigPath({ rpcUrl: "https://api.mainnet-beta.solana.com" })).to.throw(/explicit --program-ids/i);
  });

  it("prefers an explicit program artifact path over inferred defaults", () => {
    expect(resolveProgramConfigPath({ programIdsPath: "config/custom-devnet.json", cluster: "devnet" })).to.equal(
      path.join(repoRoot, "config", "custom-devnet.json")
    );
  });

  it("maps manifest permission labels into Anchor enum variants for extension registration", () => {
    expect(permissionLabelToAnchorVariant("ReputationWrite")).to.deep.equal({ reputationWrite: {} });
    expect(permissionLabelToAnchorVariant("ContentRead")).to.deep.equal({ contentRead: {} });
  });

  it("builds a contribution-engine registration plan from the deployed program IDs and manifest contract", () => {
    const registration = resolveContributionEngineRegistration({
      identity: "identity-program-id",
      content: "content-program-id",
      access: "access-program-id",
      event: "event-program-id",
      factory: "factory-program-id",
      messaging: "messaging-program-id",
      circles: "circle-program-id",
      contributionEngine: "contribution-program-id",
    });

    expect(registration).to.deep.equal({
      programId: "contribution-program-id",
      permissions: [{ reputationWrite: {} }],
    });
  });

  it("skips extension registration when the current deployment has no contribution-engine program ID", () => {
    expect(
      resolveContributionEngineRegistration({
        identity: "identity-program-id",
        content: "content-program-id",
        access: "access-program-id",
        event: "event-program-id",
        factory: "factory-program-id",
        messaging: "messaging-program-id",
        circles: "circle-program-id",
      })
    ).to.equal(null);
  });
});
