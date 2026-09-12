export type DiscussionRealtimeTransportMode = 'websocket' | 'sse';

export function resolveDiscussionRealtimeTransportMode(input: {
    override?: DiscussionRealtimeTransportMode;
    env?: Record<string, string | undefined>;
} = {}): DiscussionRealtimeTransportMode {
    if (input.override) return input.override;
    const env = input.env ?? process.env;
    return env.NEXT_PUBLIC_DISCUSSION_REALTIME_TRANSPORT === 'sse' ? 'sse' : 'websocket';
}
