import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PdaUtils } from "../utils/pda";

export abstract class BaseModule<T extends Idl> {
  public program: Program<T>;
  public programId: PublicKey;
  
  constructor(
    protected provider: AnchorProvider,
    programId: PublicKey,
    protected pda: PdaUtils,
    idl: T
  ) {
    this.programId = programId;
    this.program = new Program(idl, provider) as unknown as Program<T>;
  }
}

