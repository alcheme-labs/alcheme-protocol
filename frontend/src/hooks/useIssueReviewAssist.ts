'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@apollo/client/react';

import { REVIEW_DRAFT_ISSUE } from '@/lib/apollo/queries';
import type {
    GQLIssueReviewAssistResult,
    IssueReviewAssistResponse,
} from '@/lib/apollo/types';

export type IssueReviewAssistStatus = 'idle' | 'pending' | 'ready' | 'error';

export interface IssueReviewAssistFormSuggestion {
    action: GQLIssueReviewAssistResult['action'];
    reason: string;
    issueType: string | null;
    proposalResolution: 'accepted' | 'rejected' | null;
    finalResolution: 'accepted' | 'rejected' | null;
    shouldRetag: boolean;
}

interface IssueReviewAssistState {
    status: IssueReviewAssistStatus;
    result: GQLIssueReviewAssistResult | null;
    error: string | null;
}

interface UseIssueReviewAssistOptions {
    draftPostId: number | null;
    threadId: string | number | null;
}

function buildFormSuggestion(
    result: GQLIssueReviewAssistResult | null,
): IssueReviewAssistFormSuggestion | null {
    if (!result) return null;

    let proposalResolution: IssueReviewAssistFormSuggestion['proposalResolution'] = null;
    let finalResolution: IssueReviewAssistFormSuggestion['finalResolution'] = null;

    if (result.action === 'propose_acceptance') {
        proposalResolution = 'accepted';
    } else if (result.action === 'propose_rejection') {
        proposalResolution = 'rejected';
    } else if (result.action === 'accept_proposal') {
        finalResolution = 'accepted';
    } else if (result.action === 'reject_proposal') {
        finalResolution = 'rejected';
    }

    return {
        action: result.action,
        reason: result.reason,
        issueType: result.issueType,
        proposalResolution,
        finalResolution,
        shouldRetag: result.action === 'suggest_retag',
    };
}

export function useIssueReviewAssist(options: UseIssueReviewAssistOptions) {
    const [state, setState] = useState<IssueReviewAssistState>({
        status: 'idle',
        result: null,
        error: null,
    });
    const [runReviewDraftIssue] = useMutation<IssueReviewAssistResponse>(REVIEW_DRAFT_ISSUE);

    const clear = useCallback(() => {
        setState({
            status: 'idle',
            result: null,
            error: null,
        });
    }, []);

    const requestReviewAssist = useCallback(async () => {
        const draftPostId = Number(options.draftPostId ?? 0);
        const threadId = String(options.threadId ?? '').trim();
        if (!Number.isFinite(draftPostId) || draftPostId <= 0 || !threadId) {
            setState({
                status: 'error',
                result: null,
                error: 'missing_draft_issue_context',
            });
            return null;
        }

        setState({
            status: 'pending',
            result: null,
            error: null,
        });

        try {
            const response = await runReviewDraftIssue({
                variables: {
                    input: {
                        draftPostId,
                        threadId,
                    },
                },
            });
            const result = response.data?.reviewDraftIssue || null;
            if (!result) {
                throw new Error('missing_issue_review_assist_result');
            }
            setState({
                status: 'ready',
                result,
                error: null,
            });
            return result;
        } catch (error) {
            setState({
                status: 'error',
                result: null,
                error: error instanceof Error ? error.message : 'issue_review_assist_failed',
            });
            return null;
        }
    }, [options.draftPostId, options.threadId, runReviewDraftIssue]);

    const applySuggestionToForm = useCallback((
        result: GQLIssueReviewAssistResult | null = state.result,
    ) => buildFormSuggestion(result), [state.result]);

    return useMemo(() => ({
        status: state.status,
        result: state.result,
        error: state.error,
        request: requestReviewAssist,
        requestReviewAssist,
        clear,
        applySuggestionToForm,
    }), [
        applySuggestionToForm,
        clear,
        requestReviewAssist,
        state.error,
        state.result,
        state.status,
    ]);
}

export default useIssueReviewAssist;
