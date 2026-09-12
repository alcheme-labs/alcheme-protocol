import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from "livekit-client";

import type { VoiceJoinToken } from "@/lib/api/voice";
import { isBrowserOnlyMockWallet } from "@/lib/testing/browserOnlyMockPolicy";

export interface VoiceParticipantState {
  walletPubkey: string;
  speaking: boolean;
  muted: boolean;
  mutedBySelf?: boolean;
  mutedByModerator?: boolean;
}

export interface LiveKitBrowserVoiceConnection {
  leave(): Promise<void>;
  setMicrophoneMuted(muted: boolean): Promise<void>;
  getParticipants(): VoiceParticipantState[];
}

export interface LiveKitBrowserVoiceJoinInput extends VoiceJoinToken {
  onParticipantsChanged?: () => void;
}

export interface LiveKitBrowserVoiceProvider {
  join(
    input: LiveKitBrowserVoiceJoinInput,
  ): Promise<LiveKitBrowserVoiceConnection>;
}

export function createLiveKitBrowserVoiceProvider(): LiveKitBrowserVoiceProvider {
  const e2eProvider = resolveE2EVoiceProvider();
  if (e2eProvider) return e2eProvider;

  return {
    async join(input) {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      const connection = new LiveKitRoomConnection(room, input.canPublishAudio);
      if (input.onParticipantsChanged) {
        connection.subscribeToParticipantChanges(input.onParticipantsChanged);
      }

      try {
        await room.connect(input.url, input.token, {
          autoSubscribe: input.canSubscribe,
        });
        if (input.canPublishAudio) {
          await room.localParticipant.setMicrophoneEnabled(true);
        }
      } catch (error) {
        await connection.leave().catch(() => undefined);
        throw error;
      }
      input.onParticipantsChanged?.();
      return connection;
    },
  };
}

function resolveE2EVoiceProvider(): LiveKitBrowserVoiceProvider | null {
  if (!isBrowserOnlyMockWallet()) return null;
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as typeof globalThis & {
    __ALCHEME_E2E_VOICE_PROVIDER__?: LiveKitBrowserVoiceProvider;
  }).__ALCHEME_E2E_VOICE_PROVIDER__;
  return candidate && typeof candidate.join === "function" ? candidate : null;
}

class LiveKitRoomConnection implements LiveKitBrowserVoiceConnection {
  private readonly offHandlers: Array<() => void> = [];

  constructor(
    private readonly room: Room,
    private readonly canPublishAudio: boolean,
  ) {}

  subscribeToParticipantChanges(onParticipantsChanged: () => void): void {
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionStateChanged,
    ];
    events.forEach((event) => {
      this.room.on(event, onParticipantsChanged);
      this.offHandlers.push(() => this.room.off(event, onParticipantsChanged));
    });
  }

  async leave(): Promise<void> {
    this.offHandlers.splice(0).forEach((off) => off());
    await Promise.resolve(
      this.room.localParticipant
        .setMicrophoneEnabled(false)
        .catch(() => undefined),
    );
    await Promise.resolve(this.room.disconnect());
  }

  async setMicrophoneMuted(muted: boolean): Promise<void> {
    if (!this.canPublishAudio) {
      return;
    }
    await this.room.localParticipant.setMicrophoneEnabled(!muted);
  }

  getParticipants(): VoiceParticipantState[] {
    return [
      mapParticipant(this.room.localParticipant, true),
      ...Array.from(this.room.remoteParticipants.values()).map((participant) =>
        mapParticipant(participant, false),
      ),
    ];
  }
}

function mapParticipant(
  participant: Participant,
  isLocal: boolean,
): VoiceParticipantState {
  const microphonePublication = participant.getTrackPublication(
    Track.Source.Microphone,
  ) as TrackPublication | undefined;
  const microphoneMuted = microphonePublication?.isMuted ?? false;
  return {
    walletPubkey: participant.identity,
    speaking: participant.isSpeaking,
    muted: microphoneMuted,
    mutedBySelf: isLocal ? microphoneMuted : undefined,
  };
}
