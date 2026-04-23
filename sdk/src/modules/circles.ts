import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import { sendTransactionWithAlreadyProcessedRecovery } from "../utils/transactions";
import * as idl from "../idl/circle_manager.json";
import * as eventEmitterIdl from "../idl/event_emitter.json";
import { Idl } from "@coral-xyz/anchor";
import { sha256 } from "js-sha256";

export type CircleManagerIdl = Idl;

// 类型定义
export type TransferType = "Upward" | "Downward" | "Horizontal";
export type ProposalStatus = "Pending" | "Approved" | "Rejected" | "AIProcessing" | "HumanReview" | "Executed";
export type AIRecommendation = "ApproveUpward" | "ApproveDownward" | "Reject" | "NeedHumanReview";
export type MemberRole = "Owner" | "Admin" | "Moderator" | "Member";
export type PermissionRule = 
  | { everyone: {} }
  | { members: {} }
  | { moderators: {} }
  | { curators: {} }
  | { tokenGated: { tokenMint: PublicKey, minAmount: BN } }
  | { reputationGated: { minScore: BN } };

export interface KnowledgeGovernance {
  minQualityScore: number;
  minCuratorReputation: number;
  transferCooldown: BN;
  maxTransfersPerDay: number;
  requirePeerReview: boolean;
  peerReviewCount: number;
  autoQualityCheck: boolean;
}

export type DecisionEngine =
  | { adminOnly: { admin: PublicKey } }
  | { votingGovernance: { minVotes: BN, voteDuration: BN, quorumPercentage: number } }
  | { daoGovernance: { daoProgram: PublicKey, proposalThreshold: BN } }
  | { aiAssisted: { aiOracle: PublicKey, humanVetoThreshold: BN, confidenceRequired: number } }
  | { fullyAutonomous: { aiModelHash: number[], mcpEndpoint: string, fallbackToDao: boolean } };

export interface AIEvaluation {
  qualityScore: number;
  relevanceScore: number;
  noveltyScore: number;
  recommendation: AIRecommendation;
  confidence: number;
  reasoning: string;
  modelVersion: string;
  timestamp: BN;
}

export interface CreateCircleParams {
  circleId: number;
  name: string;
  level: number;
  parentCircle?: number;
  knowledgeGovernance: KnowledgeGovernance;
  decisionEngine: DecisionEngine;
}

export interface AnchorCircleForkParams {
  sourceCircleId: number;
  targetCircleId: number;
  forkDeclarationDigest: Uint8Array | number[] | string;
}

export interface SubmitKnowledgeParams {
  circleId: number;
  knowledgePda?: PublicKey;
  ipfsCid: string;
  contentHash: Uint8Array | number[] | string;
  title: string;
  description: string;
}

export interface UpdateKnowledgeContributorsParams {
  circleId: number;
  knowledgePda: PublicKey;
  proofPackageHash: Uint8Array | number[] | string;
  contributorsRoot: Uint8Array | number[] | string;
  contributorsCount: number;
}

export interface BindContributorProofParams {
  circleId: number;
  knowledgePda: PublicKey;
  sourceAnchorId: Uint8Array | number[] | string;
  proofPackageHash: Uint8Array | number[] | string;
  contributorsRoot: Uint8Array | number[] | string;
  contributorsCount: number;
  bindingVersion: number;
  generatedAt: string | number | Date;
  issuerKeyId: PublicKey | string;
  issuedSignature: Uint8Array | number[] | string;
}

export interface ProposeTransferParams {
  knowledgeId: Uint8Array;
  fromCircle: number;
  toCircles: number[];
  transferType: TransferType;
}

export type CircleMembershipAdmissionKind = "Open" | "Invite" | "Approval";

export interface ClaimCircleMembershipParams {
  circleId: number;
  role: "Member";
  kind: CircleMembershipAdmissionKind;
  artifactId?: number;
  issuedAt: string | number | Date;
  expiresAt: string | number | Date;
  issuerKeyId: PublicKey | string;
  issuedSignature: Uint8Array | number[] | string;
}

const KNOWLEDGE_TITLE_MAX_BYTES = 128;
const KNOWLEDGE_DESCRIPTION_MAX_BYTES = 256;

function clampUtf8ToByteLimit(input: string, maxBytes: number): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";

  let result = "";
  let usedBytes = 0;
  for (const char of trimmed) {
    const nextBytes = Buffer.byteLength(char, "utf8");
    if (usedBytes + nextBytes > maxBytes) break;
    result += char;
    usedBytes += nextBytes;
  }
  return result;
}

export class CirclesModule extends BaseModule<CircleManagerIdl> {
  private eventProgram: Program<Idl>;

  constructor(provider: any, programId: PublicKey, pda: any) {
    super(provider, programId, pda, idl as unknown as CircleManagerIdl);
    this.eventProgram = new Program(eventEmitterIdl as unknown as Idl, provider) as unknown as Program<Idl>;
  }

  /**
   * 初始化圈层管理器
   */
  async initialize(): Promise<string> {
    const [managerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      this.programId
    );

    const tx = await this.program.methods
      .initialize()
      .accounts({
        circleManager: managerPDA,
        admin: this.provider.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * 创建圈层
   */
  async createCircle(params: CreateCircleParams): Promise<string> {
    const [circlePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([params.circleId])],
      this.programId
    );

    const [managerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      this.programId
    );
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
      this.program.methods
        .createCircle(
          params.circleId,
          params.name,
          params.level,
          params.parentCircle ?? null,
          this.encodeKnowledgeGovernance(params.knowledgeGovernance),
          this.encodeDecisionEngine(params.decisionEngine)
        )
        .accounts({
          circle: circlePDA,
          circleManager: managerPDA,
          creator: this.provider.publicKey,
          eventProgram: eventAccounts.eventProgram,
          eventEmitter: eventAccounts.eventEmitter,
          eventBatch: eventAccounts.eventBatch,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
    );

    return tx;
  }

  async updateCircleFlags(circleId: number, flags: BN): Promise<string> {
    const circlePDA = this.findCirclePda(circleId);
    const eventAccounts = await this.resolveEventAccounts();

    return sendTransactionWithAlreadyProcessedRecovery(this.provider, async () =>
      this.program.methods
        .updateCircleFlags(flags)
        .accounts({
          circle: circlePDA,
          authority: this.provider.publicKey,
          eventProgram: eventAccounts.eventProgram,
          eventEmitter: eventAccounts.eventEmitter,
          eventBatch: eventAccounts.eventBatch,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
    );
  }

  async anchorCircleFork(params: AnchorCircleForkParams): Promise<string> {
    if (!Number.isInteger(params.sourceCircleId) || params.sourceCircleId < 0 || params.sourceCircleId > 255) {
      throw new Error("sourceCircleId must be an integer between 0 and 255");
    }
    if (!Number.isInteger(params.targetCircleId) || params.targetCircleId < 0 || params.targetCircleId > 255) {
      throw new Error("targetCircleId must be an integer between 0 and 255");
    }

    const sourceCirclePda = this.findCirclePda(params.sourceCircleId);
    const targetCirclePda = this.findCirclePda(params.targetCircleId);
    const [forkAnchorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_fork_anchor"), Buffer.from([params.targetCircleId])],
      this.programId
    );
    const discriminator = Buffer.from(
      sha256.array(Buffer.from("global:anchor_circle_fork", "utf8")).slice(0, 8)
    );
    const instructionData = Buffer.concat([
      discriminator,
      Buffer.from([params.sourceCircleId]),
      Buffer.from([params.targetCircleId]),
      Buffer.from(this.normalizeContentHash(params.forkDeclarationDigest)),
    ]);

    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: sourceCirclePda, isSigner: false, isWritable: false },
        { pubkey: targetCirclePda, isSigner: false, isWritable: false },
        { pubkey: forkAnchorPda, isSigner: false, isWritable: true },
        { pubkey: this.provider.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    return this.provider.sendAndConfirm(new Transaction().add(instruction), []);
  }

  /**
   * 添加策展人
   */
  async addCurator(circleId: number, curator: PublicKey): Promise<string> {
    const [circlePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([circleId])],
      this.programId
    );

    const tx = await this.program.methods
      .addCurator(curator)
      .accounts({
        circle: circlePDA,
        accessController: this.pda.findAccessControllerPda(),
        authority: this.provider.publicKey,
      })
      .rpc();

    return tx;
  }

  async joinCircle(circleId: number): Promise<string> {
    const circlePDA = this.findCirclePda(circleId);
    const circleMemberPda = this.findCircleMemberPda(circleId, this.provider.publicKey);
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await this.program.methods
      .joinCircle()
      .accounts({
        circle: circlePDA,
        circleMember: circleMemberPda,
        member: this.provider.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async leaveCircle(circleId: number): Promise<string> {
    const circlePDA = this.findCirclePda(circleId);
    const circleMemberPda = this.findCircleMemberPda(circleId, this.provider.publicKey);
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await this.program.methods
      .leaveCircle()
      .accounts({
        circle: circlePDA,
        circleMember: circleMemberPda,
        member: this.provider.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async addCircleMember(circleId: number, member: PublicKey, role: MemberRole = "Member"): Promise<string> {
    const circlePDA = this.findCirclePda(circleId);
    const circleMemberPda = this.findCircleMemberPda(circleId, member);
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await this.program.methods
      .addCircleMember(this.encodeCircleMemberRole(role))
      .accounts({
        circle: circlePDA,
        circleMember: circleMemberPda,
        authority: this.provider.publicKey,
        member,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async removeCircleMember(circleId: number, member: PublicKey): Promise<string> {
    const circlePDA = this.findCirclePda(circleId);
    const circleMemberPda = this.findCircleMemberPda(circleId, member);
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await this.program.methods
      .removeCircleMember()
      .accounts({
        circle: circlePDA,
        circleMember: circleMemberPda,
        authority: this.provider.publicKey,
        member,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async updateCircleMemberRole(circleId: number, member: PublicKey, role: MemberRole): Promise<string> {
    const circlePDA = this.findCirclePda(circleId);
    const circleMemberPda = this.findCircleMemberPda(circleId, member);
    const eventAccounts = await this.resolveEventAccounts();
    const instructionData = Buffer.concat([
      this.buildInstructionDiscriminator("update_circle_member_role"),
      Buffer.from([this.encodeCircleMemberRoleIndex(role)]),
    ]);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: circlePDA, isSigner: false, isWritable: false },
        { pubkey: circleMemberPda, isSigner: false, isWritable: true },
        { pubkey: this.provider.publicKey, isSigner: true, isWritable: true },
        { pubkey: member, isSigner: false, isWritable: false },
        { pubkey: eventAccounts.eventProgram, isSigner: false, isWritable: false },
        { pubkey: eventAccounts.eventEmitter, isSigner: false, isWritable: true },
        { pubkey: eventAccounts.eventBatch, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    return this.provider.sendAndConfirm(new Transaction().add(instruction), []);
  }

  async claimCircleMembership(params: ClaimCircleMembershipParams): Promise<string> {
    const [circleManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      this.programId,
    );
    const circlePDA = this.findCirclePda(params.circleId);
    const circleMemberPda = this.findCircleMemberPda(params.circleId, this.provider.publicKey);
    const eventAccounts = await this.resolveEventAccounts();
    const issuerKey = this.normalizePubkey(params.issuerKeyId);
    const issuedSignature = this.normalizeSignature(params.issuedSignature);
    const artifactId = Math.max(0, Math.floor(Number(params.artifactId || 0)));
    const issuedAt = this.toUnixSeconds(params.issuedAt);
    const expiresAt = this.toUnixSeconds(params.expiresAt);
    const digest = this.buildMembershipAdmissionDigest({
      circleId: params.circleId,
      member: this.provider.publicKey,
      role: params.role,
      kind: params.kind,
      artifactId,
      issuedAt,
      expiresAt,
    });
    const ed25519Verification = Ed25519Program.createInstructionWithPublicKey({
      publicKey: issuerKey.toBytes(),
      message: Buffer.from(digest),
      signature: Buffer.from(issuedSignature),
    });
    const instructionData = Buffer.concat([
      this.buildInstructionDiscriminator("claim_circle_membership"),
      Buffer.from([params.circleId]),
      this.provider.publicKey.toBuffer(),
      Buffer.from([this.encodeCircleMemberRoleIndex(params.role)]),
      Buffer.from([this.encodeCircleMembershipAdmissionKindIndex(params.kind)]),
      this.toU64LE(artifactId),
      this.toI64LE(issuedAt),
      this.toI64LE(expiresAt),
      issuerKey.toBuffer(),
      Buffer.from(issuedSignature),
    ]);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: circleManagerPda, isSigner: false, isWritable: false },
        { pubkey: circlePDA, isSigner: false, isWritable: false },
        { pubkey: circleMemberPda, isSigner: false, isWritable: true },
        { pubkey: this.provider.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: eventAccounts.eventProgram, isSigner: false, isWritable: false },
        { pubkey: eventAccounts.eventEmitter, isSigner: false, isWritable: true },
        { pubkey: eventAccounts.eventBatch, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    return this.provider.sendAndConfirm(
      new Transaction().add(ed25519Verification, instruction),
      [],
    );
  }

  /**
   * 提交知识到圈层
   */
  async submitKnowledge(params: SubmitKnowledgeParams): Promise<string> {
    if (!Number.isInteger(params.circleId) || params.circleId < 0 || params.circleId > 255) {
      throw new Error("circleId must be an integer between 0 and 255");
    }
    const circlePDA = this.findCirclePda(params.circleId);
    const knowledgePDA = params.knowledgePda ?? await this.predictNextKnowledgePda(params.circleId);
    const normalizedTitle = clampUtf8ToByteLimit(params.title, KNOWLEDGE_TITLE_MAX_BYTES);
    const normalizedDescription = clampUtf8ToByteLimit(params.description, KNOWLEDGE_DESCRIPTION_MAX_BYTES);

    const [managerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      this.programId
    );
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await this.program.methods
      .submitKnowledge(
        params.ipfsCid,
        this.normalizeContentHash(params.contentHash),
        normalizedTitle,
        normalizedDescription
      )
      .accounts({
        knowledge: knowledgePDA,
        circle: circlePDA,
        circleManager: managerPDA,
        author: this.provider.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async predictNextKnowledgePda(circleId: number): Promise<PublicKey> {
    const circlePDA = this.findCirclePda(circleId);
    const circle = await this.getCircle(circleId);
    const knowledgeCount = this.toBN(circle.knowledgeCount);

    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("knowledge"),
        circlePDA.toBuffer(),
        Buffer.from(knowledgeCount.toArray("le", 8))
      ],
      this.programId
    )[0];
  }

  async initializeProofAttestorRegistry(): Promise<string> {
    const registryPda = this.pda.findProofAttestorRegistryPda();
    const [circleManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      this.programId,
    );
    const tx = await (this.program.methods as any)
      .initializeProofAttestorRegistry()
      .accounts({
        proofAttestorRegistry: registryPda,
        circleManager: circleManagerPda,
        admin: this.provider.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return tx;
  }

  async registerProofAttestor(attestor: PublicKey): Promise<string> {
    const registryPda = this.pda.findProofAttestorRegistryPda();
    const eventAccounts = await this.resolveEventAccounts();
    const tx = await (this.program.methods as any)
      .registerProofAttestor(attestor)
      .accounts({
        proofAttestorRegistry: registryPda,
        admin: this.provider.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return tx;
  }

  async bindContributorProof(params: BindContributorProofParams): Promise<string> {
    this.validateContributorsInput(params.circleId, params.contributorsCount);

    const circlePDA = this.findCirclePda(params.circleId);
    const knowledgeBindingPda = this.pda.findKnowledgeBindingPda(params.knowledgePda);
    const proofAttestorRegistry = this.pda.findProofAttestorRegistryPda();
    const eventAccounts = await this.resolveEventAccounts();
    const issuerKey = this.normalizePubkey(params.issuerKeyId);
    const sourceAnchorId = this.normalizeContentHash(params.sourceAnchorId);
    const proofPackageHash = this.normalizeContentHash(params.proofPackageHash);
    const contributorsRoot = this.normalizeContentHash(params.contributorsRoot);
    const generatedAt = this.toUnixSeconds(params.generatedAt);
    const issuedSignature = this.normalizeSignature(params.issuedSignature);
    const bindingDigest = this.buildProofBindingDigest({
      sourceAnchorId,
      proofPackageHash,
      contributorsRoot,
      contributorsCount: params.contributorsCount,
      bindingVersion: params.bindingVersion,
      generatedAt,
    });
    // Contract verification reads instructions_sysvar[current_index - 1].
    // Keep ed25519 verify as the immediate previous instruction.
    const ed25519Verification = Ed25519Program.createInstructionWithPublicKey({
      publicKey: issuerKey.toBytes(),
      message: Buffer.from(bindingDigest),
      signature: Buffer.from(issuedSignature),
    });

    let methodBuilder = (this.program.methods as any)
      .bindContributorProof(
        sourceAnchorId,
        proofPackageHash,
        contributorsRoot,
        params.contributorsCount,
        params.bindingVersion,
        new BN(generatedAt),
        issuerKey,
        issuedSignature,
      )
      .accounts({
        knowledge: params.knowledgePda,
        circle: circlePDA,
        knowledgeBinding: knowledgeBindingPda,
        proofAttestorRegistry,
        authority: this.provider.publicKey,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Verification]);
    const tx = await methodBuilder.rpc();

    return tx;
  }

  async bindAndUpdateContributors(params: BindContributorProofParams): Promise<string> {
    this.validateContributorsInput(params.circleId, params.contributorsCount);

    const circlePDA = this.findCirclePda(params.circleId);
    const knowledgeBindingPda = this.pda.findKnowledgeBindingPda(params.knowledgePda);
    const proofAttestorRegistry = this.pda.findProofAttestorRegistryPda();
    const eventAccounts = await this.resolveEventAccounts();
    const issuerKey = this.normalizePubkey(params.issuerKeyId);
    const sourceAnchorId = this.normalizeContentHash(params.sourceAnchorId);
    const proofPackageHash = this.normalizeContentHash(params.proofPackageHash);
    const contributorsRoot = this.normalizeContentHash(params.contributorsRoot);
    const generatedAt = this.toUnixSeconds(params.generatedAt);
    const issuedSignature = this.normalizeSignature(params.issuedSignature);
    const bindingDigest = this.buildProofBindingDigest({
      sourceAnchorId,
      proofPackageHash,
      contributorsRoot,
      contributorsCount: params.contributorsCount,
      bindingVersion: params.bindingVersion,
      generatedAt,
    });
    // Contract verification reads instructions_sysvar[current_index - 1].
    // Keep ed25519 verify as the immediate previous instruction.
    const ed25519Verification = Ed25519Program.createInstructionWithPublicKey({
      publicKey: issuerKey.toBytes(),
      message: Buffer.from(bindingDigest),
      signature: Buffer.from(issuedSignature),
    });

    let methodBuilder = (this.program.methods as any)
      .bindAndUpdateContributors(
        sourceAnchorId,
        proofPackageHash,
        contributorsRoot,
        params.contributorsCount,
        params.bindingVersion,
        new BN(generatedAt),
        issuerKey,
        issuedSignature,
      )
      .accounts({
        knowledge: params.knowledgePda,
        circle: circlePDA,
        knowledgeBinding: knowledgeBindingPda,
        proofAttestorRegistry,
        authority: this.provider.publicKey,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Verification]);
    const tx = await methodBuilder.rpc();

    return tx;
  }

  async updateContributors(params: UpdateKnowledgeContributorsParams): Promise<string> {
    this.validateContributorsInput(params.circleId, params.contributorsCount);
    const circlePDA = this.findCirclePda(params.circleId);
    const knowledgeBindingPda = this.pda.findKnowledgeBindingPda(params.knowledgePda);
    const eventAccounts = await this.resolveEventAccounts();

    const tx = await (this.program.methods as any)
      .updateContributors(
        this.normalizeContentHash(params.proofPackageHash),
        this.normalizeContentHash(params.contributorsRoot),
        params.contributorsCount,
      )
      .accounts({
        knowledge: params.knowledgePda,
        circle: circlePDA,
        knowledgeBinding: knowledgeBindingPda,
        authority: this.provider.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * 提议知识传递
   */
  async proposeTransfer(params: ProposeTransferParams): Promise<string> {
    const [circlePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([params.fromCircle])],
      this.programId
    );

    const circle = await this.getCircle(params.fromCircle);
    const knowledgeCount = circle.knowledgeCount.toNumber();

    const [proposalPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        circlePDA.toBuffer(),
        Buffer.from(new BN(knowledgeCount).toArray("le", 8))
      ],
      this.programId
    );

    const [knowledgePDA] = await this.findKnowledgePDA(params.knowledgeId);

    const tx = await this.program.methods
      .proposeTransfer(
        Array.from(params.knowledgeId),
        params.toCircles,
        { [params.transferType.toLowerCase()]: {} }
      )
      .accounts({
        proposal: proposalPDA,
        knowledge: knowledgePDA,
        circle: circlePDA,
        proposer: this.provider.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * 投票
   */
  async vote(proposalPDA: PublicKey, voteFor: boolean): Promise<string> {
    const proposal = await this.getProposal(proposalPDA);
    
    const [circlePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([proposal.fromCircle])],
      this.programId
    );

    const tx = await this.program.methods
      .vote(voteFor)
      .accounts({
        proposal: proposalPDA,
        circle: circlePDA,
        voter: this.provider.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * AI提交评估
   */
  async submitAIEvaluation(proposalPDA: PublicKey, evaluation: AIEvaluation): Promise<string> {
    const proposal = await this.getProposal(proposalPDA);
    
    const [circlePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([proposal.fromCircle])],
      this.programId
    );

    const tx = await this.program.methods
      .submitAiEvaluation({
        qualityScore: evaluation.qualityScore,
        relevanceScore: evaluation.relevanceScore,
        noveltyScore: evaluation.noveltyScore,
        recommendation: { [evaluation.recommendation.toLowerCase()]: {} },
        confidence: evaluation.confidence,
        reasoning: evaluation.reasoning,
        modelVersion: evaluation.modelVersion,
        timestamp: new BN(evaluation.timestamp),
      })
      .accounts({
        proposal: proposalPDA,
        circle: circlePDA,
        aiOracle: this.provider.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * 执行传递
   */
  async executeTransfer(proposalPDA: PublicKey, toCircleId: number): Promise<string> {
    const proposal = await this.getProposal(proposalPDA);
    // @ts-ignore
    const originalKnowledge = await this.program.account.knowledge.fetch(proposal.knowledgeId);
    
    const [fromCirclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([proposal.fromCircle])],
      this.programId
    );

    const [toCirclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([toCircleId])],
      this.programId
    );

    const toCircle = await this.getCircle(toCircleId);
    const knowledgeCount = toCircle.knowledgeCount.toNumber();

    const [transferredKnowledgePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("knowledge"),
        toCirclePDA.toBuffer(),
        Buffer.from(new BN(knowledgeCount).toArray("le", 8))
      ],
      this.programId
    );

    const [managerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      this.programId
    );

    const tx = await this.program.methods
      .executeTransfer()
      .accounts({
        proposal: proposalPDA,
        fromCircle: fromCirclePDA,
        transferredKnowledge: transferredKnowledgePDA,
        toCircle: toCirclePDA,
        originalKnowledge: proposal.knowledgeId,
        circleManager: managerPDA,
        executor: this.provider.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * 更新决策引擎
   */
  async updateDecisionEngine(circleId: number, newEngine: DecisionEngine): Promise<string> {
    const [circlePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([circleId])],
      this.programId
    );

    const tx = await this.program.methods
      .updateDecisionEngine(this.encodeDecisionEngine(newEngine))
      .accounts({
        circle: circlePDA,
        authority: this.provider.publicKey,
      })
      .rpc();

    return tx;
  }

  // 查询方法
  async getCircle(circleId: number) {
    const circlePDA = this.findCirclePda(circleId);
    // @ts-ignore
    return await this.program.account.circle.fetch(circlePDA);
  }

  async getProposal(proposalPDA: PublicKey) {
    // @ts-ignore
    return await this.program.account.transferProposal.fetch(proposalPDA);
  }

  async getKnowledge(knowledgePDA: PublicKey) {
    // @ts-ignore
    return await this.program.account.knowledge.fetch(knowledgePDA);
  }

  // 辅助方法
  private findCirclePda(circleId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("circle"), Buffer.from([circleId])],
      this.programId
    )[0];
  }

  private findCircleMemberPda(circleId: number, member: PublicKey): PublicKey {
    const circlePDA = this.findCirclePda(circleId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("circle_member"), circlePDA.toBuffer(), member.toBuffer()],
      this.programId,
    )[0];
  }

  private async findKnowledgePDA(knowledgeId: Uint8Array): Promise<[PublicKey, number]> {
    // 简化实现：需要遍历所有knowledge账户找到匹配的
    // 实际应用中应该建立索引
    return PublicKey.findProgramAddressSync(
      [Buffer.from("knowledge"), Buffer.from(knowledgeId)],
      this.programId
    );
  }

  private encodeKnowledgeGovernance(governance: KnowledgeGovernance): any {
    return {
      minQualityScore: governance.minQualityScore,
      minCuratorReputation: new BN(governance.minCuratorReputation),
      transferCooldown: governance.transferCooldown,
      maxTransfersPerDay: governance.maxTransfersPerDay,
      requirePeerReview: governance.requirePeerReview,
      peerReviewCount: governance.peerReviewCount,
      autoQualityCheck: governance.autoQualityCheck,
    };
  }

  private encodeDecisionEngine(engine: DecisionEngine): any {
    if ("adminOnly" in engine) return { adminOnly: engine.adminOnly };
    if ("votingGovernance" in engine) return { votingGovernance: engine.votingGovernance };
    if ("daoGovernance" in engine) return { daoGovernance: engine.daoGovernance };
    if ("aiAssisted" in engine) return { aiAssisted: engine.aiAssisted };
    if ("fullyAutonomous" in engine) return { fullyAutonomous: engine.fullyAutonomous };
    return { adminOnly: { admin: this.provider.publicKey } };
  }

  private encodeCircleMemberRole(role: MemberRole): any {
    if (role === "Owner") return { owner: {} };
    if (role === "Admin") return { admin: {} };
    if (role === "Moderator") return { moderator: {} };
    return { member: {} };
  }

  private encodeCircleMemberRoleIndex(role: MemberRole): number {
    if (role === "Owner") return 0;
    if (role === "Admin") return 1;
    if (role === "Moderator") return 2;
    return 3;
  }

  private encodeCircleMembershipAdmissionKindIndex(kind: CircleMembershipAdmissionKind): number {
    if (kind === "Invite") return 1;
    if (kind === "Approval") return 2;
    return 0;
  }

  private buildInstructionDiscriminator(name: string): Buffer {
    return Buffer.from(
      sha256.array(Buffer.from(`global:${name}`, "utf8")).slice(0, 8)
    );
  }

  private async resolveEventAccounts(): Promise<{
    eventProgram: PublicKey;
    eventEmitter: PublicKey;
    eventBatch: PublicKey;
  }> {
    const eventProgram = this.eventProgram.programId;
    const eventEmitter = this.pda.findEventEmitterPda();

    // @ts-ignore
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

  private normalizePubkey(value: PublicKey | string): PublicKey {
    if (value instanceof PublicKey) return value;
    return new PublicKey(String(value).trim());
  }

  private normalizeSignature(value: Uint8Array | number[] | string): number[] {
    let values: number[] = [];
    if (typeof value === "string") {
      const normalized = value.startsWith("0x")
        ? value.slice(2)
        : value;
      if (!/^[0-9a-fA-F]{128}$/.test(normalized)) {
        throw new Error("issuedSignature must be a 64-byte hex string");
      }
      for (let i = 0; i < normalized.length; i += 2) {
        values.push(parseInt(normalized.slice(i, i + 2), 16));
      }
    } else {
      values = Array.from(value);
    }
    if (values.length !== 64) {
      throw new Error(`issuedSignature must be 64 bytes, got ${values.length}`);
    }
    return values.map((entry) => {
      if (!Number.isInteger(entry) || entry < 0 || entry > 255) {
        throw new Error("issuedSignature must contain byte values between 0 and 255");
      }
      return entry;
    });
  }

  private buildMembershipAdmissionDigest(input: {
    circleId: number;
    member: PublicKey;
    role: "Member";
    kind: CircleMembershipAdmissionKind;
    artifactId: number;
    issuedAt: number;
    expiresAt: number;
  }): number[] {
    return Array.from(
      Buffer.from(
        sha256.arrayBuffer(
          Buffer.concat([
            Buffer.from("alcheme:membership_admission:v1", "utf8"),
            Buffer.from([input.circleId]),
            input.member.toBuffer(),
            Buffer.from([this.encodeCircleMemberRoleIndex(input.role)]),
            Buffer.from([this.encodeCircleMembershipAdmissionKindIndex(input.kind)]),
            this.toU64LE(input.artifactId),
            this.toI64LE(input.issuedAt),
            this.toI64LE(input.expiresAt),
          ]),
        ),
      ),
    );
  }

  private toU64LE(value: number): Buffer {
    return Buffer.from(new BN(value).toArray("le", 8));
  }

  private toI64LE(value: number): Buffer {
    return Buffer.from(new BN(value).toTwos(64).toArray("le", 8));
  }

  private buildProofBindingDigest(input: {
    sourceAnchorId: number[];
    proofPackageHash: number[];
    contributorsRoot: number[];
    contributorsCount: number;
    bindingVersion: number;
    generatedAt: number;
  }): Uint8Array {
    const domain = Buffer.from("alcheme:proof_binding:v1", "utf8");
    const contributorsCountBuffer = Buffer.alloc(2);
    contributorsCountBuffer.writeUInt16LE(input.contributorsCount, 0);
    const bindingVersionBuffer = Buffer.alloc(2);
    bindingVersionBuffer.writeUInt16LE(input.bindingVersion, 0);
    const generatedAtBuffer = Buffer.alloc(8);
    generatedAtBuffer.writeBigInt64LE(BigInt(input.generatedAt), 0);
    const digest = sha256.array(Buffer.concat([
      domain,
      Buffer.from(input.proofPackageHash),
      Buffer.from(input.contributorsRoot),
      contributorsCountBuffer,
      Buffer.from(input.sourceAnchorId),
      bindingVersionBuffer,
      generatedAtBuffer,
    ]));
    return Uint8Array.from(digest);
  }

  private toUnixSeconds(value: string | number | Date): number {
    if (value instanceof Date) {
      const millis = value.getTime();
      if (Number.isNaN(millis)) throw new Error("generatedAt must be a valid timestamp");
      return Math.floor(millis / 1000);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("generatedAt must be finite");
      return Math.floor(value);
    }
    const millis = new Date(value).getTime();
    if (Number.isNaN(millis)) throw new Error("generatedAt must be a valid timestamp");
    return Math.floor(millis / 1000);
  }

  private validateContributorsInput(circleId: number, contributorsCount: number): void {
    if (!Number.isInteger(circleId) || circleId < 0 || circleId > 255) {
      throw new Error("circleId must be an integer between 0 and 255");
    }
    if (
      !Number.isFinite(contributorsCount)
      || contributorsCount <= 0
      || contributorsCount > 65535
    ) {
      throw new Error("contributorsCount must be between 1 and 65535");
    }
  }

  private normalizeContentHash(contentHash: Uint8Array | number[] | string): number[] {
    let values: number[] = [];

    if (typeof contentHash === "string") {
      const normalized = contentHash.startsWith("0x")
        ? contentHash.slice(2)
        : contentHash;
      if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error("contentHash must be a 32-byte hex string");
      }
      for (let i = 0; i < normalized.length; i += 2) {
        values.push(parseInt(normalized.slice(i, i + 2), 16));
      }
    } else {
      values = Array.from(contentHash);
    }

    if (values.length !== 32) {
      throw new Error(`contentHash must be 32 bytes, got ${values.length}`);
    }

    return values.map((value) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error("contentHash must contain byte values between 0 and 255");
      }
      return value;
    });
  }
}
