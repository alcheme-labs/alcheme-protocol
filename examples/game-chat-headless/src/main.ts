import {
  createAlchemeGameChatClient,
  createAlchemeVoiceClient,
  type VoiceProviderClient,
  type WalletSigner,
} from "@alcheme/sdk";

interface AppRoomClaim {
  payload: string;
  signature: string;
}

const apiBaseUrl =
  process.env.ALCHEME_API_BASE_URL ?? "http://localhost:4000/api/v1";

const wallet: WalletSigner = {
  publicKey: process.env.ALCHEME_WALLET_PUBKEY ?? "",
  async signMessage(_message: Uint8Array): Promise<Uint8Array> {
    throw new Error("Replace with the connected wallet signMessage method");
  },
};

const voiceProviderClient: VoiceProviderClient = {
  async join(input) {
    console.log("Join voice provider room", {
      provider: input.provider,
      url: input.url,
      providerRoomId: input.providerRoomId,
      canPublishAudio: input.canPublishAudio,
      canSubscribe: input.canSubscribe,
    });

    return {
      async leave() {
        console.log("Leave voice provider room", input.providerRoomId);
      },
      async setMicrophoneMuted(muted: boolean) {
        console.log("Set local microphone muted", muted);
      },
      getParticipants() {
        return [];
      },
    };
  },
};

async function fetchAppRoomClaim(input: {
  externalAppId: string;
  roomType: string;
  externalRoomId: string;
  walletPubkey: string;
}): Promise<AppRoomClaim> {
  const response = await fetch("/game-server/alcheme-room-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`claim request failed: ${response.status}`);
  }
  return response.json() as Promise<AppRoomClaim>;
}

async function main() {
  if (!wallet.publicKey) {
    throw new Error("Set ALCHEME_WALLET_PUBKEY or inject a connected wallet");
  }

  const chat = createAlchemeGameChatClient({
    apiBaseUrl,
    wallet,
  });
  const voice = createAlchemeVoiceClient({
    apiBaseUrl,
    wallet,
    providerClient: voiceProviderClient,
  });

  const roomInput = {
    externalAppId: "example-web3-game",
    roomType: "dungeon",
    externalRoomId: "run-8791",
    walletPubkey: wallet.publicKey,
  };
  const appRoomClaim = await fetchAppRoomClaim(roomInput);

  const joined = await chat.joinExternalRoom({
    ...roomInput,
    parentCircleId: 130,
    ttlSec: 7200,
    appRoomClaim,
    sessionTtlSec: 7200,
    sessionClientMeta: { client: "game-chat-headless-example" },
  });
  const { room, session } = joined;

  await chat.sendRoomMessage(room.roomKey, {
    text: "wait, pulling next pack",
    senderHandle: "player-1",
  });

  await chat.sendRoomVoiceClip(room.roomKey, {
    storageUri: "https://cdn.example.test/clips/clip-1.webm",
    durationMs: 4200,
    fileSizeBytes: 8192,
    payloadText: "optional fallback caption",
    senderHandle: "player-1",
  });

  const recentMessages = await chat.listRoomMessages(room.roomKey, {
    afterLamport: 0,
    limit: 20,
  });
  console.log("Recent room messages", recentMessages);

  const subscription = chat.subscribeRoomMessages(room.roomKey, (event) => {
    console.log("Room event", event);
  });

  voice.setCommunicationSession(room.roomKey, joined.communicationAccessToken);
  const connection = await voice.joinVoice(room.roomKey, {
    ttlSec: 7200,
  });

  console.log("Voice state", connection.state);

  subscription.close();
  await connection.leave();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
