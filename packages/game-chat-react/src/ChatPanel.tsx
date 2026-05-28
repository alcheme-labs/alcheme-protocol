import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

export interface GameChatMessage {
  id?: string;
  envelopeId?: string;
  lamport?: number;
  messageKind?: "plain" | "voice_clip" | string;
  senderHandle?: string | null;
  senderPubkey?: string | null;
  text?: string | null;
  payloadText?: string | null;
  storageUri?: string | null;
  durationMs?: number | null;
  createdAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface GameChatMessageSubscription {
  close(): void;
  closed?: Promise<void>;
}

export interface GameChatClientAdapter {
  listRoomMessages(
    roomKey: string,
    input?: { limit?: number; afterLamport?: number; afterMessageId?: string },
  ): Promise<GameChatMessage[]>;
  sendRoomMessage(
    roomKey: string,
    input: {
      text: string;
      senderHandle?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<GameChatMessage>;
  subscribeRoomMessages?(
    roomKey: string,
    onEvent: (event: unknown) => void,
    input?: { afterLamport?: number; afterMessageId?: string },
  ): GameChatMessageSubscription;
}

export interface ChatPanelProps {
  roomKey: string;
  client: GameChatClientAdapter;
  senderHandle?: string;
  className?: string;
  disabled?: boolean;
  initialMessages?: GameChatMessage[];
  limit?: number;
  placeholder?: string;
  emptyLabel?: string;
  reconnectLabel?: string;
  renderMessage?: (message: GameChatMessage) => ReactNode;
  onError?: (error: Error) => void;
}

type StreamState = "idle" | "connecting" | "connected" | "reconnecting";

export function ChatPanel({
  roomKey,
  client,
  senderHandle,
  className,
  disabled = false,
  initialMessages = EMPTY_MESSAGES,
  limit = 50,
  placeholder = "Message",
  emptyLabel = "No messages yet.",
  reconnectLabel = "Reconnecting",
  renderMessage,
  onError,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<GameChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("idle");

  useEffect(() => {
    let active = true;
    let subscription: GameChatMessageSubscription | undefined;

    setLoading(true);
    setStreamState(client.subscribeRoomMessages ? "connecting" : "idle");

    client
      .listRoomMessages(roomKey, { limit })
      .then((nextMessages) => {
        if (!active) return;
        setMessages(mergeMessages(initialMessages, nextMessages));
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setLoading(false);
        reportError(error, onError);
      });

    if (client.subscribeRoomMessages) {
      try {
        subscription = client.subscribeRoomMessages(roomKey, (event) => {
          const message = normalizeIncomingMessage(event);
          if (!message) return;
          setMessages((current) => mergeMessages(current, [message]));
          setStreamState("connected");
        });
        subscription.closed?.catch((error) => {
          if (!active) return;
          setStreamState("reconnecting");
          reportError(error, onError);
        });
      } catch (error) {
        setStreamState("reconnecting");
        reportError(error, onError);
      }
    }

    return () => {
      active = false;
      subscription?.close();
    };
  }, [client, initialMessages, limit, onError, roomKey]);

  const canSend = useMemo(
    () => !disabled && !sending && draft.trim().length > 0,
    [disabled, draft, sending],
  );

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || disabled || sending) return;

      setSending(true);
      try {
        const message = await client.sendRoomMessage(roomKey, {
          text,
          senderHandle,
        });
        setDraft("");
        setMessages((current) => mergeMessages(current, [message]));
      } catch (error) {
        reportError(error, onError);
      } finally {
        setSending(false);
      }
    },
    [client, disabled, draft, onError, roomKey, senderHandle, sending],
  );

  return (
    <section className={joinClassNames("alcheme-chat-panel", className)}>
      <div className="alcheme-chat-panel__messages" aria-busy={loading}>
        {messages.length === 0 ? (
          <p className="alcheme-chat-panel__empty">{emptyLabel}</p>
        ) : (
          messages.map((message) => (
            <article
              className="alcheme-chat-panel__message"
              key={messageKey(message)}
            >
              {renderMessage ? (
                renderMessage(message)
              ) : (
                <DefaultMessage message={message} />
              )}
            </article>
          ))
        )}
      </div>

      {streamState === "reconnecting" ? (
        <p className="alcheme-chat-panel__status" role="status">
          {reconnectLabel}
        </p>
      ) : null}

      <form className="alcheme-chat-panel__composer" onSubmit={onSubmit}>
        <textarea
          aria-label={placeholder}
          className="alcheme-chat-panel__input"
          disabled={disabled || sending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          rows={2}
          value={draft}
        />
        <button
          className="alcheme-chat-panel__send"
          disabled={!canSend}
          type="submit"
        >
          {sending ? "Sending" : "Send"}
        </button>
      </form>
    </section>
  );
}

function DefaultMessage({ message }: { message: GameChatMessage }) {
  const body =
    message.messageKind === "voice_clip"
      ? message.payloadText || "Voice clip"
      : message.text || "";

  return (
    <>
      <header className="alcheme-chat-panel__message-meta">
        <span>
          {message.senderHandle || shortenPubkey(message.senderPubkey)}
        </span>
        {message.createdAt ? (
          <time>{formatTimestamp(message.createdAt)}</time>
        ) : null}
      </header>
      <p className="alcheme-chat-panel__message-body">{body}</p>
    </>
  );
}

function mergeMessages(
  current: readonly GameChatMessage[],
  next: readonly GameChatMessage[],
): GameChatMessage[] {
  const byKey = new Map<string, GameChatMessage>();
  for (const message of current) {
    byKey.set(messageKey(message), message);
  }
  for (const message of next) {
    byKey.set(messageKey(message), message);
  }
  return Array.from(byKey.values()).sort(compareMessages);
}

function compareMessages(
  left: GameChatMessage,
  right: GameChatMessage,
): number {
  if (typeof left.lamport === "number" && typeof right.lamport === "number") {
    return left.lamport - right.lamport;
  }
  return timestampValue(left.createdAt) - timestampValue(right.createdAt);
}

function normalizeIncomingMessage(event: unknown): GameChatMessage | null {
  if (!isRecord(event)) return null;
  const wrapped = event.message;
  if (isRecord(wrapped)) return wrapped as GameChatMessage;
  if ("text" in event || "payloadText" in event || "messageKind" in event) {
    return event as GameChatMessage;
  }
  return null;
}

function messageKey(message: GameChatMessage): string {
  return (
    message.envelopeId ||
    message.id ||
    `${message.senderPubkey || "unknown"}:${message.lamport ?? ""}:${timestampValue(
      message.createdAt,
    )}:${message.text || message.payloadText || ""}`
  );
}

function timestampValue(value: GameChatMessage["createdAt"]): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortenPubkey(pubkey?: string | null): string {
  if (!pubkey) return "Unknown";
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

function reportError(error: unknown, onError?: (error: Error) => void): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  onError?.(normalized);
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const EMPTY_MESSAGES: GameChatMessage[] = [];
