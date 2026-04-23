import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import * as idl from "../idl/content_manager.json";
import * as eventEmitterIdl from "../idl/event_emitter.json";
import { Idl } from "@coral-xyz/anchor";
import { sha256 } from "js-sha256"; // Assumes js-sha256 is installed, or use crypto.subtle in browser
import { Buffer } from "buffer";

export type ContentManagerIdl = Idl;

export interface ContentData {
    contentId: BN;
    author: PublicKey;
    contentType: any;
    text: string;
    mediaAttachments: MediaAttachment[];
    metadata: any;
    createdAt: BN;
}

export interface MediaAttachment {
    uri: string;
    fileSize?: BN;
    mimeType?: string;
    mediaType?: string;
    duration?: number;
}

export type ChainContentType =
    | "Text"
    | "Image"
    | "Video"
    | "Audio"
    | "Document"
    | "Link"
    | "Poll"
    | "Event"
    | "Live";

export type ContentType = ChainContentType | "Post" | "Article";

export type VisibilityLevelInput = "Public" | "Followers" | "Friends" | "Private" | "CircleOnly";
export type ContentStatusInput = "Draft" | "Published" | "Archived";

export interface CreateContentParams {
    contentId: BN;
    text: string;
    contentType: ContentType;
    externalUri?: string; // Custom storage URI (Arweave/IPFS/Self-hosted)
    mediaAttachments?: MediaAttachment[];
    tags?: string[];
    identityHandle?: string;
    identityRegistryName?: string;
    visibilityLevel?: VisibilityLevelInput;
    protocolCircleId?: number;
    contentStatus?: ContentStatusInput;
    useV2?: boolean;
    enableV1FallbackOnV2Failure?: boolean;
}

export interface ContentRouteOptions {
    useV2?: boolean;
    enableV1FallbackOnV2Failure?: boolean;
    identityHandle?: string;
    identityRegistryName?: string;
    parentAuthorPubkey?: string;
    originalAuthorPubkey?: string;
    quotedAuthorPubkey?: string;
}

interface TargetPostMetadata {
    authorPubkey: string;
    visibility: string;
    status: string;
    v2AudienceKind: string;
    v2AudienceRef: number | null;
    protocolCircleId: number | null;
    circleOnChainAddress: string | null;
}

export interface UpdateContentV2AnchorParams {
    contentId: BN;
    contentHash: Uint8Array | number[] | string;
    externalUri: string;
    identityHandle: string;
    identityRegistryName?: string;
}

export interface DraftLifecycleAnchorParams {
    draftPostId: BN | number;
    policyProfileDigest: Uint8Array | number[] | string;
}

/**
 * Interface for custom storage providers
 */
export interface StorageProvider {
    uploadFile(file: File | Buffer): Promise<string>;
    name: string;
}

export class ContentModule extends BaseModule<ContentManagerIdl> {
    private static readonly SUPPORTED_V1_EXTERNAL_URI_PREFIXES = [
        "onchain://",
        "arweave://",
        "ipfs://",
        "hybrid://",
    ];
    private static readonly DEFAULT_QUERY_API_BASE_URL = "http://127.0.0.1:4000";

    private storageProvider?: StorageProvider;
    private eventProgram: Program<Idl>;
    private queryApiBaseUrl?: string;

    constructor(provider: any, programId: PublicKey, pda: any, storageProvider?: StorageProvider) {
        super(provider, programId, pda, idl as unknown as ContentManagerIdl);
        this.storageProvider = storageProvider;
        this.eventProgram = new Program(eventEmitterIdl as unknown as Idl, provider) as unknown as Program<Idl>;
    }

    /**
     * Set a custom storage provider (e.g. for self-hosted IPFS or private server)
     */
    setStorageProvider(provider: StorageProvider) {
        this.storageProvider = provider;
    }

    setQueryApiBaseUrl(baseUrl?: string | null) {
        this.queryApiBaseUrl = this.normalizeQueryApiBaseUrl(baseUrl) || undefined;
    }

    /**
     * Uploads a file using the configured storage provider
     */
    async uploadFile(file: File | Buffer): Promise<string> {
        if (!this.storageProvider) {
            throw new Error("No storage provider configured. Use setStorageProvider() or provide externalUri manually.");
        }
        return this.storageProvider.uploadFile(file);
    }

    /**
     * Verifies content integrity by comparing fetched content hash with calculated hash
     * This is crucial for self-hosted or external content to prevent tampering
     */
    async validateContentIntegrity(contentPost: any, fetchedContent: string | Buffer): Promise<boolean> {
        const calculatedHash = this.calculateContractContentHash({
            text: Buffer.isBuffer(fetchedContent) ? fetchedContent.toString("utf8") : fetchedContent,
            contentType: contentPost?.contentType ?? contentPost?.content_type,
            createdAt: contentPost?.createdAt ?? contentPost?.created_at,
            author: contentPost?.authorIdentity ?? contentPost?.author ?? contentPost?.authorPubkey,
            mediaAttachments: contentPost?.mediaAttachments ?? contentPost?.media_attachments ?? [],
        });
        const onChainHash = this.normalizeContentHash(contentPost.contentHash);
        return Buffer.from(calculatedHash).equals(Buffer.from(onChainHash));
    }

    private calculateContractContentHash(input: {
        text: string;
        contentType: unknown;
        createdAt: unknown;
        author: unknown;
        mediaAttachments?: Array<{
            uri?: string;
            fileSize?: unknown;
            file_size?: unknown;
        }>;
    }): number[] {
        const hash = sha256.create();
        hash.update(Buffer.from(String(input.text ?? ""), "utf8"));
        hash.update(Buffer.from([this.resolveContractContentTypeDiscriminant(input.contentType)]));
        hash.update(this.toSignedI64LeBytes(input.createdAt));
        hash.update(this.coercePublicKey(input.author).toBuffer());

        const mediaSizeBytes: number[] = [];
        for (const attachment of Array.isArray(input.mediaAttachments) ? input.mediaAttachments : []) {
            hash.update(Buffer.from(String(attachment?.uri ?? ""), "utf8"));
            const fileSize = attachment?.fileSize ?? attachment?.file_size;
            if (fileSize !== undefined && fileSize !== null) {
                mediaSizeBytes.push(...this.toUnsignedU64LeBytes(fileSize));
            }
        }
        if (mediaSizeBytes.length > 0) {
            hash.update(Buffer.from(mediaSizeBytes));
        }

        return Array.from(Buffer.from(hash.hex(), "hex"));
    }

    private normalizeV1ExternalUri(externalUri?: string | null): string | null {
        if (externalUri === undefined || externalUri === null) {
            return null;
        }

        const normalized = externalUri.trim();
        if (!normalized) {
            throw new Error(
                "externalUri is empty. v1 does not support silent fallback; remove externalUri or provide a supported v1 URI."
            );
        }

        const isSupported = ContentModule.SUPPORTED_V1_EXTERNAL_URI_PREFIXES.some((prefix) =>
            normalized.startsWith(prefix)
        );
        if (!isSupported) {
            throw new Error(
                `externalUri "${normalized}" is not supported in v1. v1 only supports ${ContentModule.SUPPORTED_V1_EXTERNAL_URI_PREFIXES.join(", ")}; private/custom URI must use v2.`
            );
        }

        return normalized;
    }

    createV2ContentId(): BN {
        const timestampMs = new BN(Date.now().toString());
        const entropy = this.randomBits(22);
        let value = timestampMs.ushln(22).add(new BN(entropy));
        const maxSignedU64 = new BN("9223372036854775807");
        value = value.umod(maxSignedU64);
        if (value.isZero()) {
            value = new BN(1);
        }
        return value;
    }

    async getNextV2ContentId(): Promise<BN> {
        // Backward-compatible alias. New v2 write path uses high-entropy content_id
        // to avoid global event-sequence contention under concurrent writes.
        return this.createV2ContentId();
    }

    private randomBits(bits: number): number {
        if (bits <= 0 || bits > 30) {
            throw new Error("random bit width must be in (0, 30]");
        }
        const max = 1 << bits;
        const cryptoObj = (globalThis as any).crypto;
        if (cryptoObj?.getRandomValues) {
            const array = new Uint32Array(1);
            cryptoObj.getRandomValues(array);
            return array[0] % max;
        }
        return Math.floor(Math.random() * max);
    }

    private assertV2OnlyWriteRoute(
        useV2Flag: boolean | undefined,
        fallbackFlag: boolean | undefined,
        operation: string
    ): void {
        if (useV2Flag === false) {
            throw new Error(`${operation}: v1 write path is disabled`);
        }
        if (fallbackFlag === true) {
            throw new Error(`${operation}: v1 fallback is disabled`);
        }
    }

    async createContent(params: CreateContentParams) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            params.useV2,
            params.enableV1FallbackOnV2Failure,
            "createContent"
        );

        try {
            return await this.createContentV2(params, author);
        } catch (error) {
            throw new Error(
                `createContent v2 failed: ${this.extractErrorMessage(error)}`
            );
        }
    }

    private async createContentV1(params: CreateContentParams, author: PublicKey) {
        const {
            contentId,
            text,
            contentType,
            externalUri,
            mediaAttachments = [],
            tags = [],
            identityHandle,
            identityRegistryName = "social_hub_identity",
            visibilityLevel = "Public",
        } = params;
        const normalizedExternalUri = this.normalizeV1ExternalUri(externalUri);

        // Validation: If externalUri is provided for large content types, warn if no hash/integrity check is possible yet
        if (normalizedExternalUri && (contentType === "Video" || contentType === "Audio") && mediaAttachments.length === 0) {
            console.warn("Creating external content without attachments metadata. Integrity verification might be limited.");
        }

        const contentPostPda = this.pda.findContentPostPda(author, contentId);
        const contentStatsPda = this.pda.findContentStatsPda(contentPostPda);
        const contentStoragePda = this.pda.findContentStoragePda(contentPostPda);
        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName,
        });

        const contentTypeVariant = this.toContentTypeVariant(contentType);

        // Struct construction
        const contentData = {
            contentId,
            author,
            contentType: contentTypeVariant,
            text,
            mediaAttachments: mediaAttachments.map((m) => ({
                mediaType: m.mediaType || m.mimeType || "application/octet-stream",
                uri: m.uri,
                fileSize: m.fileSize || null,
                dimensions: null,
                duration: typeof m.duration === "number" ? m.duration : null,
            })),
            metadata: {
                title: null,
                description: null,
                tags,
                language: "zh-CN",
                contentWarning: null,
                expiresAt: null,
            },
            createdAt: new BN(Math.floor(Date.now() / 1000)),
        };

        const metadata = {
            title: null,
            description: null,
            tags,
            language: "zh-CN",
            contentWarning: null,
            expiresAt: null,
        };

        const visibility = this.buildVisibilitySettings(visibilityLevel);

        return this.program.methods
            .createContent(contentId, contentData, contentTypeVariant, metadata, visibility, normalizedExternalUri)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                contentPost: contentPostPda,
                contentStats: contentStatsPda,
                contentStorage: contentStoragePda,
                author: author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    private async createContentV2(params: CreateContentParams, author: PublicKey) {
        const {
            contentId,
            text,
            contentType,
            externalUri,
            mediaAttachments = [],
            tags = [],
            identityHandle,
            identityRegistryName = "social_hub_identity",
            visibilityLevel = "Public",
            protocolCircleId,
            contentStatus = "Published",
        } = params;

        const methods = this.program.methods as any;

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName,
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            author: author.toBase58(),
            text,
            contentType: this.toContentTypeVariant(contentType),
            mediaAttachments,
            tags,
            visibilityLevel,
            protocolCircleId,
            contentStatus,
        });
        const uriRef = this.buildV2UriRef(externalUri, contentId, "content");
        const statusVariant = this.toContentStatusVariant(contentStatus);

        const accounts = {
            contentManager: this.pda.findContentManagerPda(),
            v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
            author,
            identityProgram: accountBundle.identityProgram,
            userIdentity: accountBundle.userIdentity,
            accessProgram: accountBundle.accessProgram,
            accessControllerAccount: accountBundle.accessControllerAccount,
            eventProgram: accountBundle.eventProgram,
            eventEmitterAccount: accountBundle.eventEmitterAccount,
            eventBatch: accountBundle.eventBatch,
            systemProgram: SystemProgram.programId,
        };

        if (visibilityLevel === "CircleOnly") {
            if (!Number.isInteger(protocolCircleId) || Number(protocolCircleId) < 0 || Number(protocolCircleId) > 255) {
                throw new Error("protocolCircleId must be an integer between 0 and 255 for CircleOnly v2 writes");
            }
            if (typeof methods.createContentV2WithAudience !== "function") {
                throw new Error(
                    "createContentV2WithAudience is unavailable in current SDK bindings; CircleOnly v2 writes require upgraded program+IDL"
                );
            }

            return methods
                .createContentV2WithAudience(
                    contentId,
                    contentHash,
                    uriRef,
                    this.toV2AudienceKindVariant(visibilityLevel),
                    protocolCircleId,
                    statusVariant
                )
                .accounts(accounts)
                .rpc();
        }

        const visibilityVariant = this.toAccessLevelVariant(visibilityLevel);

        if (typeof methods.createContentV2WithAccess === "function") {
            return methods
                .createContentV2WithAccess(contentId, contentHash, uriRef, visibilityVariant, statusVariant)
                .accounts(accounts)
                .rpc();
        }

        if (visibilityLevel !== "Public" || contentStatus !== "Published") {
            throw new Error(
                "createContentV2WithAccess is unavailable in current SDK bindings; non-public/non-published v2 writes require upgraded program+IDL"
            );
        }

        if (typeof methods.createContentV2 !== "function") {
            throw new Error("createContentV2 is unavailable in current SDK bindings");
        }

        return methods.createContentV2(contentId, contentHash, uriRef).accounts(accounts).rpc();
    }

    private buildV2UriRef(
        externalUri: string | undefined,
        contentId: BN,
        route: "content" | "reply" | "repost" | "quote"
    ): string {
        const normalized = String(externalUri || "").trim();
        if (normalized) {
            return normalized;
        }

        return `content://${route}/${contentId.toString()}`;
    }

    private buildV2ContentHash(payload: unknown): number[] {
        const hashHex = sha256(JSON.stringify(payload));
        return Array.from(Buffer.from(hashHex, "hex"));
    }

    private toAccessLevelVariant(level: VisibilityLevelInput): any {
        switch (level) {
            case "Public":
                return { public: {} };
            case "Followers":
                return { followers: {} };
            case "Friends":
                return { friends: {} };
            case "Private":
                return { private: {} };
            default:
                throw new Error(`Unsupported visibilityLevel: ${level}`);
        }
    }

    private toV2AudienceKindVariant(level: VisibilityLevelInput): any {
        switch (level) {
            case "Public":
                return { public: {} };
            case "Private":
                return { private: {} };
            case "Followers":
                return { followersOnly: {} };
            case "CircleOnly":
                return { circleOnly: {} };
            default:
                throw new Error(`Unsupported v2 audience kind: ${level}`);
        }
    }

    private toContentStatusVariant(status: ContentStatusInput): any {
        switch (status) {
            case "Draft":
                return { draft: {} };
            case "Published":
                return { published: {} };
            case "Archived":
                return { archived: {} };
            default:
                throw new Error(`Unsupported contentStatus: ${status}`);
        }
    }

    private extractErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    private requireRouteAuthorPubkey(value: string | undefined, operation: string): PublicKey {
        const normalized = String(value || "").trim();
        if (!normalized) {
            throw new Error(`${operation} is required`);
        }
        return new PublicKey(normalized);
    }

    private normalizeQueryApiBaseUrl(value?: string | null): string | null {
        const normalized = String(value || "").trim();
        if (!normalized) {
            return null;
        }

        return normalized
            .replace(/\/graphql\/?$/i, "")
            .replace(/\/+$/, "");
    }

    private resolveQueryApiBaseUrl(): string {
        const explicit = this.normalizeQueryApiBaseUrl(this.queryApiBaseUrl);
        if (explicit) {
            return explicit;
        }

        const env = typeof process !== "undefined" ? process.env : undefined;
        const candidates = [
            env?.ALCHEME_QUERY_API_URL,
            env?.NEXT_PUBLIC_QUERY_API_URL,
            env?.QUERY_API_BASE_URL,
            env?.NEXT_PUBLIC_GRAPHQL_URL,
        ];

        for (const candidate of candidates) {
            const normalized = this.normalizeQueryApiBaseUrl(candidate);
            if (normalized) {
                return normalized;
            }
        }

        return ContentModule.DEFAULT_QUERY_API_BASE_URL;
    }

    private toOptionalInteger(value: unknown): number | null {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return null;
        }

        return parsed;
    }

    private normalizeTargetPostMetadata(payload: any, operation: string): TargetPostMetadata {
        const authorPubkey = String(
            payload?.author?.pubkey
            || payload?.authorPubkey
            || ""
        ).trim();

        if (!authorPubkey) {
            throw new Error(
                `${operation}; auto-lookup did not return author.pubkey`
            );
        }

        return {
            authorPubkey,
            visibility: String(payload?.visibility || "").trim(),
            status: String(payload?.status || "").trim(),
            v2AudienceKind: String(
                payload?.v2AudienceKind
                || payload?.v2AudienceLevel
                || ""
            ).trim(),
            v2AudienceRef: this.toOptionalInteger(
                payload?.v2AudienceRef
            ),
            protocolCircleId: this.toOptionalInteger(
                payload?.protocolCircleId
                ?? payload?.circle?.protocolCircleId
                ?? payload?.circle?.id
            ),
            circleOnChainAddress: (() => {
                const normalized = String(
                    payload?.circleOnChainAddress
                    || payload?.circle?.onChainAddress
                    || ""
                ).trim();
                return normalized || null;
            })(),
        };
    }

    private async lookupTargetPostMetadataByContentId(contentId: string, operation: string): Promise<TargetPostMetadata> {
        if (typeof fetch !== "function") {
            throw new Error(
                `${operation}; auto-lookup requires fetch support or an explicit target author pubkey`
            );
        }

        const queryApiBaseUrl = this.resolveQueryApiBaseUrl();
        const response = await fetch(
            `${queryApiBaseUrl}/api/v1/posts/${encodeURIComponent(contentId)}`
        );
        if (!response.ok) {
            throw new Error(
                `${operation}; auto-lookup failed with query-api status ${response.status}`
            );
        }

        const payload: any = await response.json();
        return this.normalizeTargetPostMetadata(payload, operation);
    }

    private async resolveRouteAuthorPubkey(
        value: string | undefined,
        contentId: BN,
        operation: string
    ): Promise<PublicKey> {
        const normalized = String(value || "").trim();
        if (normalized) {
            return this.requireRouteAuthorPubkey(normalized, operation);
        }

        const metadata = await this.lookupTargetPostMetadataByContentId(contentId.toString(), operation);
        return this.requireRouteAuthorPubkey(metadata.authorPubkey, operation);
    }

    private normalizeAudienceKind(metadata: TargetPostMetadata): string {
        return String(
            metadata.v2AudienceKind
            || metadata.visibility
            || "Public"
        ).trim();
    }

    private async resolveRelationProofAccounts(
        targetIdentifier: string,
        requester: PublicKey,
        operation: string,
        explicitTargetAuthorPubkey?: string,
    ): Promise<{
        targetAuthor: PublicKey;
        targetFollowRelationship: PublicKey;
        targetCircleMembership: PublicKey;
        targetMetadata: TargetPostMetadata;
    }> {
        const targetMetadata = await this.lookupTargetPostMetadataByContentId(targetIdentifier, operation);
        const targetAuthor = explicitTargetAuthorPubkey
            ? this.requireRouteAuthorPubkey(explicitTargetAuthorPubkey, operation)
            : this.requireRouteAuthorPubkey(targetMetadata.authorPubkey, operation);
        const audienceKind = this.normalizeAudienceKind(targetMetadata);
        const requesterKey = requester.toBase58();
        const targetFollowRelationship =
            audienceKind === "FollowersOnly" && requesterKey !== targetAuthor.toBase58()
                ? this.pda.findFollowRelationshipPda(requester, targetAuthor)
                : SystemProgram.programId;
        let targetCircleMembership = SystemProgram.programId;
        if (audienceKind === "CircleOnly") {
            const rawCircleId = targetMetadata.v2AudienceRef ?? targetMetadata.protocolCircleId;
            if (
                typeof rawCircleId !== "number"
                || !Number.isInteger(rawCircleId)
                || rawCircleId < 0
                || rawCircleId > 255
            ) {
                throw new Error(
                    `${operation}; auto-lookup did not return protocolCircleId/v2AudienceRef for CircleOnly target`
                );
            }
            targetCircleMembership = this.pda.findCircleMemberPda(rawCircleId, requester);
        }

        return {
            targetAuthor,
            targetFollowRelationship,
            targetCircleMembership,
            targetMetadata,
        };
    }

    private async resolveCreateContentAccounts(input: {
        identityHandle?: string;
        identityRegistryName: string;
    }): Promise<{
        identityProgram: PublicKey;
        userIdentity: PublicKey;
        accessProgram: PublicKey;
        accessControllerAccount: PublicKey;
        eventProgram: PublicKey;
        eventEmitterAccount: PublicKey;
        eventBatch: PublicKey;
    }> {
        const identityProgram = this.pda.getIdentityProgramId();
        const accessProgram = this.pda.getAccessProgramId();
        const eventProgram = this.pda.getEventProgramId();

        const handle = String(input.identityHandle || "").trim();
        if (!handle) {
            throw new Error("identityHandle is required for createContent");
        }

        const identityRegistry = this.pda.findIdentityRegistryPda(input.identityRegistryName);
        const userIdentity = this.pda.findUserIdentityPda(identityRegistry, handle);
        const accessControllerAccount = this.pda.findAccessControllerPda();
        const eventEmitterAccount = this.pda.findEventEmitterPda();
        const eventSequence = await this.readCurrentEventSequence(eventEmitterAccount);
        const eventBatch = this.pda.findEventBatchPda(eventSequence);

        return {
            identityProgram,
            userIdentity,
            accessProgram,
            accessControllerAccount,
            eventProgram,
            eventEmitterAccount,
            eventBatch,
        };
    }

    private async readCurrentEventSequence(eventEmitterAccount: PublicKey): Promise<BN> {
        // @ts-ignore - Anchor account namespace is generated from IDL
        const emitterAccount = await this.eventProgram.account.eventEmitterAccount.fetch(eventEmitterAccount);
        const eventSequenceValue =
            emitterAccount?.inner?.eventSequence ??
            emitterAccount?.eventSequence;
        return this.toBN(eventSequenceValue);
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

        throw new Error("Failed to read event sequence from event emitter account");
    }

    private toContentTypeVariant(contentType: ContentType): Record<string, {}> {
        let normalized: ChainContentType;
        switch (contentType) {
            case "Post":
                normalized = "Text";
                break;
            case "Article":
                normalized = "Document";
                break;
            default:
                normalized = contentType;
        }

        const key = normalized.charAt(0).toLowerCase() + normalized.slice(1);
        return { [key]: {} };
    }

    private buildVisibilitySettings(level: VisibilityLevelInput): Record<string, unknown> {
        const visibilityLevel = { [level.charAt(0).toLowerCase() + level.slice(1)]: {} };
        return {
            visibilityLevel,
            quotePermission: { anyone: {} },
            replyPermission: { anyone: {} },
            repostPermission: { anyone: {} },
            commentPermission: { anyone: {} },
        };
    }

    private normalizeContentHash(contentHash: Uint8Array | number[] | string): number[] {
        let values: number[];

        if (typeof contentHash === "string") {
            const normalized = contentHash.startsWith("0x")
                ? contentHash.slice(2)
                : contentHash;
            if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
                throw new Error("contentHash must be a 32-byte hex string");
            }
            values = Array.from(Buffer.from(normalized, "hex"));
        } else {
            values = Array.from(contentHash as Uint8Array | number[]);
        }

        if (values.length !== 32) {
            throw new Error(`contentHash must be 32 bytes, got ${values.length}`);
        }

        for (const value of values) {
            if (!Number.isInteger(value) || value < 0 || value > 255) {
                throw new Error("contentHash must contain byte values between 0 and 255");
            }
        }

        return values;
    }

    private resolveContractContentTypeDiscriminant(contentType: unknown): number {
        if (typeof contentType === "string") {
            switch (contentType.trim()) {
                case "Text":
                    return 0;
                case "Image":
                    return 1;
                case "Video":
                    return 2;
                case "Audio":
                    return 3;
                case "Document":
                    return 4;
                case "Link":
                    return 5;
                case "Poll":
                    return 6;
                case "Event":
                    return 7;
                case "Live":
                    return 8;
                default:
                    break;
            }
        }

        if (contentType && typeof contentType === "object") {
            const variant = Object.keys(contentType as Record<string, unknown>)[0];
            if (variant) {
                return this.resolveContractContentTypeDiscriminant(
                    variant.charAt(0).toUpperCase() + variant.slice(1)
                );
            }
        }

        throw new Error(`Unsupported contract contentType: ${String(contentType ?? "")}`);
    }

    private toSignedI64LeBytes(value: unknown): Buffer {
        const bytes = Buffer.alloc(8);
        bytes.writeBigInt64LE(this.toBigInt(value));
        return bytes;
    }

    private toUnsignedU64LeBytes(value: unknown): Buffer {
        const bytes = Buffer.alloc(8);
        const normalized = this.toBigInt(value);
        if (normalized < 0n) {
            throw new Error("u64 value must be non-negative");
        }
        bytes.writeBigUInt64LE(normalized);
        return bytes;
    }

    private toBigInt(value: unknown): bigint {
        if (typeof value === "bigint") return value;
        if (typeof value === "number") return BigInt(Math.trunc(value));
        if (typeof value === "string" && value.trim()) return BigInt(value.trim());
        if (value instanceof BN) return BigInt(value.toString());
        throw new Error(`Unable to convert value to bigint: ${String(value ?? "")}`);
    }

    private coercePublicKey(value: unknown): PublicKey {
        if (value instanceof PublicKey) return value;
        if (typeof value === "string" && value.trim()) return new PublicKey(value.trim());
        throw new Error(`Unsupported public key value: ${String(value ?? "")}`);
    }

    async createReply(
        contentId: BN,
        parentContent: PublicKey,
        text: string,
        contentType: ContentType = "Text",
        externalUri?: string,
        routeOptions: ContentRouteOptions = {}
    ) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            routeOptions.useV2,
            routeOptions.enableV1FallbackOnV2Failure,
            "createReply"
        );

        try {
            return await this.createReplyV2(contentId, parentContent, text, contentType, externalUri, routeOptions, author);
        } catch (error) {
            throw new Error(
                `createReply v2 failed: ${this.extractErrorMessage(error)}`
            );
        }
    }

    async createReplyById(
        contentId: BN,
        parentContentId: BN,
        text: string,
        contentType: ContentType = "Text",
        externalUri?: string,
        routeOptions: ContentRouteOptions = {}
    ) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            routeOptions.useV2,
            routeOptions.enableV1FallbackOnV2Failure,
            "createReplyById"
        );

        return this.createReplyV2ById(
            contentId,
            parentContentId,
            text,
            contentType,
            externalUri,
            routeOptions,
            author
        );
    }

    private async createReplyV1(
        contentId: BN,
        parentContent: PublicKey,
        text: string,
        contentType: ContentType,
        externalUri: string | undefined,
        author: PublicKey
    ) {
        const normalizedExternalUri = this.normalizeV1ExternalUri(externalUri);

        const contentPostPda = this.pda.findContentPostPda(author, contentId);

        // Basic content data
        const contentTypeVariant = this.toContentTypeVariant(contentType);
        const metadata = {
            title: null,
            description: null,
            tags: [],
            language: "zh-CN",
            contentWarning: null,
            expiresAt: null,
        };

        const contentData = {
            contentId,
            author,
            contentType: contentTypeVariant,
            text,
            mediaAttachments: [],
            metadata,
            createdAt: new BN(Math.floor(Date.now() / 1000)),
        };

        return this.program.methods
            .createReply(
                contentId,
                parentContent,
                contentData,
                metadata,
                normalizedExternalUri
            )
            .accounts({
                contentPost: contentPostPda,
                parentContentPost: parentContent, // Assuming this is the account address
                author: author,
                systemProgram: SystemProgram.programId,
                contentManager: this.pda.findContentManagerPda(),
            })
            .rpc();
    }

    private async createReplyV2(
        contentId: BN,
        parentContent: PublicKey,
        text: string,
        contentType: ContentType,
        externalUri: string | undefined,
        routeOptions: ContentRouteOptions,
        author: PublicKey
    ) {
        const methods = this.program.methods as any;
        if (typeof methods.createReplyV2 !== "function") {
            throw new Error("createReplyV2 is unavailable in current SDK bindings");
        }

        const identityHandle = String(routeOptions.identityHandle || "").trim();
        if (!identityHandle) {
            throw new Error("identityHandle is required for createReply v2 route");
        }
        const proofAccounts = await this.resolveRelationProofAccounts(
            parentContent.toBase58(),
            author,
            "createReply v2 route",
        );

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName: routeOptions.identityRegistryName || "social_hub_identity",
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            parentContent: parentContent.toBase58(),
            author: author.toBase58(),
            text,
            contentType: this.toContentTypeVariant(contentType),
        });
        const uriRef = this.buildV2UriRef(externalUri, contentId, "reply");

        return methods
            .createReplyV2(contentId, parentContent, contentHash, uriRef)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
                parentContentPost: parentContent,
                targetFollowRelationship: proofAccounts.targetFollowRelationship,
                targetCircleMembership: proofAccounts.targetCircleMembership,
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    private async createReplyV2ById(
        contentId: BN,
        parentContentId: BN,
        text: string,
        contentType: ContentType,
        externalUri: string | undefined,
        routeOptions: ContentRouteOptions,
        author: PublicKey
    ) {
        const methods = this.program.methods as any;
        if (typeof methods.createReplyV2ById !== "function") {
            throw new Error("createReplyV2ById is unavailable in current SDK bindings");
        }

        const identityHandle = String(routeOptions.identityHandle || "").trim();
        if (!identityHandle) {
            throw new Error("identityHandle is required for createReplyById v2 route");
        }
        if (parentContentId.lte(new BN(0))) {
            throw new Error("parentContentId must be greater than 0");
        }
        const proofAccounts = await this.resolveRelationProofAccounts(
            parentContentId.toString(),
            author,
            "createReplyById v2 route",
            routeOptions.parentAuthorPubkey,
        );
        const parentAuthor = proofAccounts.targetAuthor;

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName: routeOptions.identityRegistryName || "social_hub_identity",
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            parentContentId: parentContentId.toString(),
            author: author.toBase58(),
            text,
            contentType: this.toContentTypeVariant(contentType),
        });
        const uriRef = this.buildV2UriRef(externalUri, contentId, "reply");

        return methods
            .createReplyV2ById(contentId, parentContentId, contentHash, uriRef)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
                parentAuthor,
                parentV2ContentAnchor: this.pda.findContentV2AnchorPda(parentAuthor, parentContentId),
                targetFollowRelationship: proofAccounts.targetFollowRelationship,
                targetCircleMembership: proofAccounts.targetCircleMembership,
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async getContent(author: PublicKey, contentId: BN) {
        const contentPostPda = this.pda.findContentPostPda(author, contentId);
        // @ts-ignore
    // @ts-ignore
    return this.program.account.contentPost.fetch(contentPostPda);
    }

    async createQuote(
        contentId: BN,
        quotedContent: PublicKey,
        text: string,
        externalUri?: string,
        routeOptions: ContentRouteOptions = {}
    ) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            routeOptions.useV2,
            routeOptions.enableV1FallbackOnV2Failure,
            "createQuote"
        );

        return this.createQuoteV2(contentId, quotedContent, text, externalUri, routeOptions, author);
    }

    async createQuoteById(
        contentId: BN,
        quotedContentId: BN,
        text: string,
        externalUri?: string,
        routeOptions: ContentRouteOptions = {}
    ) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            routeOptions.useV2,
            routeOptions.enableV1FallbackOnV2Failure,
            "createQuoteById"
        );

        return this.createQuoteV2ById(
            contentId,
            quotedContentId,
            text,
            externalUri,
            routeOptions,
            author
        );
    }

    private async createQuoteV2(
        contentId: BN,
        quotedContent: PublicKey,
        text: string,
        externalUri: string | undefined,
        routeOptions: ContentRouteOptions,
        author: PublicKey
    ) {
        const methods = this.program.methods as any;
        if (typeof methods.createQuoteV2 !== "function") {
            throw new Error("createQuoteV2 is unavailable in current SDK bindings");
        }

        const identityHandle = String(routeOptions.identityHandle || "").trim();
        if (!identityHandle) {
            throw new Error("identityHandle is required for createQuote v2 route");
        }
        const proofAccounts = await this.resolveRelationProofAccounts(
            quotedContent.toBase58(),
            author,
            "createQuote v2 route",
        );

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName: routeOptions.identityRegistryName || "social_hub_identity",
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            quotedContent: quotedContent.toBase58(),
            author: author.toBase58(),
            text,
            contentType: this.toContentTypeVariant("Text"),
        });
        const uriRef = this.buildV2UriRef(externalUri, contentId, "quote");

        return methods
            .createQuoteV2(contentId, quotedContent, contentHash, uriRef)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
                quotedContentPost: quotedContent,
                targetFollowRelationship: proofAccounts.targetFollowRelationship,
                targetCircleMembership: proofAccounts.targetCircleMembership,
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    private async createQuoteV2ById(
        contentId: BN,
        quotedContentId: BN,
        text: string,
        externalUri: string | undefined,
        routeOptions: ContentRouteOptions,
        author: PublicKey
    ) {
        const methods = this.program.methods as any;
        if (typeof methods.createQuoteV2ById !== "function") {
            throw new Error("createQuoteV2ById is unavailable in current SDK bindings");
        }

        const identityHandle = String(routeOptions.identityHandle || "").trim();
        if (!identityHandle) {
            throw new Error("identityHandle is required for createQuoteById v2 route");
        }
        if (quotedContentId.lte(new BN(0))) {
            throw new Error("quotedContentId must be greater than 0");
        }
        const proofAccounts = await this.resolveRelationProofAccounts(
            quotedContentId.toString(),
            author,
            "createQuoteById v2 route",
            routeOptions.quotedAuthorPubkey,
        );
        const quotedAuthor = proofAccounts.targetAuthor;

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName: routeOptions.identityRegistryName || "social_hub_identity",
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            quotedContentId: quotedContentId.toString(),
            author: author.toBase58(),
            text,
            contentType: this.toContentTypeVariant("Text"),
        });
        const uriRef = this.buildV2UriRef(externalUri, contentId, "quote");

        return methods
            .createQuoteV2ById(contentId, quotedContentId, contentHash, uriRef)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
                quotedAuthor,
                quotedV2ContentAnchor: this.pda.findContentV2AnchorPda(quotedAuthor, quotedContentId),
                targetFollowRelationship: proofAccounts.targetFollowRelationship,
                targetCircleMembership: proofAccounts.targetCircleMembership,
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async createRepost(
        contentId: BN,
        originalContent: PublicKey,
        additionalComment?: string,
        routeOptions: ContentRouteOptions = {}
    ) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            routeOptions.useV2,
            routeOptions.enableV1FallbackOnV2Failure,
            "createRepost"
        );

        try {
            return await this.createRepostV2(contentId, originalContent, additionalComment, routeOptions, author);
        } catch (error) {
            throw new Error(
                `createRepost v2 failed: ${this.extractErrorMessage(error)}`
            );
        }
    }

    async createRepostById(
        contentId: BN,
        originalContentId: BN,
        additionalComment?: string,
        routeOptions: ContentRouteOptions = {}
    ) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");
        this.assertV2OnlyWriteRoute(
            routeOptions.useV2,
            routeOptions.enableV1FallbackOnV2Failure,
            "createRepostById"
        );

        return this.createRepostV2ById(
            contentId,
            originalContentId,
            additionalComment,
            routeOptions,
            author
        );
    }

    private async createRepostV1(contentId: BN, originalContent: PublicKey, additionalComment: string | undefined, author: PublicKey) {
        const contentPostPda = this.pda.findContentPostPda(author, contentId);
        const contentStatsPda = this.pda.findContentStatsPda(contentPostPda);
        const contentStoragePda = this.pda.findContentStoragePda(contentPostPda);

        return this.program.methods
            .createRepost(contentId, originalContent, additionalComment || null)
            .accounts({
                contentPost: contentPostPda,
                contentStats: contentStatsPda,
                contentStorage: contentStoragePda,
                originalContentPost: originalContent,
                author,
                contentManager: this.pda.findContentManagerPda(),
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    private async createRepostV2(
        contentId: BN,
        originalContent: PublicKey,
        additionalComment: string | undefined,
        routeOptions: ContentRouteOptions,
        author: PublicKey
    ) {
        const methods = this.program.methods as any;
        if (typeof methods.createRepostV2 !== "function") {
            throw new Error("createRepostV2 is unavailable in current SDK bindings");
        }

        const identityHandle = String(routeOptions.identityHandle || "").trim();
        if (!identityHandle) {
            throw new Error("identityHandle is required for createRepost v2 route");
        }
        const proofAccounts = await this.resolveRelationProofAccounts(
            originalContent.toBase58(),
            author,
            "createRepost v2 route",
        );

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName: routeOptions.identityRegistryName || "social_hub_identity",
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            originalContent: originalContent.toBase58(),
            author: author.toBase58(),
            additionalComment: additionalComment || "",
        });
        const uriRef = this.buildV2UriRef(undefined, contentId, "repost");

        return methods
            .createRepostV2(contentId, originalContent, contentHash, uriRef)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
                originalContentPost: originalContent,
                targetFollowRelationship: proofAccounts.targetFollowRelationship,
                targetCircleMembership: proofAccounts.targetCircleMembership,
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    private async createRepostV2ById(
        contentId: BN,
        originalContentId: BN,
        additionalComment: string | undefined,
        routeOptions: ContentRouteOptions,
        author: PublicKey
    ) {
        const methods = this.program.methods as any;
        if (typeof methods.createRepostV2ById !== "function") {
            throw new Error("createRepostV2ById is unavailable in current SDK bindings");
        }

        const identityHandle = String(routeOptions.identityHandle || "").trim();
        if (!identityHandle) {
            throw new Error("identityHandle is required for createRepostById v2 route");
        }
        if (originalContentId.lte(new BN(0))) {
            throw new Error("originalContentId must be greater than 0");
        }
        const proofAccounts = await this.resolveRelationProofAccounts(
            originalContentId.toString(),
            author,
            "createRepostById v2 route",
            routeOptions.originalAuthorPubkey,
        );
        const originalAuthor = proofAccounts.targetAuthor;

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle,
            identityRegistryName: routeOptions.identityRegistryName || "social_hub_identity",
        });

        const contentHash = this.buildV2ContentHash({
            contentId: contentId.toString(),
            originalContentId: originalContentId.toString(),
            author: author.toBase58(),
            additionalComment: additionalComment || "",
        });
        const uriRef = this.buildV2UriRef(undefined, contentId, "repost");

        return methods
            .createRepostV2ById(contentId, originalContentId, contentHash, uriRef)
            .accounts({
                contentManager: this.pda.findContentManagerPda(),
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, contentId),
                originalAuthor,
                originalV2ContentAnchor: this.pda.findContentV2AnchorPda(originalAuthor, originalContentId),
                targetFollowRelationship: proofAccounts.targetFollowRelationship,
                targetCircleMembership: proofAccounts.targetCircleMembership,
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async updateContent(author: PublicKey, contentId: BN, updates: any) {
        const contentPostPda = this.pda.findContentPostPda(author, contentId);

        return this.program.methods
            .updateContent(updates)
            .accounts({
                contentPost: contentPostPda,
                author: this.provider.publicKey,
            })
            .rpc();
    }

    async updateContentV2Anchor(params: UpdateContentV2AnchorParams) {
        const author = this.provider.publicKey;
        if (!author) throw new Error("Wallet not connected");

        const methods = this.program.methods as any;
        if (typeof methods.updateContentAnchorV2 !== "function") {
            throw new Error("updateContentAnchorV2 is unavailable in current IDL");
        }

        const accountBundle = await this.resolveCreateContentAccounts({
            identityHandle: params.identityHandle,
            identityRegistryName: params.identityRegistryName || "social_hub_identity",
        });

        return methods
            .updateContentAnchorV2(
                params.contentId,
                this.normalizeContentHash(params.contentHash),
                params.externalUri,
            )
            .accounts({
                v2ContentAnchor: this.pda.findContentV2AnchorPda(author, params.contentId),
                author,
                identityProgram: accountBundle.identityProgram,
                userIdentity: accountBundle.userIdentity,
                accessProgram: accountBundle.accessProgram,
                accessControllerAccount: accountBundle.accessControllerAccount,
                eventProgram: accountBundle.eventProgram,
                eventEmitterAccount: accountBundle.eventEmitterAccount,
                eventBatch: accountBundle.eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async enterDraftLifecycleCrystallizationAnchor(params: DraftLifecycleAnchorParams) {
        const actor = this.provider.publicKey;
        if (!actor) throw new Error("Wallet not connected");

        const methods = this.program.methods as any;
        if (typeof methods.enterDraftCrystallizationV2 !== "function") {
            throw new Error("enterDraftCrystallizationV2 is unavailable in current IDL");
        }

        const eventEmitterAccount = this.pda.findEventEmitterPda();
        const eventSequence = await this.readCurrentEventSequence(eventEmitterAccount);
        const eventBatch = this.pda.findEventBatchPda(eventSequence);

        return methods
            .enterDraftCrystallizationV2(
                this.toBN(params.draftPostId),
                this.normalizeContentHash(params.policyProfileDigest),
            )
            .accounts({
                actor,
                eventProgram: this.pda.getEventProgramId(),
                eventEmitterAccount,
                eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async archiveDraftLifecycleAnchor(params: DraftLifecycleAnchorParams) {
        const actor = this.provider.publicKey;
        if (!actor) throw new Error("Wallet not connected");

        const methods = this.program.methods as any;
        if (typeof methods.archiveDraftLifecycleV2 !== "function") {
            throw new Error("archiveDraftLifecycleV2 is unavailable in current IDL");
        }

        const eventEmitterAccount = this.pda.findEventEmitterPda();
        const eventSequence = await this.readCurrentEventSequence(eventEmitterAccount);
        const eventBatch = this.pda.findEventBatchPda(eventSequence);

        return methods
            .archiveDraftLifecycleV2(
                this.toBN(params.draftPostId),
                this.normalizeContentHash(params.policyProfileDigest),
            )
            .accounts({
                actor,
                eventProgram: this.pda.getEventProgramId(),
                eventEmitterAccount,
                eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async restoreDraftLifecycleAnchor(params: DraftLifecycleAnchorParams) {
        const actor = this.provider.publicKey;
        if (!actor) throw new Error("Wallet not connected");

        const methods = this.program.methods as any;
        if (typeof methods.restoreDraftLifecycleV2 !== "function") {
            throw new Error("restoreDraftLifecycleV2 is unavailable in current IDL");
        }

        const eventEmitterAccount = this.pda.findEventEmitterPda();
        const eventSequence = await this.readCurrentEventSequence(eventEmitterAccount);
        const eventBatch = this.pda.findEventBatchPda(eventSequence);

        return methods
            .restoreDraftLifecycleV2(
                this.toBN(params.draftPostId),
                this.normalizeContentHash(params.policyProfileDigest),
            )
            .accounts({
                actor,
                eventProgram: this.pda.getEventProgramId(),
                eventEmitterAccount,
                eventBatch,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    }

    async deleteContent(author: PublicKey, contentId: BN, deletionType: any) {
        const contentPostPda = this.pda.findContentPostPda(author, contentId);
        const contentStatsPda = this.pda.findContentStatsPda(contentPostPda);
        const contentStoragePda = this.pda.findContentStoragePda(contentPostPda);

        return this.program.methods
            .deleteContent(deletionType)
            .accounts({
                contentPost: contentPostPda,
                contentStats: contentStatsPda,
                contentStorage: contentStoragePda,
                contentManager: this.pda.findContentManagerPda(),
                author: this.provider.publicKey,
            })
            .rpc();
    }

    async interactWithContent(contentPostPda: PublicKey, interactionType: any) {
        const contentStatsPda = this.pda.findContentStatsPda(contentPostPda);

        return this.program.methods
            .interactWithContent(interactionType)
            .accounts({
                contentStats: contentStatsPda,
                actor: this.provider.publicKey,
                callerProgram: this.programId,
            })
            .rpc();
    }

    async updateContentStatus(author: PublicKey, contentId: BN, newStatus: any, reason?: string) {
        const contentPostPda = this.pda.findContentPostPda(author, contentId);

        return this.program.methods
            .updateContentStatus(newStatus, reason || null)
            .accounts({
                contentPost: contentPostPda,
                author: this.provider.publicKey,
            })
            .rpc();
    }

    async setContentVisibility(author: PublicKey, contentId: BN, visibilitySettings: any) {
        const contentPostPda = this.pda.findContentPostPda(author, contentId);

        return this.program.methods
            .setContentVisibility(visibilitySettings)
            .accounts({
                contentPost: contentPostPda,
                author: this.provider.publicKey,
            })
            .rpc();
    }
}
