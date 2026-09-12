import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import {
    CURRENT_PUBLIC_DEMO_ADMISSION_POLICY,
    type PublicDemoAdmissionSignaturePayload,
} from '../../auth/session';

export { CURRENT_PUBLIC_DEMO_ADMISSION_POLICY } from '../../auth/session';

type AdmissionStore = Pick<PrismaClient, 'publicDemoAdmission'>;

interface RecordPublicDemoAdmissionInput {
    walletPublicKey: string;
    signedMessage: string;
    admission: PublicDemoAdmissionSignaturePayload;
}

function sha256(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function acceptanceDigest(input: {
    walletPublicKey: string;
    policyVersion: string;
    jurisdiction: string;
    region: string;
    adultAttested: boolean;
    termsAccepted: boolean;
    privacyAccepted: boolean;
    safetyPolicyAccepted: boolean;
    signedMessageDigest: string;
    acceptedAt: Date;
}): string {
    return sha256(JSON.stringify([
        input.walletPublicKey,
        input.policyVersion,
        input.jurisdiction,
        input.region,
        input.adultAttested,
        input.termsAccepted,
        input.privacyAccepted,
        input.safetyPolicyAccepted,
        input.signedMessageDigest,
        input.acceptedAt.toISOString(),
    ]));
}

function assertSupportedAdmission(admission: PublicDemoAdmissionSignaturePayload): void {
    if (admission.region === 'CN') {
        throw new Error('public_demo_region_not_supported');
    }
    if (
        admission.policyVersion !== CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.version
        || admission.jurisdiction !== CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.jurisdiction
        || !CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.supportedRegions.includes(admission.region)
        || admission.adultAttested !== true
        || admission.termsAccepted !== true
        || admission.privacyAccepted !== true
        || admission.safetyPolicyAccepted !== true
    ) {
        throw new Error('public_demo_admission_invalid');
    }
}

export async function recordPublicDemoAdmission(
    prisma: AdmissionStore,
    input: RecordPublicDemoAdmissionInput,
) {
    assertSupportedAdmission(input.admission);
    const acceptedAt = new Date();
    const signedMessageDigest = sha256(input.signedMessage);
    const create = {
        userId: null,
        walletPublicKey: input.walletPublicKey,
        policyVersion: input.admission.policyVersion,
        jurisdiction: input.admission.jurisdiction,
        region: input.admission.region,
        adultAttested: true,
        termsAccepted: true,
        privacyAccepted: true,
        safetyPolicyAccepted: true,
        signedMessageDigest,
        acceptedAt,
        acceptanceDigest: '',
    };
    create.acceptanceDigest = acceptanceDigest(create);

    return prisma.publicDemoAdmission.upsert({
        where: {
            walletPublicKey_policyVersion: {
                walletPublicKey: input.walletPublicKey,
                policyVersion: input.admission.policyVersion,
            },
        },
        create,
        update: {},
    });
}

export async function assertCurrentPublicDemoAdmission(
    prisma: AdmissionStore,
    expectedWalletPublicKey: string,
    expectedUserId?: number,
) {
    const admission = await prisma.publicDemoAdmission.findUnique({
        where: {
            walletPublicKey_policyVersion: {
                walletPublicKey: expectedWalletPublicKey,
                policyVersion: CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.version,
            },
        },
    });
    if (!admission) {
        throw new Error('public_demo_admission_required');
    }
    assertSupportedAdmission(admission as PublicDemoAdmissionSignaturePayload);
    if (
        admission.walletPublicKey !== expectedWalletPublicKey
        || (expectedUserId !== undefined && admission.userId !== null && admission.userId !== expectedUserId)
        || acceptanceDigest(admission) !== admission.acceptanceDigest
    ) {
        throw new Error('public_demo_admission_invalid');
    }
    if (expectedUserId !== undefined && admission.userId === null) {
        return prisma.publicDemoAdmission.update({
            where: { id: admission.id },
            data: { userId: expectedUserId },
        });
    }
    return admission;
}
