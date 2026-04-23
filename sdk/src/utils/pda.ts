import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export const SEEDS = {
  IDENTITY_REGISTRY: Buffer.from("identity_registry"),
  USER_IDENTITY: Buffer.from("user_identity"),
  HANDLE_MAPPING: Buffer.from("handle_mapping"),
  CONTENT_MANAGER: Buffer.from("content_manager"),
  CONTENT_POST: Buffer.from("content_post"),
  CONTENT_V2_ANCHOR: Buffer.from("content_v2_anchor"),
  ACCESS_CONTROLLER: Buffer.from("access_controller"),
  ACCESS_RULE: Buffer.from("access_rule"),
  PERMISSION_TEMPLATE: Buffer.from("permission_template"),
  FOLLOW_RELATIONSHIP: Buffer.from("follow"),
  CIRCLE: Buffer.from("circle"),
  CIRCLE_MEMBER: Buffer.from("circle_member"),
  KNOWLEDGE_BINDING: Buffer.from("knowledge_binding"),
  PROOF_ATTESTOR_REGISTRY: Buffer.from("proof_attestor_registry"),
  EVENT_EMITTER: Buffer.from("event_emitter"),
  EVENT_BATCH: Buffer.from("event_batch"),
  EVENT_SUBSCRIPTION: Buffer.from("event_subscription"),
  REGISTRY_FACTORY: Buffer.from("registry_factory"),
  DEPLOYED_REGISTRY: Buffer.from("deployed_registry"),
};

export class PdaUtils {
  constructor(
    private programIds: {
      identity: PublicKey;
      content: PublicKey;
      access: PublicKey;
      event: PublicKey;
      factory: PublicKey;
      circles: PublicKey;
    }
  ) {}

  getIdentityProgramId(): PublicKey {
    return this.programIds.identity;
  }

  getContentProgramId(): PublicKey {
    return this.programIds.content;
  }

  getAccessProgramId(): PublicKey {
    return this.programIds.access;
  }

  getEventProgramId(): PublicKey {
    return this.programIds.event;
  }

  getFactoryProgramId(): PublicKey {
    return this.programIds.factory;
  }

  getCirclesProgramId(): PublicKey {
    return this.programIds.circles;
  }

  // Identity Registry PDAs
  findIdentityRegistryPda(name: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.IDENTITY_REGISTRY, Buffer.from(name)],
      this.programIds.identity
    )[0];
  }

  findUserIdentityPda(registry: PublicKey, handle: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.USER_IDENTITY, registry.toBuffer(), Buffer.from(handle)],
      this.programIds.identity
    )[0];
  }

  findHandleMappingPda(handle: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.HANDLE_MAPPING, Buffer.from(handle)],
      this.programIds.identity
    )[0];
  }

  // Content Manager PDAs
  findContentManagerPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.CONTENT_MANAGER],
      this.programIds.content
    )[0];
  }

  findContentPostPda(author: PublicKey, contentId: BN): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        SEEDS.CONTENT_POST,
        author.toBuffer(),
        contentId.toArrayLike(Buffer, "le", 8),
      ],
      this.programIds.content
    )[0];
  }

  findContentId(author: PublicKey, contentId: BN): string {
    return this.findContentPostPda(author, contentId).toBase58();
  }

  findContentV2AnchorPda(author: PublicKey, contentId: BN): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        SEEDS.CONTENT_V2_ANCHOR,
        author.toBuffer(),
        contentId.toArrayLike(Buffer, "le", 8),
      ],
      this.programIds.content
    )[0];
  }

  findContentStatsPda(contentPost: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("content_stats"), contentPost.toBuffer()],
      this.programIds.content
    )[0];
  }

  findContentStoragePda(contentPost: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("content_storage"), contentPost.toBuffer()],
      this.programIds.content
    )[0];
  }

  // Access Controller PDAs
  findAccessControllerPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.ACCESS_CONTROLLER],
      this.programIds.access
    )[0];
  }

  findAccessRulePda(user: PublicKey, ruleId: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.ACCESS_RULE, user.toBuffer(), Buffer.from(ruleId)],
      this.programIds.access
    )[0];
  }

  findFollowRelationshipPda(follower: PublicKey, followed: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.FOLLOW_RELATIONSHIP, follower.toBuffer(), followed.toBuffer()],
      this.programIds.access
    )[0];
  }

  findCirclePda(circleId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.CIRCLE, Buffer.from([circleId & 0xff])],
      this.programIds.circles
    )[0];
  }

  findCircleMemberPda(circleId: number, member: PublicKey): PublicKey {
    const circle = this.findCirclePda(circleId);
    return PublicKey.findProgramAddressSync(
      [SEEDS.CIRCLE_MEMBER, circle.toBuffer(), member.toBuffer()],
      this.programIds.circles
    )[0];
  }

  findKnowledgeBindingPda(knowledge: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.KNOWLEDGE_BINDING, knowledge.toBuffer()],
      this.programIds.circles
    )[0];
  }

  findProofAttestorRegistryPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.PROOF_ATTESTOR_REGISTRY],
      this.programIds.circles
    )[0];
  }

  // Event Emitter PDAs
  findEventEmitterPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.EVENT_EMITTER],
      this.programIds.event
    )[0];
  }

  findEventBatchPda(eventSequence: BN): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.EVENT_BATCH, eventSequence.toArrayLike(Buffer, "le", 8)],
      this.programIds.event
    )[0];
  }

  findEventSubscriptionPda(subscriber: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.EVENT_SUBSCRIPTION, subscriber.toBuffer()],
      this.programIds.event
    )[0];
  }

  // Registry Factory PDAs
  findRegistryFactoryPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.REGISTRY_FACTORY],
      this.programIds.factory
    )[0];
  }

  findDeployedRegistryPda(name: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SEEDS.DEPLOYED_REGISTRY, Buffer.from(name)],
      this.programIds.factory
    )[0];
  }
}
