import { evaluatePipelineAny } from "../strategies/pipelineAny";

describe("pipeline.any governance strategy", () => {
  test("accepts when any child strategy accepts", () => {
    expect(
      evaluatePipelineAny({
        config: {
          strategy: "pipeline.any",
          steps: [
            {
              strategy: "authority.direct",
              authorized: { roles: ["owner"] },
            },
            {
              strategy: "consent.unanimous",
              requiredParties: ["wallet-a"],
            },
          ],
        },
        actor: { role: "member", pubkey: "wallet-member" },
        signals: [{ actorPubkey: "wallet-a", value: "approve" }],
      }),
    ).toMatchObject({ state: "accepted", reason: "pipeline_any_accepted" });
  });

  test("stays active when a child is still waiting and none accepted", () => {
    expect(
      evaluatePipelineAny({
        config: {
          strategy: "pipeline.any",
          steps: [
            {
              strategy: "authority.direct",
              authorized: { roles: ["owner"] },
            },
            {
              strategy: "consent.unanimous",
              requiredParties: ["wallet-a", "wallet-b"],
            },
          ],
        },
        actor: { role: "member", pubkey: "wallet-member" },
        signals: [{ actorPubkey: "wallet-a", value: "approve" }],
      }),
    ).toMatchObject({ state: "active", reason: "pipeline_any_waiting" });
  });
});
