import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import { sendTransactionWithAlreadyProcessedRecovery } from "../utils/transactions";
import * as idl from "../idl/contribution_engine.json";
import { Idl } from "@coral-xyz/anchor";

export type ContributionEngineIdl = Idl;

export type ContributionRoleArg =
  | { author: {} }
  | { discussant: {} }
  | { reviewer: {} }
  | { cited: {} };

export type ReferenceTypeArg =
  | { import: {} }
  | { citation: {} }
  | { mention: {} }
  | { forkOrigin: {} };

function bindContributionEngineIdl(programId: PublicKey): ContributionEngineIdl {
  return {
    ...(idl as unknown as Record<string, unknown>),
    address: programId.toBase58(),
  } as ContributionEngineIdl;
}

export class ContributionEngineModule extends BaseModule<ContributionEngineIdl> {
  constructor(provider: any, programId: PublicKey, pda: any) {
    super(provider, programId, pda, bindContributionEngineIdl(programId));
    this.program = new Program(
      bindContributionEngineIdl(programId),
      provider
    ) as unknown as Program<ContributionEngineIdl>;
  }

  findConfigPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.programId
    )[0];
  }

  findLedgerPda(crystalId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ledger"), crystalId.toBuffer()],
      this.programId
    )[0];
  }

  findEntryPda(crystalId: PublicKey, contributor: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("entry"), crystalId.toBuffer(), contributor.toBuffer()],
      this.programId
    )[0];
  }

  findReferencePda(sourceId: PublicKey, targetId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ref"), sourceId.toBuffer(), targetId.toBuffer()],
      this.programId
    )[0];
  }

  async getLedger(crystalId: PublicKey) {
    const ledgerPda = this.findLedgerPda(crystalId);
    // @ts-ignore - Anchor account type is generated at runtime.
    return this.program.account.contributionLedger.fetch(ledgerPda);
  }

  async getContributionEntry(crystalId: PublicKey, contributor: PublicKey) {
    const entryPda = this.findEntryPda(crystalId, contributor);
    // @ts-ignore - Anchor account type is generated at runtime.
    return this.program.account.contributionEntry.fetch(entryPda);
  }

  async createLedger(crystalId: PublicKey) {
    const authority = this.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");

    const configPda = this.findConfigPda();
    const ledgerPda = this.findLedgerPda(crystalId);

    return sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
      (this.program.methods as any)
        .createLedger(crystalId)
        .accounts({
          config: configPda,
          ledger: ledgerPda,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
    );
  }

  async recordContribution(
    crystalId: PublicKey,
    contributor: PublicKey,
    role: ContributionRoleArg,
    weight: number
  ) {
    const authority = this.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");

    const configPda = this.findConfigPda();
    const ledgerPda = this.findLedgerPda(crystalId);
    const entryPda = this.findEntryPda(crystalId, contributor);

    return sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
      (this.program.methods as any)
        .recordContribution(role, weight)
        .accounts({
          config: configPda,
          ledger: ledgerPda,
          entry: entryPda,
          contributor,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
    );
  }

  async addReference(
    sourceId: PublicKey,
    targetId: PublicKey,
    refType: ReferenceTypeArg
  ) {
    const authority = this.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");

    const configPda = this.findConfigPda();
    const referencePda = this.findReferencePda(sourceId, targetId);

    return sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
      (this.program.methods as any)
        .addReference(refType)
        .accounts({
          config: configPda,
          reference: referencePda,
          sourceContent: sourceId,
          targetContent: targetId,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
    );
  }

  async closeLedger(crystalId: PublicKey) {
    const admin = this.provider.publicKey;
    if (!admin) throw new Error("Wallet not connected");

    const configPda = this.findConfigPda();
    const ledgerPda = this.findLedgerPda(crystalId);

    return sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
      (this.program.methods as any)
        .closeLedger()
        .accounts({
          config: configPda,
          ledger: ledgerPda,
          admin,
        })
        .transaction()
    );
  }
}
