import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nacl = require("tweetnacl");
const bs58Module = require("bs58");
const bs58 = bs58Module.default ?? bs58Module;

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
buildSdkDist();

const {
  createAlchemeGameChatClient,
} = require(join(rootDir, "sdk/dist/runtime/communication.js"));
const {
  createAlchemeVoiceClient,
} = require(join(rootDir, "sdk/dist/runtime/voice.js"));

const apiBaseUrl =
  process.env.ALCHEME_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const externalOrigin =
  process.env.ALCHEME_EXTERNAL_ORIGIN ?? "http://127.0.0.1:5173";
const appId = process.env.ALCHEME_EXTERNAL_APP_ID ?? "smoke-web3-game";
const adminToken = process.env.EXTERNAL_APP_ADMIN_TOKEN ?? "local-external-app-admin";
const externalAppRegistryMode = process.env.EXTERNAL_APP_REGISTRY_MODE ?? "disabled";
const requireVoice = process.env.ALCHEME_SMOKE_REQUIRE_VOICE === "true";
const skipRegistration =
  process.env.ALCHEME_SKIP_EXTERNAL_APP_REGISTRATION === "true";

const keyPair = nacl.sign.keyPair();
const walletPubkey = bs58.encode(Buffer.from(keyPair.publicKey));
const wallet = {
  publicKey: walletPubkey,
  async signMessage(message) {
    return nacl.sign.detached(message, keyPair.secretKey);
  },
};

async function main() {
  if (!skipRegistration) {
    await registerSandboxApp();
  }
  await assertCorsOriginAccepted();

  const chat = createAlchemeGameChatClient({
    apiBaseUrl,
    wallet,
    fetch: originFetch,
  });

  const joined = await chat.joinExternalRoom({
    externalAppId: appId,
    roomType: "party",
    externalRoomId: `local-smoke-${Date.now()}`,
    walletPubkey,
    ttlSec: 900,
    sessionTtlSec: 900,
    sessionClientMeta: { smoke: "external-game-local" },
  });

  const message = await chat.sendRoomMessage(joined.room.roomKey, {
    text: "external game local smoke message",
    senderHandle: "smoke-player",
  });
  const messageRef = message.envelopeId ?? message.id;
  if (!messageRef) {
    throw new Error("smoke_message_missing_reference");
  }
  const messages = await chat.listRoomMessages(joined.room.roomKey, {
    limit: 5,
  });
  if (!messages.some((item) => (item.envelopeId ?? item.id) === messageRef)) {
    throw new Error("smoke_message_not_listed");
  }

  const voiceHealth = await getVoiceHealth();
  let voiceToken = null;
  if (voiceHealth.health?.enabled) {
    const voice = createAlchemeVoiceClient({
      apiBaseUrl,
      wallet,
      fetch: originFetch,
      providerClient: {
        async join(input) {
          return {
            providerRoomId: input.providerRoomId,
            async leave() {},
            getParticipants() {
              return [];
            },
          };
        },
      },
    });
    voice.setCommunicationSession(
      joined.room.roomKey,
      joined.communicationAccessToken,
    );
    const voiceSession = await voice.createVoiceSession(joined.room.roomKey, {
      ttlSec: 900,
    });
    voiceToken = await voice.createVoiceToken(voiceSession.id, {
      roomKey: joined.room.roomKey,
    });
  } else if (requireVoice) {
    throw new Error("voice_provider_disabled");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        appId,
        externalAppRegistryMode,
        roomKey: joined.room.roomKey,
        memberWallet: joined.member.walletPubkey,
        messageId: messageRef,
        voice: voiceToken
          ? {
              provider: voiceToken.provider,
              providerRoomId: voiceToken.providerRoomId,
              canSubscribe: voiceToken.canSubscribe,
            }
          : { skipped: true, reason: "provider_disabled" },
      },
      null,
      2,
    ),
  );
}

async function assertCorsOriginAccepted() {
  const response = await fetch(`${apiBaseUrl}/health`, {
    method: "OPTIONS",
    headers: {
      Origin: externalOrigin,
      "Access-Control-Request-Method": "GET",
    },
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`cors_preflight_failed:${response.status}`);
  }
}

async function registerSandboxApp() {
  const response = await fetch(`${apiBaseUrl}/external-apps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-external-app-admin-token": adminToken,
    },
    body: JSON.stringify({
      id: appId,
      name: "Smoke Web3 Game",
      ownerPubkey: walletPubkey,
      allowedOrigins: [externalOrigin],
      claimAuthMode: "wallet_only_dev",
      config: { environment: "sandbox", reviewLevel: "sandbox" },
    }),
  });
  if (!response.ok) {
    throw new Error(`external_app_registration_failed:${response.status}`);
  }
}

async function getVoiceHealth() {
  const response = await originFetch(`${apiBaseUrl}/voice/health`);
  if (!response.ok) {
    throw new Error(`voice_health_failed:${response.status}`);
  }
  return response.json();
}

function originFetch(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Origin: externalOrigin,
    },
  });
}

function buildSdkDist() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    execFileSync(process.execPath, [npmExecPath, "--prefix", join(rootDir, "sdk"), "run", "build"], {
      stdio: "inherit",
    });
    return;
  }
  execFileSync("npm", ["--prefix", join(rootDir, "sdk"), "run", "build"], {
    stdio: "inherit",
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
