import { PublicKey } from '@solana/web3.js';
import type { Alcheme } from '@alcheme/sdk';

interface SubmitKnowledgeCitationInput {
    sdk: Alcheme | null;
    sourceOnChainAddress: string;
    targetOnChainAddress: string;
}

export async function submitKnowledgeCitation({
    sdk,
    sourceOnChainAddress,
    targetOnChainAddress,
}: SubmitKnowledgeCitationInput): Promise<string> {
    if (!sdk?.contributionEngine) {
        throw new Error('Contribution engine is not configured');
    }

    return sdk.contributionEngine.addReference(
        new PublicKey(sourceOnChainAddress),
        new PublicKey(targetOnChainAddress),
        { citation: {} },
    );
}
