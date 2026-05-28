import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { BaseModule } from "./base";
import * as idl from "../idl/messaging_manager.json";
import { Idl } from "@coral-xyz/anchor";
import { sha256 } from "js-sha256";

export type MessagingManagerIdl = Idl;

export interface ConversationMetadata {
    name?: string;
    description?: string;
    avatarUri?: string;
    admin?: PublicKey;
    settings: ConversationSettings;
}

export interface ConversationSettings {
    allowNewMembers: boolean;
    requireApproval: boolean;
    maxParticipants: number;
    messageRetentionDays?: number;
}

export type ConversationType = "Direct" | "Group" | "Channel";
export type MessageType = "Text" | "Image" | "Video" | "Audio" | "File" | "Link" | "Payment" | "Contract" | "System";
export type OnlineStatus = "Online" | "Away" | "Busy" | "Offline" | "Invisible";

export interface CreateConversationParams {
    conversationType: ConversationType;
    participants: PublicKey[];
    metadata: ConversationMetadata;
}

export interface SendMessageParams {
    conversationId: Uint8Array;
    messageContent: string | Buffer;
    messageType: MessageType;
    replyTo?: Uint8Array;
    storageProvider?: "XMTP" | "IPFS" | "Custom";
}

export interface UpdatePresenceParams {
    status: OnlineStatus;
    customStatus?: string;
}

/**
 * XMTP 客户端接口（需要集成 @xmtp/xmtp-js）
 */
export interface XMTPClient {
    sendMessage(conversationId: string, content: string): Promise<string>;
    getConversation(conversationId: string): Promise<any>;
}

export class MessagingModule extends BaseModule<MessagingManagerIdl> {
    private xmtpClient?: XMTPClient;

    constructor(
        provider: any,
        programId: PublicKey,
        pda: any,
        xmtpClient?: XMTPClient
    ) {
        super(provider, programId, pda, idl as unknown as MessagingManagerIdl);
        this.xmtpClient = xmtpClient;
    }

    /**
     * 生成会话ID
     */
    generateConversationId(participants: PublicKey[]): Uint8Array {
        const sorted = participants.map(p => p.toBuffer()).sort(Buffer.compare);
        const combined = Buffer.concat(sorted);
        return new Uint8Array(sha256.array(combined));
    }

    /**
     * 生成消息ID
     */
    generateMessageId(sender: PublicKey, timestamp: number): Uint8Array {
        const data = Buffer.concat([
            sender.toBuffer(),
            Buffer.from(timestamp.toString()),
            Buffer.from(Date.now().toString())
        ]);
        return new Uint8Array(sha256.array(data));
    }

    /**
     * 计算消息哈希
     */
    hashMessage(content: string | Buffer): Uint8Array {
        const buffer = typeof content === 'string' ? Buffer.from(content) : content;
        return new Uint8Array(sha256.array(buffer));
    }

    /**
     * 创建会话
     */
    async createConversation(params: CreateConversationParams): Promise<string> {
        const conversationId = this.generateConversationId(params.participants);
        const [conversationPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("conversation"), Buffer.from(conversationId)],
            this.programId
        );

        const [messagingManagerPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("messaging_manager")],
            this.programId
        );

        const tx = await this.program.methods
            .createConversation(
                Array.from(conversationId),
                { [params.conversationType.toLowerCase()]: {} },
                params.participants,
                this.encodeMetadata(params.metadata)
            )
            .accounts({
                conversation: conversationPDA,
                messagingManager: messagingManagerPDA,
                creator: this.provider.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        return tx;
    }

    /**
     * 发送消息（链下XMTP + 链上元数据）
     */
    async sendMessage(params: SendMessageParams): Promise<{
        txSignature: string;
        messageId: Uint8Array;
        storageUri: string;
    }> {
        const messageId = this.generateMessageId(
            this.provider.publicKey,
            Date.now()
        );
        const messageHash = this.hashMessage(params.messageContent);

        // 1. 发送到XMTP（链下）
        let storageUri = "";
        if (this.xmtpClient && params.storageProvider !== "Custom") {
            const conversationIdHex = Buffer.from(params.conversationId).toString('hex');
            const xmtpResult = await this.xmtpClient.sendMessage(
                conversationIdHex,
                typeof params.messageContent === 'string' 
                    ? params.messageContent 
                    : params.messageContent.toString()
            );
            storageUri = `xmtp://${xmtpResult}`;
        } else {
            // 使用自定义存储URI
            storageUri = `custom://${Buffer.from(messageHash).toString('hex')}`;
        }

        // 2. 元数据上链
        const [conversationPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("conversation"), Buffer.from(params.conversationId)],
            this.programId
        );

        const [messagePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("message"), Buffer.from(messageId)],
            this.programId
        );

        const [messagingManagerPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("messaging_manager")],
            this.programId
        );

        const tx = await this.program.methods
            .sendMessage(
                Array.from(messageId),
                Array.from(messageHash),
                { [params.messageType.toLowerCase()]: {} },
                storageUri,
                params.replyTo ? Array.from(params.replyTo) : null
            )
            .accounts({
                message: messagePDA,
                conversation: conversationPDA,
                messagingManager: messagingManagerPDA,
                sender: this.provider.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        return {
            txSignature: tx,
            messageId,
            storageUri,
        };
    }

    /**
     * 标记消息已读
     */
    async markAsRead(messageId: Uint8Array, conversationId: Uint8Array): Promise<string> {
        const [messagePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("message"), Buffer.from(messageId)],
            this.programId
        );

        const [conversationPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("conversation"), Buffer.from(conversationId)],
            this.programId
        );

        const tx = await this.program.methods
            .markAsRead(Array.from(messageId))
            .accounts({
                message: messagePDA,
                conversation: conversationPDA,
                reader: this.provider.publicKey,
            })
            .rpc();

        return tx;
    }

    /**
     * 批量上链消息哈希
     */
    async batchUploadHashes(
        conversationId: Uint8Array,
        messageHashes: Uint8Array[],
        batchId?: number
    ): Promise<string> {
        const id = batchId || Date.now();
        const merkleRoot = this.calculateMerkleRoot(messageHashes);

        const [batchPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("batch"), Buffer.from(new BN(id).toArray("le", 8))],
            this.programId
        );

        const [conversationPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("conversation"), Buffer.from(conversationId)],
            this.programId
        );

        const tx = await this.program.methods
            .batchUpload(
                new BN(id),
                messageHashes.map(h => Array.from(h)),
                Array.from(merkleRoot)
            )
            .accounts({
                batch: batchPDA,
                conversation: conversationPDA,
                uploader: this.provider.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        return tx;
    }

    /**
     * 更新在线状态
     */
    async updatePresence(params: UpdatePresenceParams): Promise<string> {
        const [presencePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("presence"), this.provider.publicKey.toBuffer()],
            this.programId
        );

        const tx = await this.program.methods
            .updatePresence(
                { [params.status.toLowerCase()]: {} },
                params.customStatus || null
            )
            .accounts({
                presence: presencePDA,
                user: this.provider.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        return tx;
    }

    /**
     * 撤回消息
     */
    async recallMessage(messageId: Uint8Array): Promise<string> {
        const [messagePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("message"), Buffer.from(messageId)],
            this.programId
        );

        const [messagingManagerPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("messaging_manager")],
            this.programId
        );

        const tx = await this.program.methods
            .recallMessage(Array.from(messageId))
            .accounts({
                message: messagePDA,
                messagingManager: messagingManagerPDA,
                sender: this.provider.publicKey,
            })
            .rpc();

        return tx;
    }

    /**
     * 获取会话信息
     */
    async getConversation(conversationId: Uint8Array) {
        const [conversationPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("conversation"), Buffer.from(conversationId)],
            this.programId
        );
    // @ts-ignore
        return await this.program.account.conversation.fetch(conversationPDA);
    }

    /**
     * 获取消息元数据
     */
    async getMessage(messageId: Uint8Array) {
        const [messagePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("message"), Buffer.from(messageId)],
            this.programId
        );
    // @ts-ignore
        return await this.program.account.messageMetadata.fetch(messagePDA);
    }

    /**
     * 获取用户在线状态
     */
    async getUserPresence(user: PublicKey) {
        const [presencePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("presence"), user.toBuffer()],
            this.programId
        );
        try {
    // @ts-ignore
            return await this.program.account.userPresence.fetch(presencePDA);
        } catch {
            return null;
        }
    }

    // ==================== 辅助方法 ====================

    private encodeMetadata(metadata: ConversationMetadata): any {
        return {
            name: metadata.name || null,
            description: metadata.description || null,
            avatarUri: metadata.avatarUri || null,
            admin: metadata.admin || null,
            settings: {
                allowNewMembers: metadata.settings.allowNewMembers,
                requireApproval: metadata.settings.requireApproval,
                maxParticipants: metadata.settings.maxParticipants,
                messageRetentionDays: metadata.settings.messageRetentionDays || null,
            },
        };
    }

    private calculateMerkleRoot(hashes: Uint8Array[]): Uint8Array {
        if (hashes.length === 0) return new Uint8Array(32);
        if (hashes.length === 1) return hashes[0];

        let currentLevel = hashes;
        while (currentLevel.length > 1) {
            const nextLevel: Uint8Array[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 < currentLevel.length) {
                    const combined = Buffer.concat([
                        Buffer.from(currentLevel[i]),
                        Buffer.from(currentLevel[i + 1])
                    ]);
                    nextLevel.push(new Uint8Array(sha256.array(combined)));
                } else {
                    nextLevel.push(currentLevel[i]);
                }
            }
            currentLevel = nextLevel;
        }

        return currentLevel[0];
    }
}

