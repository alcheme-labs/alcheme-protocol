import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readOptionalSource(url) {
  try {
    return readFileSync(url, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

const plazaSource = readFileSync(
  new URL("../src/components/circle/PlazaTab/PlazaTab.tsx", import.meta.url),
  "utf8",
);
const communicationApiSource = readOptionalSource(
  new URL("../src/lib/api/communication.ts", import.meta.url),
);
const voiceApiSource = readOptionalSource(
  new URL("../src/lib/api/voice.ts", import.meta.url),
);
const livekitProviderSource = readOptionalSource(
  new URL("../src/lib/voice/livekitClient.ts", import.meta.url),
);
const cssSource = readFileSync(
  new URL("../src/app/(main)/circles/[id]/page.module.css", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

for (const locale of ["en", "zh", "fr", "es"]) {
  test(`PlazaTab voice entry has locale copy: ${locale}`, () => {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../src/i18n/messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
    const voice = messages.PlazaTab?.voice;
    assert.equal(typeof voice?.join, "string");
    assert.equal(typeof voice?.joining, "string");
    assert.equal(typeof voice?.connected, "string");
    assert.equal(typeof voice?.mute, "string");
    assert.equal(typeof voice?.unmute, "string");
    assert.equal(typeof voice?.leave, "string");
    assert.equal(typeof voice?.participantCount, "string");
    assert.equal(typeof voice?.managementTitle, "string");
    assert.equal(typeof voice?.activeSpeakerCount, "string");
    assert.equal(typeof voice?.queuePosition, "string");
    assert.equal(typeof voice?.approve, "string");
    assert.equal(typeof voice?.deny, "string");
    assert.equal(typeof voice?.settingsTitle, "string");
    assert.equal(typeof voice?.maxSpeakers, "string");
    assert.equal(typeof voice?.overflowStrategy, "string");
    assert.equal(typeof voice?.savePolicy, "string");
    assert.equal(typeof voice?.policyLoaded, "string");
    assert.equal(typeof voice?.walletRequired, "string");
    assert.equal(typeof voice?.membershipRequired, "string");
    assert.equal(typeof voice?.joinFailed, "string");
  });
}

test("PlazaTab exposes voice controls from the existing composer surface", () => {
  assert.match(plazaSource, /Mic(?:Off)?|PhoneOff|Loader2/);
  assert.match(plazaSource, /handleJoinVoice/);
  assert.match(plazaSource, /handleLeaveVoice/);
  assert.match(plazaSource, /handleToggleVoiceMute/);
  assert.match(plazaSource, /ensureCircleCommunicationRoomSession/);
  assert.match(plazaSource, /updateCircleRoomVoicePolicy/);
  assert.doesNotMatch(plazaSource, /createCommunicationSession/);
  assert.match(plazaSource, /createVoiceSession/);
  assert.match(plazaSource, /createVoiceToken/);
  assert.match(plazaSource, /fetchVoiceParticipants/);
  assert.match(plazaSource, /approveVoiceSpeaker/);
  assert.match(plazaSource, /denyVoiceSpeaker/);
  assert.match(plazaSource, /createLiveKitBrowserVoiceProvider/);
  assert.match(plazaSource, /styles\.composerVoiceBtn/);
  assert.match(plazaSource, /styles\.composerVoiceDock/);
  assert.match(plazaSource, /t\(["']voice\.join["']\)/);
});

test("voice API uses communication session auth before requesting provider tokens", () => {
  assert.match(
    communicationApiSource,
    /buildCommunicationSessionBootstrapMessage/,
  );
  assert.match(communicationApiSource, /alcheme-communication-session:/);
  assert.match(communicationApiSource, /\/api\/v1\/communication\/sessions/);
  assert.match(
    communicationApiSource,
    /\/api\/v1\/communication\/circles\/\$\{[^}]+\}\/room-session/,
  );
  assert.match(communicationApiSource, /\/room\/voice-policy/);
  assert.match(communicationApiSource, /ensureCircleCommunicationRoomSession/);
  assert.match(communicationApiSource, /record\.room/);
  assert.match(communicationApiSource, /signature/);
  assert.match(voiceApiSource, /reused/);
  assert.match(voiceApiSource, /\/api\/v1\/voice\/sessions/);
  assert.match(voiceApiSource, /\/participants/);
  assert.match(voiceApiSource, /\/speakers\/\$\{[^}]+\}\/\$\{decision\}/);
  assert.match(
    voiceApiSource,
    /Authorization["']?\s*:\s*`Bearer \$\{communicationSessionToken\}`/,
  );
});

test("Plaza voice policy settings load existing room policy before save can overwrite it", () => {
  assert.match(plazaSource, /voicePolicyLoaded/);
  assert.match(plazaSource, /setVoicePolicyLoaded\(true\)/);
  assert.match(plazaSource, /setVoicePolicyDirty\(true\)/);
  assert.match(plazaSource, /!voicePolicyLoaded && !voicePolicyDirty/);
  assert.match(plazaSource, /disabled=\{voicePolicySaving \|\| !voicePolicyLoaded\}/);
  assert.match(plazaSource, /disabled=\{!voicePolicyLoaded \|\| voicePolicySaving\}/);
  assert.match(plazaSource, /if \(!voiceManagement \|\| voicePolicyDirty\) return;/);
});

test("browser voice provider is backed by the official LiveKit client package", () => {
  assert.equal(typeof packageJson.dependencies?.["livekit-client"], "string");
  assert.match(livekitProviderSource, /from ["']livekit-client["']/);
  assert.match(livekitProviderSource, /new Room/);
  assert.match(livekitProviderSource, /setMicrophoneEnabled/);
  assert.match(livekitProviderSource, /RoomEvent/);
});

test("Plaza voice entry has stable composer sizing and status styles", () => {
  assert.match(cssSource, /\.composerVoiceBtn/);
  assert.match(cssSource, /\.composerVoiceBtnActive/);
  assert.match(cssSource, /\.composerVoiceDock/);
  assert.match(cssSource, /\.composerVoiceControls/);
});
