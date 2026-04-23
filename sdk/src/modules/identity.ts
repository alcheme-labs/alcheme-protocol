import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import { AccessModule } from "./access";
import * as idl from "../idl/identity_registry.json";
import * as eventEmitterIdl from "../idl/event_emitter.json";
import { Idl } from "@coral-xyz/anchor";
import {
  isAlreadyProcessedTransactionError,
  sendTransactionWithAlreadyProcessedRecovery,
} from "../utils/transactions";

// Define types roughly to help with intellisense (in a real scenario these are generated)
export type IdentityRegistryIdl = Idl;

export function isEventBatchSeedConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /event_batch/i.test(message) && /ConstraintSeeds/i.test(message);
}

export async function withEventBatchSeedRetry<T>(
  operation: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 4);
  const delayMs = Math.max(0, options?.delayMs ?? 150);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isEventBatchSeedConflictError(error) || attempt === attempts - 1) {
        throw error;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export { isAlreadyProcessedTransactionError, sendTransactionWithAlreadyProcessedRecovery };

export class IdentityModule extends BaseModule<IdentityRegistryIdl> {
  private eventProgram: Program<Idl>;
  private accessModule: AccessModule;

  constructor(provider: any, programId: PublicKey, pda: any) {
    super(provider, programId, pda, idl as unknown as IdentityRegistryIdl);
    this.eventProgram = new Program(eventEmitterIdl as unknown as Idl, provider) as unknown as Program<Idl>;
    this.accessModule = new AccessModule(provider, pda.getAccessProgramId(), pda);
  }

  async registerIdentity(
    handle: string,
    displayName: string,
    bio: string = "",
    avatarUri: string = ""
  ) {
    const identityRegistry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(identityRegistry, handle);
    const handleMappingPda = this.pda.findHandleMappingPda(handle);

    const privacySettings = {
        profileVisibility: { public: {} },
        contentVisibility: { public: {} },
        socialGraphVisibility: { public: {} },
        activityVisibility: { public: {} },
        economicDataVisibility: { public: {} },
        allowDirectMessages: true,
        allowMentions: true,
        allowContentIndexing: true,
        dataRetentionDays: null,
    };

    return this.withResolvedEventAccountsRetry((eventAccounts) =>
      sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
        this.program.methods
          .registerIdentity(handle, privacySettings)
          .accounts({
            // @ts-ignore - Dynamic account resolution usually works but for strict typing we need generated types
            identityRegistry,
            userIdentity: userIdentityPda,
            handleMapping: handleMappingPda,
            user: this.provider.publicKey,
            systemProgram: SystemProgram.programId,
            eventProgram: eventAccounts.eventProgram,
            eventEmitter: eventAccounts.eventEmitter,
            eventBatch: eventAccounts.eventBatch,
          })
          .transaction()
      )
    );
  }

  async getIdentity(handle: string) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);
    // @ts-ignore
    // @ts-ignore
    return this.program.account.userIdentity.fetch(userIdentityPda);
  }
  
  async checkHandleAvailability(handle: string): Promise<boolean> {
      const handleMappingPda = this.pda.findHandleMappingPda(handle);
      const account = await this.provider.connection.getAccountInfo(handleMappingPda);
      return account === null;
  }

  async updateIdentity(handle: string, updates: any) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);
    const normalizedUpdates = toIdentityUpdatePayload(updates);

    return this.withResolvedEventAccountsRetry((eventAccounts) =>
      sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
        this.program.methods
          .updateIdentity(normalizedUpdates)
          .accounts({
            userIdentity: userIdentityPda,
            user: this.provider.publicKey,
            systemProgram: SystemProgram.programId,
            eventProgram: eventAccounts.eventProgram,
            eventEmitter: eventAccounts.eventEmitter,
            eventBatch: eventAccounts.eventBatch,
          })
          .transaction()
      )
    );
  }

  async addVerificationAttribute(handle: string, attribute: any) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);

    return this.withResolvedEventAccountsRetry((eventAccounts) =>
      sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
        this.program.methods
          .addVerificationAttribute(attribute)
          .accounts({
            userIdentity: userIdentityPda,
            verifier: this.provider.publicKey,
            systemProgram: SystemProgram.programId,
            eventProgram: eventAccounts.eventProgram,
            eventEmitter: eventAccounts.eventEmitter,
            eventBatch: eventAccounts.eventBatch,
          })
          .transaction()
      )
    );
  }

  async updateReputation(handle: string, reputationDelta: number, trustDelta: number, reason: string) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);

    return this.program.methods
      .updateReputation(reputationDelta, trustDelta, reason)
      .accounts({
        userIdentity: userIdentityPda,
        authority: this.provider.publicKey,
      })
      .rpc();
  }

  async updateSocialStats(handle: string, followerDelta: number, followingDelta: number) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);

    return this.program.methods
      .updateSocialStats(new BN(followerDelta), new BN(followingDelta))
      .accounts({
        userIdentity: userIdentityPda,
        callerProgram: this.provider.publicKey,
      })
      .rpc();
  }

  async updateEconomicStats(handle: string, earnedDelta: number, spentDelta: number) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);

    return this.program.methods
      .updateEconomicStats(new BN(earnedDelta), new BN(spentDelta))
      .accounts({
        userIdentity: userIdentityPda,
        callerProgram: this.provider.publicKey,
      })
      .rpc();
  }

  async updateContentStats(handle: string, contentCreatedDelta: number, interactionsDelta: number, qualityScore: number) {
    const registry = this.pda.findIdentityRegistryPda("social_hub_identity");
    const userIdentityPda = this.pda.findUserIdentityPda(registry, handle);

    return this.program.methods
      .updateContentStats(new BN(contentCreatedDelta), new BN(interactionsDelta), qualityScore)
      .accounts({
        userIdentity: userIdentityPda,
        callerProgram: this.provider.publicKey,
      })
      .rpc();
  }

  async followUser(followed: PublicKey) {
    return this.accessModule.followUser(followed);
  }

  async unfollowUser(followed: PublicKey) {
    return this.accessModule.unfollowUser(followed);
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
    const [eventBatch] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_batch"), eventSequence.toArrayLike(Buffer, "le", 8)],
      eventProgram
    );

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

  private async withResolvedEventAccountsRetry<T>(
    operation: (eventAccounts: {
      eventProgram: PublicKey;
      eventEmitter: PublicKey;
      eventBatch: PublicKey;
    }) => Promise<T>
  ): Promise<T> {
    return withEventBatchSeedRetry(async () => {
      const eventAccounts = await this.resolveEventAccounts();
      return operation(eventAccounts);
    });
  }
}

function toIdentityUpdatePayload(updates: any) {
  const valueOrNull = (camelKey: string, snakeKey: string) => {
    if (Object.prototype.hasOwnProperty.call(updates ?? {}, camelKey)) {
      return updates[camelKey] ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(updates ?? {}, snakeKey)) {
      return updates[snakeKey] ?? null;
    }
    return null;
  };

  return {
    displayName: valueOrNull("displayName", "display_name"),
    bio: valueOrNull("bio", "bio"),
    avatarUri: valueOrNull("avatarUri", "avatar_uri"),
    bannerUri: valueOrNull("bannerUri", "banner_uri"),
    website: valueOrNull("website", "website"),
    location: valueOrNull("location", "location"),
    metadataUri: valueOrNull("metadataUri", "metadata_uri"),
    customAttributes: valueOrNull("customAttributes", "custom_attributes"),
  };
}
