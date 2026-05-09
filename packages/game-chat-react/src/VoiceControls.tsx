import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface VoiceParticipantState {
  walletPubkey: string;
  speaking?: boolean;
  muted?: boolean;
  mutedBySelf?: boolean;
  mutedByModerator?: boolean;
}

export interface VoiceConnectionState {
  connected: boolean;
  participants: VoiceParticipantState[];
  mutedBySelf: boolean;
  mutedByModerator: boolean;
  speaking: boolean;
}

export interface VoiceConnectionAdapter {
  readonly state: VoiceConnectionState;
  leave(): Promise<void> | void;
  setMutedBySelf?(muted: boolean): Promise<void> | void;
}

export interface VoiceClientAdapter {
  joinVoice(
    roomKey: string,
    input?: { ttlSec?: number; communicationSessionToken?: string },
  ): Promise<VoiceConnectionAdapter>;
}

export interface VoiceControlsProps {
  roomKey: string;
  voiceClient: VoiceClientAdapter;
  className?: string;
  disabled?: boolean;
  ttlSec?: number;
  communicationSessionToken?: string;
  participantLabel?: (participant: VoiceParticipantState) => ReactNode;
  refreshIntervalMs?: number;
  onError?: (error: Error) => void;
}

export function VoiceControls({
  roomKey,
  voiceClient,
  className,
  disabled = false,
  ttlSec,
  communicationSessionToken,
  participantLabel,
  refreshIntervalMs = 1000,
  onError,
}: VoiceControlsProps) {
  const [connection, setConnection] = useState<VoiceConnectionAdapter | null>(
    null,
  );
  const connectionRef = useRef<VoiceConnectionAdapter | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceConnectionState | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    if (!connection) {
      setSnapshot(null);
      return undefined;
    }
    setSnapshot(connection.state);
    const timer = setInterval(() => {
      setSnapshot(connection.state);
    }, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [connection, refreshIntervalMs]);

  useEffect(() => {
    return () => {
      void connectionRef.current?.leave();
    };
  }, []);

  const join = useCallback(async () => {
    if (disabled || joining || connection?.state.connected) return;
    setJoining(true);
    try {
      const nextConnection = await voiceClient.joinVoice(roomKey, {
        ttlSec,
        communicationSessionToken,
      });
      setConnection(nextConnection);
      setSnapshot(nextConnection.state);
    } catch (error) {
      reportError(error, onError);
    } finally {
      setJoining(false);
    }
  }, [
    communicationSessionToken,
    connection,
    disabled,
    joining,
    onError,
    roomKey,
    ttlSec,
    voiceClient,
  ]);

  const leave = useCallback(async () => {
    const activeConnection = connection;
    if (!activeConnection) return;
    try {
      await activeConnection.leave();
    } catch (error) {
      reportError(error, onError);
    } finally {
      setConnection(null);
      setSnapshot(null);
    }
  }, [connection, onError]);

  const toggleMute = useCallback(async () => {
    if (!connection?.setMutedBySelf || !snapshot) return;
    try {
      await connection.setMutedBySelf(!snapshot.mutedBySelf);
      setSnapshot(connection.state);
    } catch (error) {
      reportError(error, onError);
    }
  }, [connection, onError, snapshot]);

  const connected = Boolean(snapshot?.connected);
  const mutedByModerator = Boolean(snapshot?.mutedByModerator);
  const participants = snapshot?.participants ?? EMPTY_PARTICIPANTS;

  return (
    <section className={joinClassNames("alcheme-voice-controls", className)}>
      <div className="alcheme-voice-controls__actions">
        {connected ? (
          <button
            className="alcheme-voice-controls__button"
            onClick={leave}
            type="button"
          >
            Leave
          </button>
        ) : (
          <button
            className="alcheme-voice-controls__button"
            disabled={disabled || joining}
            onClick={join}
            type="button"
          >
            {joining ? "Joining" : "Join"}
          </button>
        )}
        <button
          className="alcheme-voice-controls__button"
          disabled={
            !connected || !connection?.setMutedBySelf || mutedByModerator
          }
          onClick={toggleMute}
          type="button"
        >
          {snapshot?.mutedBySelf ? "Unmute" : "Mute"}
        </button>
      </div>

      {mutedByModerator ? (
        <p className="alcheme-voice-controls__notice" role="status">
          Listen only
        </p>
      ) : null}

      <ul className="alcheme-voice-controls__participants">
        {participants.map((participant) => (
          <li
            className="alcheme-voice-controls__participant"
            key={participant.walletPubkey}
          >
            <span>
              {participantLabel
                ? participantLabel(participant)
                : shortenPubkey(participant.walletPubkey)}
            </span>
            {participant.speaking ? (
              <span className="alcheme-voice-controls__participant-state">
                Speaking
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function reportError(error: unknown, onError?: (error: Error) => void): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  onError?.(normalized);
}

function shortenPubkey(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const EMPTY_PARTICIPANTS: VoiceParticipantState[] = [];
