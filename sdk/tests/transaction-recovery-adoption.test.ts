import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "@jest/globals";

describe("transaction recovery adoption", () => {
  const transactionsHelperPath = path.join(__dirname, "..", "src", "utils", "transactions.ts");
  const alchemePath = path.join(__dirname, "..", "src", "alcheme.ts");
  const identityModulePath = path.join(__dirname, "..", "src", "modules", "identity.ts");
  const circlesModulePath = path.join(__dirname, "..", "src", "modules", "circles.ts");
  const contributionEngineModulePath = path.join(__dirname, "..", "src", "modules", "contribution-engine.ts");

  function read(filePath: string): string {
    assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
    return fs.readFileSync(filePath, "utf8");
  }

  it("defines a shared transaction recovery helper outside identity-specific modules", () => {
    const source = read(transactionsHelperPath);

    assert.match(source, /export function isAlreadyProcessedTransactionError/);
    assert.match(source, /export async function sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(source, /export function installAlreadyProcessedSendAndConfirmRecovery/);
  });

  it("installs provider-level recovery when constructing the sdk", () => {
    const source = read(alchemePath);

    assert.match(source, /from "\.\/utils\/transactions"/);
    assert.match(source, /installAlreadyProcessedSendAndConfirmRecovery\(this\.provider\)/);
  });

  it("uses the shared transaction recovery helper in high-risk wallet write modules", () => {
    const identitySource = read(identityModulePath);
    const circlesSource = read(circlesModulePath);
    const contributionEngineSource = read(contributionEngineModulePath);

    assert.match(identitySource, /from "\.\.\/utils\/transactions"/);
    assert.match(circlesSource, /from "\.\.\/utils\/transactions"/);
    assert.match(contributionEngineSource, /from "\.\.\/utils\/transactions"/);

    assert.match(identitySource, /sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(circlesSource, /sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(contributionEngineSource, /sendTransactionWithAlreadyProcessedRecovery/);
  });

  it("routes contribution-engine writes through transaction builders instead of direct rpc calls", () => {
    const source = read(contributionEngineModulePath);

    assert.match(source, /async createLedger[\s\S]*sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(source, /async recordContribution[\s\S]*sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(source, /async addReference[\s\S]*sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(source, /async closeLedger[\s\S]*sendTransactionWithAlreadyProcessedRecovery/);
    assert.doesNotMatch(source, /async createLedger[\s\S]*\.rpc\(\)/);
  });
});
