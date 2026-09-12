'use client';

import { useEffect, useRef } from 'react';
import { markCircleAnnouncementSeen } from '@/lib/api/circleAnnouncements';
import type { CircleAnnouncementDetailDto } from './types.ts';

export interface UseAnnouncementSeenInput {
    announcement: CircleAnnouncementDetailDto | null;
    senderPubkey: string | null;
    discussionAccessToken?: string | null;
    enabled?: boolean;
    onSeen?: (announcement: CircleAnnouncementDetailDto) => void;
}

export function useAnnouncementSeen<T extends HTMLElement>({
    announcement,
    senderPubkey,
    discussionAccessToken,
    enabled = true,
    onSeen,
}: UseAnnouncementSeenInput) {
    const targetRef = useRef<T | null>(null);
    const timerRef = useRef<number | null>(null);
    const sentRef = useRef<string | null>(null);
    const firstSeenRef = useRef<{ announcementId: string | null; firstSeenAt: string | null }>({
        announcementId: announcement?.announcementId ?? null,
        firstSeenAt: announcement?.myReceipt?.firstSeenAt ?? null,
    });

    useEffect(() => {
        if (!announcement) {
            firstSeenRef.current = { announcementId: null, firstSeenAt: null };
            return;
        }
        if (firstSeenRef.current.announcementId !== announcement.announcementId) {
            firstSeenRef.current = {
                announcementId: announcement.announcementId,
                firstSeenAt: announcement.myReceipt?.firstSeenAt ?? null,
            };
            return;
        }
        firstSeenRef.current = {
            announcementId: announcement.announcementId,
            firstSeenAt: announcement.myReceipt?.firstSeenAt ?? firstSeenRef.current.firstSeenAt,
        };
    }, [announcement]);

    useEffect(() => {
        const node = targetRef.current;
        if (!node || !enabled || !announcement || !senderPubkey) {
            return undefined;
        }
        if (announcement.myReceipt?.status === 'confirmed' || announcement.myReceipt?.status === 'seen') {
            return undefined;
        }
        if (sentRef.current === announcement.announcementId) {
            return undefined;
        }
        if (typeof IntersectionObserver === 'undefined') {
            return undefined;
        }

        const clearSeenTimer = () => {
            if (timerRef.current) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };

        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!entry || !entry.isIntersecting || entry.intersectionRatio < 0.5) {
                clearSeenTimer();
                return;
            }
            if (timerRef.current) return;
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                if (sentRef.current === announcement.announcementId) return;
                sentRef.current = announcement.announcementId;
                void markCircleAnnouncementSeen({
                    circleId: announcement.circleId,
                    announcementId: announcement.announcementId,
                    senderPubkey,
                    discussionAccessToken,
                }).then((response) => {
                    const firstSeenAt = firstSeenRef.current.announcementId === response.announcement.announcementId
                        ? firstSeenRef.current.firstSeenAt
                        : null;
                    onSeen?.({
                        ...response.announcement,
                        myReceipt: response.announcement.myReceipt && firstSeenAt
                            ? {
                                ...response.announcement.myReceipt,
                                firstSeenAt,
                            }
                            : response.announcement.myReceipt,
                    });
                }).catch(() => {
                    sentRef.current = null;
                });
            }, 800);
        }, { threshold: 0.5 });

        observer.observe(node);
        return () => {
            clearSeenTimer();
            observer.disconnect();
        };
    }, [announcement, discussionAccessToken, enabled, onSeen, senderPubkey]);

    return targetRef;
}
