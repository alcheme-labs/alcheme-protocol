import { evaluateAuthorityDirect } from "../strategies/authorityDirect";

describe("authority.direct governance strategy", () => {
  test("accepts when the actor role is explicitly authorized", () => {
    expect(
      evaluateAuthorityDirect({
        config: {
          strategy: "authority.direct",
          authorized: { roles: ["owner", "moderator"] },
        },
        actor: { role: "moderator", pubkey: "wallet-moderator" },
      }),
    ).toMatchObject({ state: "accepted", reason: "authority_role_allowed" });
  });

  test("denies when the actor role is not authorized", () => {
    expect(
      evaluateAuthorityDirect({
        config: {
          strategy: "authority.direct",
          authorized: { roles: ["owner"] },
        },
        actor: { role: "member", pubkey: "wallet-member" },
      }),
    ).toMatchObject({ state: "rejected", reason: "authority_role_denied" });
  });
});
