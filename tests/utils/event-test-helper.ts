import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export class EventTestHelper {
    static eventEmitterProgram: any;

    static async init() {
        this.eventEmitterProgram = anchor.workspace.EventEmitter;
    }

    static resolveSharedAdmin(): anchor.web3.Keypair {
        const provider = anchor.getProvider() as anchor.AnchorProvider;
        const payer = (provider.wallet as anchor.Wallet & { payer?: anchor.web3.Keypair }).payer;
        if (!payer) {
            throw new Error("EventTestHelper requires a provider wallet with a local payer Keypair");
        }
        return payer;
    }

    static getEventEmitterPDA(): PublicKey {
        const [eventEmitterPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("event_emitter")],
            this.eventEmitterProgram.programId
        );
        return eventEmitterPDA;
    }

    static getEventBatchPDA(sequence: number): PublicKey {
        const [eventBatchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("event_batch"),
                new BN(sequence).toArrayLike(Buffer, "le", 8),
            ],
            this.eventEmitterProgram.programId
        );
        return eventBatchPDA;
    }

    static async initializeEventEmitter(_admin?: anchor.web3.Keypair): Promise<PublicKey> {
        const eventEmitterPDA = this.getEventEmitterPDA();
        const admin = this.resolveSharedAdmin();

        try {
            await this.eventEmitterProgram.account.eventEmitterAccount.fetch(eventEmitterPDA);
            return eventEmitterPDA; // Already initialized
        } catch (e) {
            // Not initialized yet, proceed to initialize
        }

        const storageConfig = {
            chainStorageLimit: 10000,           // u32
            archiveToArweave: false,             // bool
            useCompression: false,               // bool
            batchSize: 1000,                     // u32 - CRITICAL for PDA calculation!
            autoArchiveAfterDays: 30,            // u32
            maxEventSize: 100000,                // u32
        };

        const retentionPolicy = {
            chainRetentionDays: 30,              // u32
            archiveRetentionDays: 365,           // u32
            autoCleanup: false,                  // bool
            priorityRetention: [],               // Vec<PriorityRetention>
        };

        await this.eventEmitterProgram.methods
            .initializeEventEmitter(storageConfig, retentionPolicy)
            .accounts({
                eventEmitter: eventEmitterPDA,
                admin: admin.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([admin])
            .rpc();

        return eventEmitterPDA;
    }

    static async getEventAccounts() {
        // Fetch current event_sequence from event_emitter account
        const eventEmitterPDA = this.getEventEmitterPDA();
        let currentSequence = 0;

        try {
            const eventEmitterAccount = await this.eventEmitterProgram.account.eventEmitterAccount.fetch(eventEmitterPDA);
            console.log('[EventTestHelper] Fetched event_emitter successfully');

            // EventEmitterAccount has wrapper pattern: { inner: EventEmitter }
            const batchSize = eventEmitterAccount.inner.storageConfig?.batchSize || 1000;
            currentSequence = Number(eventEmitterAccount.inner.eventSequence);

            // Calculate what batch_id the program will expect
            const expectedBatchId = Math.floor(currentSequence / batchSize) + 1;
            console.log(`[EventTestHelper] sequence=${currentSequence}, batchSize=${batchSize}, expectedBatchId=${expectedBatchId}`);

        } catch (e) {
            // Event emitter not yet initialized, use sequence 0
            console.log('[EventTestHelper] Failed to fetch event_emitter:', e.message);
            console.log('[EventTestHelper] Using default sequence=0');
            currentSequence = 0;
        }

        const eventBatch = this.getEventBatchPDA(currentSequence);
        console.log(`[EventTestHelper] Final: sequence=${currentSequence}, eventBatch PDA=${eventBatch.toBase58()}`);

        return {
            eventProgram: this.eventEmitterProgram.programId,
            eventEmitter: eventEmitterPDA,
            eventBatch: eventBatch,
        };
    }
}

export default EventTestHelper;
