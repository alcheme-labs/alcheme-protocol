import { PublicKey } from "@solana/web3.js";
import { BaseModule } from "./base";
import * as idl from "../idl/event_emitter.json";
import { Idl } from "@coral-xyz/anchor";

export class EventModule extends BaseModule<Idl> {
  constructor(provider: any, programId: PublicKey, pda: any) {
    super(provider, programId, pda, idl as unknown as Idl);
  }

  // On-chain subscription (for relayers)
  async registerSubscription(
      eventTypes: any[], 
      deliveryUrl: string
  ) {
      const subscriber = this.provider.publicKey;
      const subscriptionPda = this.pda.findEventSubscriptionPda(subscriber);
      
      const deliveryConfig = {
          deliveryMethod: { webhook: {} },
          deliveryUrl,
          retryPolicy: { maxRetries: 3 }
      };

      return this.program.methods
        .subscribeToEvents(eventTypes, {}, deliveryConfig)
        .accounts({
            subscription: subscriptionPda,
            subscriber,
            eventEmitter: this.pda.findEventEmitterPda(),
            // systemProgram...
        })
        .rpc();
  }

  // Client-side listener
  addListener(eventName: string, callback: (event: any, slot: number, signature: string) => void): number {
      return this.program.addEventListener(eventName, callback);
  }

  removeListener(listenerId: number) {
      return this.program.removeEventListener(listenerId);
  }

  async queryEvents(filters: { eventTypes?: any[], userFilter?: PublicKey, limit?: number }) {
    const eventEmitterPda = this.pda.findEventEmitterPda();
    
    try {
    // @ts-ignore
      const eventBatches = await this.program.account.eventBatch.all([
        {
          memcmp: {
            offset: 8,
            bytes: eventEmitterPda.toBase58(),
          }
        }
      ]);

      let allEvents: any[] = [];
      for (const batch of eventBatches.slice(0, filters.limit || 10)) {
        if (batch.account.events) {
          allEvents = allEvents.concat(batch.account.events);
        }
      }

      return allEvents.slice(0, filters.limit || 10);
    } catch {
      return [];
    }
  }
}

