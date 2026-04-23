import { Connection, PublicKey } from '@solana/web3.js';
import { createLogger, format, transports, Logger } from 'winston';

export interface IdentityLookupStore {
    findUserHandleByPubkey(pubkey: string): Promise<string | null>;
}

export interface ResolvedIdentity {
    handle: string;
    identityRegistryPda: PublicKey;
    userIdentityPda: PublicKey;
}

export const DEFAULT_IDENTITY_REGISTRY_NAME = 'social_hub_identity';

export function deriveIdentityRegistryPda(
    identityProgramId: PublicKey,
    registryName: string = DEFAULT_IDENTITY_REGISTRY_NAME,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('identity_registry'), Buffer.from(registryName)],
        identityProgramId,
    )[0];
}

export function deriveUserIdentityPda(
    identityProgramId: PublicKey,
    identityRegistryPda: PublicKey,
    handle: string,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('user_identity'), identityRegistryPda.toBuffer(), Buffer.from(handle)],
        identityProgramId,
    )[0];
}

export class IdentityResolver {
    private readonly logger: Logger;

    constructor(
        private readonly store: IdentityLookupStore,
        private readonly connection: Connection,
        private readonly identityProgramId: PublicKey,
        private readonly registryName: string,
        logLevel: string = 'info',
    ) {
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [IdentityResolver] ${level}: ${message}`,
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    async resolveContributor(contributor: PublicKey): Promise<ResolvedIdentity | null> {
        const contributorPubkey = contributor.toBase58();
        const handle = await this.store.findUserHandleByPubkey(contributorPubkey);
        if (!handle) {
            this.logger.warn(
                `缺少 pubkey -> handle 映射，无法解析 contributor=${contributorPubkey.slice(0, 8)}...`,
            );
            return null;
        }

        const identityRegistryPda = deriveIdentityRegistryPda(
            this.identityProgramId,
            this.registryName,
        );
        const userIdentityPda = deriveUserIdentityPda(
            this.identityProgramId,
            identityRegistryPda,
            handle,
        );

        const [registryAccount, userIdentityAccount] = await Promise.all([
            this.connection.getAccountInfo(identityRegistryPda, 'confirmed'),
            this.connection.getAccountInfo(userIdentityPda, 'confirmed'),
        ]);

        if (!registryAccount) {
            this.logger.warn(
                `identity registry 账户缺失: registry=${this.registryName}, pda=${identityRegistryPda.toBase58()}`,
            );
            return null;
        }

        if (!userIdentityAccount) {
            this.logger.warn(
                `user identity 账户缺失: contributor=${contributorPubkey.slice(0, 8)}..., handle=${handle}`,
            );
            return null;
        }

        return {
            handle,
            identityRegistryPda,
            userIdentityPda,
        };
    }
}
