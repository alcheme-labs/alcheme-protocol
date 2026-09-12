import { authenticatedApiFetch } from './fetch';
import { getQueryApiBaseUrl } from '../config/queryApiBase';

export interface ContributionCredentialClaimRecord {
    id: string;
    credentialKind: 'personal_receipt';
    knowledgePublicId: string;
    governanceHomeRef: string;
    claimantPubkey: string;
    payerMode: 'requester';
    payerRef: string;
    chainId: 'solana:localnet';
    visibility: 'private' | 'circle' | 'public';
    status: 'pending_settlement';
    lifecyclePolicy: {
        transferMode: 'non_transferable';
        revocable: true;
        burnable: true;
        permissionFactSource: false;
        identitySemantics: 'display_credential_not_permanent_identity';
        settlementState: 'unfunded/pending_settlement';
    };
    createdAt: string;
    updatedAt: string;
}

export interface ContributionCredentialClaimReadback {
    eligible: boolean;
    blockerCode: string | null;
    payerOptions: {
        requester: 'available';
        circleSponsor: 'not_configured';
    };
    settlementReadiness: {
        state: 'setup_required';
        network: 'solana:localnet';
        homeIdentityBinding: 'active' | 'not_configured';
        homeIdentityBindingRef: string | null;
        resourceBinding: 'not_configured';
        requesterFunding: 'declared_not_preflighted';
        circleSponsorPolicy: 'not_configured' | 'present_unverified';
        activePayerPolicyCount: number;
        assetAuthorityPolicy: 'not_configured' | 'present_unverified';
        activeAssetAuthorityPolicyCount: number;
        providerExecution: 'unavailable';
        issuance: 'not_authorized';
        acceptedOutcomePreserved: true;
        identityEvidenceIssuancePlan: {
            schemaVersion: 1;
            planKind: 'identity_evidence_issuance_plan';
            state: 'free_alternative_available';
            activationAllowed: false;
            costs: {
                currency: 'devnet_test_asset_units';
                providerCost: 0;
                issuanceCost: 0;
                renewalCost: 0;
                transactionCost: 0;
                rentCost: 0;
                feePayer: 'none_required_for_free_alternative';
                rentRefund: 'not_applicable';
            };
            issuer: {
                requiredForFreeAlternative: false;
                issuerRef: null;
                credentialAuthorizedSigner: null;
                sponsorMayBecomeIssuer: false;
            };
            holderConsent: {
                required: true;
                source: 'wallet_signed_contribution_credential_claim';
                consentVersion: 'p04-personal-receipt-consent:v1';
                status: 'missing' | 'captured';
                consentPayloadDigest: string | null;
                consentExpiresAt: string | null;
            };
            transaction: {
                digest: null;
                quota: {
                    paidIssuancePerClaim: 0;
                    freeAlternativePerClaim: 1;
                };
                automaticEnqueue: false;
            };
            forcedNewIssuance: {
                allowedBeforeFrozenPaidPlan: false;
                freeAlternative: 'off_chain_optional_receipt_only';
            };
        };
        blockerCodes: string[];
    };
    claim: ContributionCredentialClaimRecord | null;
}

export interface ContributionCredentialClaimPreparation {
    facts: {
        idempotencyKey: string;
        consentExpiresAt: string;
        payerMode: 'requester';
        visibility: 'private' | 'circle' | 'public';
        issuanceStatus: 'unfunded/pending_settlement';
    };
    signedMessage: string;
}

async function request(input: {
    knowledgeId: string;
    suffix?: string;
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
}) {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/crystals/${encodeURIComponent(input.knowledgeId)}/credential-claim${input.suffix ?? ''}`,
        {
            method: input.method ?? 'GET',
            cache: 'no-store',
            headers: input.body ? { 'Content-Type': 'application/json' } : undefined,
            body: input.body ? JSON.stringify(input.body) : undefined,
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(payload?.message || payload?.error || `request failed: ${response.status}`) as Error & { code?: string; status?: number };
        error.code = payload?.error;
        error.status = response.status;
        throw error;
    }
    return payload;
}

export async function fetchContributionCredentialClaim(
    knowledgeId: string,
): Promise<ContributionCredentialClaimReadback> {
    const payload = await request({ knowledgeId });
    return payload.readback as ContributionCredentialClaimReadback;
}

export async function prepareContributionCredentialClaim(input: {
    knowledgeId: string;
    visibility: 'private' | 'circle' | 'public';
}): Promise<ContributionCredentialClaimPreparation> {
    const payload = await request({
        knowledgeId: input.knowledgeId,
        suffix: '/prepare',
        method: 'POST',
        body: { payerMode: 'requester', visibility: input.visibility },
    });
    return payload.preparation as ContributionCredentialClaimPreparation;
}

export async function acceptContributionCredentialClaim(input: {
    knowledgeId: string;
    signedMessage: string;
    signature: string;
}): Promise<ContributionCredentialClaimRecord> {
    const payload = await request({
        knowledgeId: input.knowledgeId,
        suffix: '/accept',
        method: 'POST',
        body: {
            signedMessage: input.signedMessage,
            signature: input.signature,
        },
    });
    return payload.result.claim as ContributionCredentialClaimRecord;
}
