interface SubmitFeedReplyInput {
    parentContentId: string;
    circleId: number;
    draft: string;
    createReply: (input: {
        parentContentId: string;
        circleId: number;
        text: string;
    }) => Promise<string | null>;
    refreshThread: () => Promise<void> | void;
    refreshFeed: () => Promise<void> | void;
}

interface SubmitFeedReplyResult {
    ok: boolean;
    error?: string;
}

export async function submitFeedReply(input: SubmitFeedReplyInput): Promise<SubmitFeedReplyResult> {
    const text = input.draft.trim();
    if (!text) {
        return {
            ok: false,
            error: '评论内容不能为空',
        };
    }

    const signature = await input.createReply({
        parentContentId: input.parentContentId,
        circleId: input.circleId,
        text,
    });

    if (!signature) {
        return {
            ok: false,
        };
    }

    await input.refreshThread();
    await input.refreshFeed();

    return {
        ok: true,
    };
}
