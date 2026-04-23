import { describe, expect, test } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";

import { CirclesModule } from "../src/modules/circles";

const PROGRAM_ID = new PublicKey("4sisPMeR1uY1wd6XKazN9VsXpXB764WeYYh14EDsujJ5");
const ACCESS_CONTROLLER_PDA = new PublicKey("8kq7nWQBh5Y2zJ4vLfQw8EJ4QUPK4r9owQ8h2Vv5RAnf");
const AUTHORITY = new PublicKey("11111111111111111111111111111111");
const CURATOR = new PublicKey("H3ukN6fknh6fTafS63vzFecQp4Q5vWckPXwZsW47vYr4");

describe("CirclesModule access controller routing", () => {
  test("addCurator stops using SystemProgram placeholder and routes through the access controller PDA", async () => {
    const addCuratorRpc = jest.fn(async () => "add_curator_signature");
    const addCuratorAccounts = jest.fn(() => ({
      rpc: addCuratorRpc,
    }));
    const addCuratorMethod = jest.fn(() => ({
      accounts: addCuratorAccounts,
    }));

    const fakeModule = Object.assign(Object.create(CirclesModule.prototype), {
      provider: { publicKey: AUTHORITY },
      programId: PROGRAM_ID,
      pda: {
        findAccessControllerPda: () => ACCESS_CONTROLLER_PDA,
      },
      program: {
        methods: {
          addCurator: addCuratorMethod,
        },
      },
    });

    const tx = await fakeModule.addCurator(7, CURATOR);

    expect(tx).toBe("add_curator_signature");
    expect(addCuratorMethod).toHaveBeenCalledWith(CURATOR);
    expect(addCuratorAccounts).toHaveBeenCalledWith(expect.objectContaining({
      accessController: ACCESS_CONTROLLER_PDA,
      authority: AUTHORITY,
    }));
    expect(addCuratorAccounts).not.toHaveBeenCalledWith(expect.objectContaining({
      accessController: expect.anything(),
      systemProgram: expect.anything(),
    }));
  });
});
