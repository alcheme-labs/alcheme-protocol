import { expect } from "chai";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  createMeasurementContext,
  MEASUREMENT_IDENTITY_REGISTRY_NAME,
} = require("../../scripts/measure/v2-cost-helpers.ts");

describe("v2 cost measurement bootstrap", function () {
  this.timeout(120000);

  it("ensures baseline program PDAs exist before sampling", async () => {
    const { connection, sdk } = await createMeasurementContext();

    const cases = [
      {
        name: "identity_registry",
        address: sdk.pda.findIdentityRegistryPda(MEASUREMENT_IDENTITY_REGISTRY_NAME),
        owner: sdk.identity.programId,
      },
      {
        name: "access_controller",
        address: sdk.pda.findAccessControllerPda(),
        owner: sdk.access.programId,
      },
      {
        name: "event_emitter",
        address: sdk.pda.findEventEmitterPda(),
        owner: sdk.event.programId,
      },
      {
        name: "content_manager",
        address: sdk.pda.findContentManagerPda(),
        owner: sdk.content.programId,
      },
    ];

    for (const testCase of cases) {
      const account = await connection.getAccountInfo(testCase.address, "confirmed");
      expect(account, `${testCase.name} should be initialized`).to.not.equal(null);
      expect(account?.owner.toBase58(), `${testCase.name} should be owned by the right program`).to.equal(
        testCase.owner.toBase58(),
      );
    }
  });
});
