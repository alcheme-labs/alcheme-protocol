'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
    MemberFollowState,
    MemberProfile,
} from '@/components/circle/MemberCard/MemberCard';
import type { MemberProfileResponse } from '@/lib/apollo/types';
import {
    FOLLOW_INDEX_TIMEOUT_RECOVERY_POLL_MS,
    createPendingFollowState,
    resolveFollowStateFromServer,
    shouldClearPendingFollow,
    type PendingFollowState,
} from '@/lib/follow/stateMachine';
import { timeAgo } from '@/lib/circle/utils';
import { useFollowUser } from './useFollowUser';

interface LoadMemberProfileInput {
    variables: {
        circleId: number;
        userId: number;
    };
}

interface LoadMemberProfileResult {
    data?: MemberProfileResponse;
}

type LoadMemberProfileFn = (input: LoadMemberProfileInput) => Promise<LoadMemberProfileResult>;

interface UseMemberFollowCardStateInput {
    selectedMember: MemberProfile | null;
    setSelectedMember: React.Dispatch<React.SetStateAction<MemberProfile | null>>;
    activeDiscussionCircleId: number;
    loadMemberProfile: LoadMemberProfileFn;
    locale?: string;
    indexTimeoutHint?: string;
}

interface UseMemberFollowCardStateResult {
    memberCardTargetPubkey: string | null;
    memberCardFollowState: MemberFollowState | null;
    toggleSelectedMemberFollow: (nextFollowState: boolean) => Promise<void>;
    reconcilePendingWithServer: (userId: number, viewerFollows: boolean) => void;
    clearSelectedMemberFollowState: () => void;
}

export function useMemberFollowCardState(input: UseMemberFollowCardStateInput): UseMemberFollowCardStateResult {
    const {
        selectedMember,
        setSelectedMember,
        activeDiscussionCircleId,
        loadMemberProfile,
        locale = 'en',
        indexTimeoutHint = 'On-chain update confirmed, index sync still in progress.',
    } = input;

    const [pendingFollowByUserId, setPendingFollowByUserId] = useState<Record<number, PendingFollowState>>({});
    const {
        followUser,
        unfollowUser,
        loading: followLoading,
        syncing: followSyncing,
        status: followStatus,
        error: followError,
        pendingOutcome,
        clearPendingOutcome,
    } = useFollowUser();

    const clearPendingFollowForUser = useCallback((userId: number) => {
        setPendingFollowByUserId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, userId)) return prev;
            const next = { ...prev };
            delete next[userId];
            return next;
        });
    }, []);

    const selectedMemberPendingFollow = useMemo(() => {
        if (!selectedMember) return null;
        return pendingFollowByUserId[selectedMember.userId] || null;
    }, [pendingFollowByUserId, selectedMember]);

    const selectedMemberFollowViewState = useMemo(() => {
        if (!selectedMember) return null;
        return resolveFollowStateFromServer({
            serverViewerFollows: Boolean(selectedMember.viewerFollows),
            pendingState: selectedMemberPendingFollow,
        });
    }, [selectedMember, selectedMemberPendingFollow]);

    const reconcilePendingWithServer = useCallback((userId: number, viewerFollows: boolean) => {
        if (!shouldClearPendingFollow(
            pendingFollowByUserId[userId],
            viewerFollows,
            Date.now(),
        )) {
            return;
        }
        clearPendingFollowForUser(userId);
        clearPendingOutcome();
    }, [clearPendingFollowForUser, clearPendingOutcome, pendingFollowByUserId]);

    const patchSelectedMemberFromProfile = useCallback((memberUserId: number, profile: NonNullable<MemberProfileResponse['memberProfile']>) => {
        setSelectedMember((prev) => {
            if (!prev || prev.userId !== memberUserId) return prev;
            return {
                ...prev,
                pubkey: profile.user.pubkey,
                viewerFollows: profile.viewerFollows,
                isSelf: profile.isSelf,
                stats: {
                    citations: profile.totalCitations,
                    crystals: profile.ownedCrystalCount,
                    circles: profile.circleCount,
                },
                sharedCircles: profile.sharedCircles,
                recentActivity: profile.recentActivity.map((activity) => ({
                    type: activity.type,
                    text: activity.text,
                    time: timeAgo(activity.createdAt, locale),
                })),
                loading: false,
                errorMessage: null,
            };
        });
    }, [locale, setSelectedMember]);

    useEffect(() => {
        if (!pendingOutcome) return;
        setPendingFollowByUserId((prev) => ({
            ...prev,
            [pendingOutcome.userId]: pendingOutcome,
        }));
    }, [pendingOutcome]);

    const toggleSelectedMemberFollow = useCallback(async (nextFollowState: boolean) => {
        if (!selectedMember) return;

        const memberUserId = selectedMember.userId;
        const targetPubkey = selectedMember.pubkey || null;
        const optimisticPending = createPendingFollowState(memberUserId, nextFollowState);
        setPendingFollowByUserId((prev) => ({
            ...prev,
            [memberUserId]: optimisticPending,
        }));

        const result = nextFollowState
            ? await followUser({
                targetUserId: memberUserId,
                targetPubkey,
            })
            : await unfollowUser({
                targetUserId: memberUserId,
                targetPubkey,
            });

        if (!result.ok) {
            clearPendingFollowForUser(memberUserId);
            return;
        }

        if (result.pendingOutcome) {
            setPendingFollowByUserId((prev) => ({
                ...prev,
                [memberUserId]: result.pendingOutcome as PendingFollowState,
            }));
        } else {
            clearPendingFollowForUser(memberUserId);
        }

        try {
            const refreshed = await loadMemberProfile({
                variables: {
                    circleId: activeDiscussionCircleId,
                    userId: memberUserId,
                },
            });
            const profile = refreshed.data?.memberProfile;
            if (!profile) return;
            patchSelectedMemberFromProfile(memberUserId, profile);
            if (shouldClearPendingFollow(
                result.pendingOutcome || optimisticPending,
                profile.viewerFollows,
                Date.now(),
            )) {
                clearPendingFollowForUser(memberUserId);
                clearPendingOutcome();
            }
        } catch (refreshError) {
            console.warn('[CirclePage] refresh member follow state failed', refreshError);
        }
    }, [
        activeDiscussionCircleId,
        clearPendingFollowForUser,
        clearPendingOutcome,
        followUser,
        loadMemberProfile,
        patchSelectedMemberFromProfile,
        selectedMember,
        unfollowUser,
    ]);

    useEffect(() => {
        if (!selectedMember) return;
        const pending = selectedMemberPendingFollow;
        if (!pending || pending.status === 'syncing') return;

        if (shouldClearPendingFollow(pending, Boolean(selectedMember.viewerFollows), Date.now())) {
            clearPendingFollowForUser(selectedMember.userId);
            clearPendingOutcome();
            return;
        }

        let cancelled = false;
        const timer = window.setInterval(async () => {
            if (cancelled) return;

            const nowMs = Date.now();
            if (shouldClearPendingFollow(pending, Boolean(selectedMember.viewerFollows), nowMs)) {
                clearPendingFollowForUser(selectedMember.userId);
                clearPendingOutcome();
                return;
            }

            try {
                const refreshed = await loadMemberProfile({
                    variables: {
                        circleId: activeDiscussionCircleId,
                        userId: selectedMember.userId,
                    },
                });
                if (cancelled) return;
                const profile = refreshed.data?.memberProfile;
                if (!profile) return;

                setSelectedMember((prev) => {
                    if (!prev || prev.userId !== selectedMember.userId) return prev;
                    return {
                        ...prev,
                        pubkey: profile.user.pubkey,
                        viewerFollows: profile.viewerFollows,
                        isSelf: profile.isSelf,
                        loading: false,
                        errorMessage: null,
                    };
                });

                if (shouldClearPendingFollow(pending, profile.viewerFollows, Date.now())) {
                    clearPendingFollowForUser(selectedMember.userId);
                    clearPendingOutcome();
                }
            } catch (pollError) {
                console.warn('[CirclePage] polling member follow state failed', pollError);
            }
        }, FOLLOW_INDEX_TIMEOUT_RECOVERY_POLL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [
        activeDiscussionCircleId,
        clearPendingFollowForUser,
        clearPendingOutcome,
        loadMemberProfile,
        selectedMember,
        selectedMemberPendingFollow,
        setSelectedMember,
    ]);

    const memberCardTargetPubkey = selectedMember?.pubkey || null;
    const memberCardFollowState = useMemo<MemberFollowState | null>(() => {
        if (!selectedMember) return null;
        return {
            isSelf: Boolean(selectedMember.isSelf),
            viewerFollows: selectedMemberFollowViewState?.viewerFollows ?? Boolean(selectedMember.viewerFollows),
            loading: followLoading,
            syncing: Boolean(followSyncing || selectedMemberFollowViewState?.syncing),
            indexTimeout: Boolean(selectedMemberFollowViewState?.indexTimeout || followStatus === 'index_timeout'),
            disabled: !selectedMember.pubkey,
            hint: selectedMemberFollowViewState?.indexTimeout
                ? indexTimeoutHint
                : (followError && (followStatus === 'index_timeout' || followStatus === 'error') ? followError : null),
        };
    }, [
        followError,
        followLoading,
        followStatus,
        followSyncing,
        indexTimeoutHint,
        selectedMember,
        selectedMemberFollowViewState,
    ]);

    const clearSelectedMemberFollowState = useCallback(() => {
        if (selectedMember) {
            clearPendingFollowForUser(selectedMember.userId);
        }
        clearPendingOutcome();
    }, [clearPendingFollowForUser, clearPendingOutcome, selectedMember]);

    return {
        memberCardTargetPubkey,
        memberCardFollowState,
        toggleSelectedMemberFollow,
        reconcilePendingWithServer,
        clearSelectedMemberFollowState,
    };
}
