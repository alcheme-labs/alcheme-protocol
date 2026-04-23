import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program, Idl } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import * as idl from "../idl/access_controller.json";
import * as eventEmitterIdl from "../idl/event_emitter.json";

export class AccessModule extends BaseModule<Idl> {
  private eventProgram: Program<Idl>;

  constructor(provider: any, programId: PublicKey, pda: any) {
    super(provider, programId, pda, idl as unknown as Idl);
    this.eventProgram = new Program(eventEmitterIdl as unknown as Idl, provider) as unknown as Program<Idl>;
  }

  async setAccessRule(
    user: PublicKey,
    ruleId: string,
    permission: any,
    accessLevel: any
  ) {
    const accessRule = {
        ruleId,
        permission,
        accessLevel,
        conditions: null,
        exceptions: [],
        priority: 50,
        enabled: true,
        createdAt: new BN(Date.now() / 1000),
        expiresAt: null,
    };

    return this.program.methods
      .setAccessRules(user, permission, accessRule)
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        user: this.provider.publicKey,
      })
      .rpc();
  }

  async checkPermission(requester: PublicKey, target: PublicKey, permission: any, context: any) {
    return this.program.methods
      .checkPermission(requester, target, permission, context)
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        callerProgram: this.programId,
      })
      .rpc();
  }

  async batchSetPermissions(user: PublicKey, rules: any[]) {
    return this.program.methods
      .batchSetPermissions(user, rules)
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        user: this.provider.publicKey,
      })
      .rpc();
  }

  async removeAccessRule(user: PublicKey, ruleId: string) {
    return this.program.methods
      .removeAccessRule(user, ruleId)
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        user: this.provider.publicKey,
      })
      .rpc();
  }

  async updateRuleStatus(user: PublicKey, ruleId: string, enabled: boolean) {
    return this.program.methods
      .updateRuleStatus(user, ruleId, enabled)
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        user: this.provider.publicKey,
      })
      .rpc();
  }

  async getAccessStats(timeRange?: any) {
    return this.program.methods
      .getAccessStats(timeRange || null)
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
      })
      .rpc();
  }

  async followUser(followed: PublicKey) {
    const eventAccounts = await this.resolveEventAccounts();

    return this.program.methods
      .followUser()
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        followRelationship: this.pda.findFollowRelationshipPda(this.provider.publicKey, followed),
        follower: this.provider.publicKey,
        followed,
        systemProgram: SystemProgram.programId,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
      })
      .rpc();
  }

  async unfollowUser(followed: PublicKey) {
    const eventAccounts = await this.resolveEventAccounts();

    return this.program.methods
      .unfollowUser()
      .accounts({
        accessController: this.pda.findAccessControllerPda(),
        followRelationship: this.pda.findFollowRelationshipPda(this.provider.publicKey, followed),
        follower: this.provider.publicKey,
        followed,
        systemProgram: SystemProgram.programId,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
      })
      .rpc();
  }

  private async resolveEventAccounts(): Promise<{
    eventProgram: PublicKey;
    eventEmitter: PublicKey;
    eventBatch: PublicKey;
  }> {
    const eventProgram = this.eventProgram.programId;
    const eventEmitter = this.pda.findEventEmitterPda();

    // @ts-ignore - Anchor account namespace is generated from IDL
    const emitterAccount = await this.eventProgram.account.eventEmitterAccount.fetch(eventEmitter);
    const eventSequenceValue =
      emitterAccount?.inner?.eventSequence ??
      emitterAccount?.eventSequence;
    const eventSequence = this.toBN(eventSequenceValue);
    const eventBatch = this.pda.findEventBatchPda(eventSequence);

    return {
      eventProgram,
      eventEmitter,
      eventBatch,
    };
  }

  private toBN(value: unknown): BN {
    if (BN.isBN(value)) {
      return value;
    }

    if (typeof value === "number") {
      return new BN(value);
    }

    if (typeof value === "bigint") {
      return new BN(value.toString());
    }

    if (value && typeof (value as { toString?: () => string }).toString === "function") {
      return new BN((value as { toString: () => string }).toString());
    }

    throw new Error("Failed to read event sequence from event_emitter account");
  }
}
