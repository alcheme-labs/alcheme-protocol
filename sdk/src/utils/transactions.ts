import { utils } from "@coral-xyz/anchor";
import { VersionedTransaction } from "@solana/web3.js";

export function isAlreadyProcessedTransactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already been processed/i.test(message);
}

function isVersionedTransaction(value: any): value is VersionedTransaction {
  return value instanceof VersionedTransaction;
}

async function sendPreparedTransactionWithAlreadyProcessedRecovery(
  provider: any,
  transaction: any,
  signers?: any[],
  optsOverride?: any,
): Promise<string> {
  const opts = {
    ...(provider?.opts ?? {}),
    ...(optsOverride ?? {}),
  };
  const confirmCommitment = opts.commitment ?? opts.preflightCommitment;
  let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null;

  if (isVersionedTransaction(transaction)) {
    if (Array.isArray(signers) && signers.length > 0) {
      transaction.sign(signers);
    }
  } else {
    const feePayer = transaction.feePayer ?? provider?.publicKey ?? provider?.wallet?.publicKey;
    if (!feePayer) {
      throw new Error("Provider wallet is missing a public key");
    }

    transaction.feePayer = feePayer;
    latestBlockhash = await provider.connection.getLatestBlockhash(
      opts.preflightCommitment ?? opts.commitment,
    );
    transaction.recentBlockhash = latestBlockhash!.blockhash;

    if (Array.isArray(signers)) {
      for (const signer of signers) {
        transaction.partialSign(signer);
      }
    }
  }

  const signedTransaction = await provider.wallet.signTransaction(transaction);
  const signatureBytes = isVersionedTransaction(signedTransaction)
    ? signedTransaction.signatures?.[0]
    : signedTransaction.signature;
  if (!signatureBytes) {
    throw new Error("Signed transaction is missing a signature");
  }

  const signature = utils.bytes.bs58.encode(signatureBytes);
  const rawTransaction = signedTransaction.serialize();
  const sendOptions = {
    skipPreflight: opts.skipPreflight,
    preflightCommitment: opts.preflightCommitment || opts.commitment,
    maxRetries: 0,
    minContextSlot: opts.minContextSlot,
  };

  let sendError: unknown = null;
  try {
    await provider.connection.sendRawTransaction(rawTransaction, sendOptions);
  } catch (error) {
    if (!isAlreadyProcessedTransactionError(error)) {
      throw error;
    }
    sendError = error;
  }

  const confirmation = latestBlockhash
    ? await provider.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        confirmCommitment,
      )
    : await provider.connection.confirmTransaction(signature, confirmCommitment);

  if (confirmation.value.err) {
    throw sendError instanceof Error
      ? sendError
      : new Error(`Transaction ${signature} failed (${JSON.stringify(confirmation.value.err)})`);
  }

  return signature;
}

export async function sendTransactionWithAlreadyProcessedRecovery(
  provider: any,
  buildTransaction: () => Promise<any>,
): Promise<string> {
  return sendPreparedTransactionWithAlreadyProcessedRecovery(provider, await buildTransaction());
}

export function installAlreadyProcessedSendAndConfirmRecovery(provider: any): void {
  if (!provider || typeof provider.sendAndConfirm !== "function") {
    return;
  }
  if (provider.__alchemeAlreadyProcessedRecoveryInstalled) {
    return;
  }

  const originalSendAndConfirm = provider.sendAndConfirm.bind(provider);

  provider.sendAndConfirm = async (transaction: any, signers?: any[], opts?: any) =>
    sendPreparedTransactionWithAlreadyProcessedRecovery(provider, transaction, signers, opts);

  Object.defineProperty(provider, "__alchemeAlreadyProcessedRecoveryInstalled", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  Object.defineProperty(provider, "__alchemeOriginalSendAndConfirm", {
    configurable: false,
    enumerable: false,
    value: originalSendAndConfirm,
    writable: false,
  });
}
