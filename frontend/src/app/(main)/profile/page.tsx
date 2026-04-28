'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useApolloClient, useQuery, useMutation } from '@apollo/client/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hexagon, BookOpen, Edit3, Wallet, LogOut, Settings2 } from 'lucide-react';
import dynamic from 'next/dynamic';

import IdentityRegistrationEntry from '@/components/auth/IdentityRegistrationEntry';
import RegisterIdentitySheet from '@/components/auth/RegisterIdentitySheet/RegisterIdentitySheet';
import ProfileSettingsSheet from '@/components/profile/ProfileSettingsSheet/ProfileSettingsSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import EditProfileModal from '@/components/ui/EditProfileModal';
import TotemDisplay from '@/components/profile/TotemDisplay/TotemDisplay';
import { useRegisterIdentity } from '@/hooks/useRegisterIdentity';
import { useAlchemeSDK } from '@/hooks/useAlchemeSDK';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import { GET_ME, UPDATE_USER, GET_MY_KNOWLEDGE } from '@/lib/apollo/queries';
import type { MeResponse, UpdateUserResponse, MyKnowledgeResponse, MyKnowledgeItem } from '@/lib/apollo/types';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import {
    canEditRegisteredProfile,
    resolveRegisteredProfileItems,
    shouldLoadRegisteredProfile,
} from '@/lib/auth/walletSurfaceState';
import { computeCrystalVisualParams, type CrystalDataInput } from '@/lib/crystal/visualParams';
import {
    isMissingOnchainIdentityUpdateError,
    normalizeProfileUpdateError,
} from '@/lib/profile/updateIdentityError';
import { useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

/* Dynamic imports for 3D crystal (no SSR) */
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);

/* ── Crystal thumbnail helper ── */
function CrystalThumbnail({ crystal }: { crystal: MyKnowledgeItem }) {
    const params = useMemo(() => {
        if (!crystal.knowledgeId) return null;
        const input: CrystalDataInput = {
            knowledgeId: crystal.knowledgeId,
            circleName: crystal.circle?.name || '',
            qualityScore: crystal.stats.qualityScore ?? 50,
            contributorsCount: crystal.contributorsCount ?? 1,
            version: crystal.version ?? 1,
            citationCount: crystal.stats.citationCount,
            createdAt: crystal.createdAt,
        };
        return computeCrystalVisualParams(input);
    }, [crystal.knowledgeId, crystal.circle?.name, crystal.stats.qualityScore, crystal.contributorsCount, crystal.version, crystal.stats.citationCount, crystal.createdAt]);

    if (!params) return null;

    return (
        <div style={{ flexShrink: 0 }}>
            <CrystalDisplay params={params} size={60} particles={false}>
                <Crystal3D params={params} size={60} animate={false} />
            </CrystalDisplay>
        </div>
    );
}
/**
 * Profile Page — with wallet integration + edit modal
 */
export default function ProfilePage() {
    const t = useI18n('ProfilePage');
    const apolloClient = useApolloClient();
    const sdk = useAlchemeSDK();
    const { connected, publicKey, disconnect } = useWallet();
    const { setVisible } = useWalletModal();
    const [showEdit, setShowEdit] = useState(false);
    const [showSettingsSheet, setShowSettingsSheet] = useState(false);
    const [showRegisterSheet, setShowRegisterSheet] = useState(false);
    const {
        identityState,
        lastErrorMessage,
        refreshIdentityState,
    } = useIdentityOnboarding();
    const {
        registerIdentity,
        loading: identityRegistrationLoading,
        syncing: identityRegistrationSyncing,
        error: identityRegistrationError,
    } = useRegisterIdentity();
    const isE2EMockMode = process.env.NEXT_PUBLIC_E2E_WALLET_MOCK === '1';
    const isConnectingIdentity = connected && identityState === 'connecting_session';
    const isUnregisteredIdentity = connected && identityState === 'unregistered';
    const isSessionErrorIdentity = connected && identityState === 'session_error';
    const needsIdentityRecovery = isUnregisteredIdentity || isSessionErrorIdentity;
    const needsIdentityPlaceholder = needsIdentityRecovery || isConnectingIdentity;
    const shouldLoadProfile = shouldLoadRegisteredProfile({
        walletConnected: connected,
        identityState,
    });

    // Fetch current user from API
    const { data, loading } = useQuery<MeResponse>(GET_ME, {
        skip: !shouldLoadProfile,
    });
    const user = shouldLoadProfile ? (data?.me ?? null) : null;
    const [profileDraft, setProfileDraft] = useState({ displayName: '', bio: '' });

    // Update user mutation
    const [updateUser] = useMutation<UpdateUserResponse>(UPDATE_USER, {
        refetchQueries: [{ query: GET_ME }],
    });

    // Fetch user's knowledge crystals
    const { data: knowledgeData, loading: knowledgeLoading } = useQuery<MyKnowledgeResponse>(GET_MY_KNOWLEDGE, {
        variables: { limit: 10, offset: 0 },
        skip: !shouldLoadProfile,
    });
    const crystals = resolveRegisteredProfileItems({
        walletConnected: connected,
        identityState,
        items: knowledgeData?.myKnowledge,
    });

    useEffect(() => {
        if (!user) {
            setProfileDraft({ displayName: '', bio: '' });
            return;
        }

        setProfileDraft({
            displayName: user.displayName || t('fallbacks.anonymous'),
            bio: user.bio || '',
        });
    }, [t, user?.bio, user?.displayName, user?.id]);

    const canEditProfile = canEditRegisteredProfile({
        walletConnected: connected,
        identityState,
        handle: user?.handle,
    });

    const shortAddress = publicKey
        ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
        : null;

    const handleSaveProfile = useCallback(async (profileData: { displayName: string; bio: string }) => {
        if (isE2EMockMode) {
            await updateUser({
                variables: {
                    input: {
                        displayName: profileData.displayName,
                        bio: profileData.bio,
                    },
                },
            });
            setProfileDraft({
                displayName: profileData.displayName,
                bio: profileData.bio,
            });
            return;
        }

        if (!sdk || !user?.handle) {
            throw new Error(t('errors.walletIdentityNotReady'));
        }

        try {
            const signature = await sdk.identity.updateIdentity(user.handle, {
                displayName: profileData.displayName,
                bio: profileData.bio,
            });

            const signatureSlot = await waitForSignatureSlot(sdk.connection, signature);
            if (signatureSlot !== null) {
                const waitResult = await waitForIndexedSlot(signatureSlot, {
                    timeoutMs: 45_000,
                    pollMs: 1_500,
                });
                if (!waitResult.ok) {
                    throw new Error(t('errors.indexerLagging'));
                }
            }
        } catch (error) {
            if (isMissingOnchainIdentityUpdateError(error)) {
                try {
                    await refreshIdentityState();
                } catch (refreshError) {
                    console.warn('profile save identity refresh failed:', refreshError);
                }
            }
            throw new Error(normalizeProfileUpdateError(error, {
                missingIdentity: t('errors.missingEditableIdentity'),
                invalidPayload: t('errors.invalidUpdatePayload'),
                genericFailure: t('errors.saveFailed'),
            }));
        }

        setProfileDraft({
            displayName: profileData.displayName,
            bio: profileData.bio,
        });
        await apolloClient.reFetchObservableQueries();
    }, [apolloClient, isE2EMockMode, refreshIdentityState, sdk, t, updateUser, user?.handle]);

    const handleRegisterIdentity = useCallback(async (handle: string) => {
        const created = await registerIdentity({ handle });
        if (!created) return;
        await refreshIdentityState();
        setShowRegisterSheet(false);
    }, [refreshIdentityState, registerIdentity]);

    const handleRecoverIdentity = useCallback(() => {
        void refreshIdentityState();
    }, [refreshIdentityState]);

    // Derive display values from API data or fallbacks
    const displayName = isSessionErrorIdentity
        ? t('identityStates.sessionError.displayName')
        : isConnectingIdentity
            ? t('identityStates.connecting.displayName')
            : isUnregisteredIdentity
            ? t('identityStates.unregistered.displayName')
            : profileDraft.displayName || t('fallbacks.anonymous');
    const handle = needsIdentityPlaceholder || !shouldLoadProfile ? null : (user?.handle || t('fallbacks.unknownHandle'));
    const bio = isSessionErrorIdentity
        ? (lastErrorMessage || t('identityStates.sessionError.bio'))
        : isConnectingIdentity
            ? t('identityStates.connecting.bio')
            : isUnregisteredIdentity
            ? t('identityStates.unregistered.bio')
        : profileDraft.bio;
    const reputation = needsIdentityPlaceholder ? 0 : user?.reputationScore ?? 0;
    const stats = needsIdentityPlaceholder ? null : user?.stats;
    const identityEntryTitle = isSessionErrorIdentity
        ? t('identityEntry.sessionError.title')
        : t('identityEntry.unregistered.title');
    const identityEntryDescription = isSessionErrorIdentity
        ? (lastErrorMessage || t('identityEntry.sessionError.description'))
        : t('identityEntry.unregistered.description', {wallet: shortAddress || '—'});
    const identityEntryPrimaryLabel = isSessionErrorIdentity
        ? t('identityEntry.sessionError.primaryLabel')
        : t('identityEntry.unregistered.primaryLabel');
    const totemEmptyText = isSessionErrorIdentity
        ? t('empty.totem.sessionError')
        : isConnectingIdentity
            ? t('empty.totem.connecting')
        : t('empty.totem.unregistered');
    const crystalEmptyText = isSessionErrorIdentity
        ? t('empty.crystals.sessionError')
        : isConnectingIdentity
            ? t('empty.crystals.connecting')
        : t('empty.crystals.unregistered');
    const showProfileLoading = isConnectingIdentity || (!needsIdentityRecovery && loading);
    const headerHandle = isConnectingIdentity
        ? t('identityStates.connecting.headerHandle')
        : handle ? `@${handle}` : t('identityStates.unregistered.headerHandle');

    return (
        <div className={styles.page}>


            <div className="content-container">
                <div className={styles.topBar}>
                    <button
                        type="button"
                        className={styles.settingsButton}
                        onClick={() => setShowSettingsSheet(true)}
                        aria-label={t('actions.openSettings')}
                    >
                        <Settings2 size={18} />
                    </button>
                </div>
                {/* ── Profile Header ── */}
                <motion.div
                    className={styles.profileHeader}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    {/* Totem Avatar */}
                    <div className={styles.totem}>
                        <Hexagon size={64} strokeWidth={1} className={styles.totemIcon} />
                        <div className={styles.totemLevel}>{showProfileLoading ? '…' : reputation.toFixed(0)}</div>
                    </div>

                    <h1 className={styles.displayName}>{isConnectingIdentity ? displayName : showProfileLoading ? t('common.loading') : displayName}</h1>
                    <p className={styles.handle}>{headerHandle}</p>

                    {/* Wallet status */}
                    {connected && shortAddress ? (
                        <div className={styles.walletBadge}>
                            <Wallet size={12} />
                            <span>{shortAddress}</span>
                        </div>
                    ) : (
                        <button
                            className={styles.connectButton}
                            onClick={() => setVisible(true)}
                        >
                            <Wallet size={14} />
                            {t('actions.connectWallet')}
                        </button>
                    )}

                    {needsIdentityRecovery && (
                        <div className={styles.identityEntry}>
                            <IdentityRegistrationEntry
                                title={identityEntryTitle}
                                description={identityEntryDescription}
                                primaryLabel={identityEntryPrimaryLabel}
                                onPrimary={isSessionErrorIdentity ? handleRecoverIdentity : () => setShowRegisterSheet(true)}
                            />
                        </div>
                    )}

                    <p className={styles.bio}>{bio}</p>

                    <div className={styles.headerActions}>
                        {canEditProfile && (
                            <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
                                <Edit3 size={14} />
                                {t('actions.editProfile')}
                            </Button>
                        )}
                        {connected && (
                            <Button variant="ghost" size="sm" onClick={() => disconnect()}>
                                <LogOut size={14} />
                                {t('actions.disconnect')}
                            </Button>
                        )}
                    </div>
                </motion.div>

                {/* ── Stats ── */}
                <motion.div
                    className={styles.statsGrid}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div className={styles.statItem}>
                        <span className={styles.statValue}>{showProfileLoading ? '…' : stats?.posts ?? 0}</span>
                        <span className={styles.statLabel}>{t('stats.posts')}</span>
                    </div>
                    <div className={styles.statItem}>
                        <span className={styles.statValue}>{showProfileLoading ? '…' : stats?.circles ?? 0}</span>
                        <span className={styles.statLabel}>{t('stats.circles')}</span>
                    </div>
                    <div className={styles.statItem}>
                        <span className={styles.statValue}>{showProfileLoading ? '…' : stats?.followers ?? 0}</span>
                        <span className={styles.statLabel}>{t('stats.followers')}</span>
                    </div>
                    <div className={styles.statItem}>
                        <span className={styles.statValue}>{showProfileLoading ? '…' : reputation.toFixed(1)}</span>
                        <span className={styles.statLabel}>{t('stats.reputation')}</span>
                    </div>
                </motion.div>

                {/* ── Totem ── */}
                <motion.section
                    className={styles.section}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div className={styles.sectionHeader}>
                        <Hexagon size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                        <h2 className={styles.sectionTitle}>{t('sections.totem')}</h2>
                    </div>
                    {needsIdentityPlaceholder ? (
                        <Card state="ore" className={styles.emptyStateCard}>
                            <p className={styles.emptyStateText}>
                                {totemEmptyText}
                            </p>
                        </Card>
                    ) : (
                        <TotemDisplay totem={user?.totem} />
                    )}
                </motion.section>

                {/* ── My Crystals ── */}
                <motion.section
                    className={styles.section}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div className={styles.sectionHeader}>
                        <BookOpen size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                        <h2 className={styles.sectionTitle}>{t('sections.myCrystals')}</h2>
                    </div>
                    {needsIdentityPlaceholder ? (
                        <Card state="ore" className={styles.emptyStateCard}>
                            <p className={styles.emptyStateText}>
                                {crystalEmptyText}
                            </p>
                        </Card>
                    ) : (
                        <>
                            {knowledgeLoading && crystals.length === 0 && (
                                <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-small)', padding: 'var(--space-3) 0' }}>
                                    {t('common.loading')}
                                </p>
                            )}
                            {!knowledgeLoading && crystals.length === 0 && (
                                <Card state="ore">
                                    <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-caption)' }}>
                                        {t('empty.noCrystals')}
                                    </p>
                                </Card>
                            )}
                            <AnimatePresence>
                                {crystals.map((crystal, i) => (
                                    <motion.div
                                        key={crystal.id}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, delay: i * 0.05 }}
                                    >
                                        <Card state="crystal">
                                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                                <CrystalThumbnail crystal={crystal} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <h3 className={styles.crystalTitle}>{crystal.title}</h3>
                                                    <p className={styles.crystalMeta}>
                                                        {crystal.circle?.name ?? t('fallbacks.unknownCircle')}
                                                        {' · '}
                                                        {t('crystals.citationCount', {count: crystal.stats.citationCount})}
                                                        {' · '}
                                                        v{crystal.version}
                                                    </p>
                                                </div>
                                            </div>
                                        </Card>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </>
                    )}
                </motion.section>
            </div>

            {/* Edit Profile Modal */}
            <EditProfileModal
                isOpen={showEdit}
                onClose={() => setShowEdit(false)}
                initialData={{ displayName, bio }}
                onSave={handleSaveProfile}
            />

            <RegisterIdentitySheet
                open={showRegisterSheet}
                context="onboarding"
                loading={identityRegistrationLoading}
                syncing={identityRegistrationSyncing}
                error={identityRegistrationError}
                onClose={() => {
                    if (!identityRegistrationLoading && !identityRegistrationSyncing) {
                        setShowRegisterSheet(false);
                    }
                }}
                onSubmit={handleRegisterIdentity}
            />

            <ProfileSettingsSheet
                open={showSettingsSheet}
                onClose={() => setShowSettingsSheet(false)}
            />
        </div>
    );
}
