import { expect } from "chai";
import fs from "fs";
import path from "path";

function repoFile(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

function section(source: string, marker: string, nextMarker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) {
    return "";
  }
  const rest = source.slice(start);
  const end = nextMarker ? rest.indexOf(nextMarker) : -1;
  return end === -1 ? rest : rest.slice(0, end);
}

describe("event-emitter circle membership coverage", () => {
  it("maps CircleMembershipChanged in timestamp and event type helpers", () => {
    const stateRs = fs.readFileSync(
      repoFile("programs/event-emitter/src/state.rs"),
      "utf8"
    );

    const timestampBody = section(
      stateRs,
      "pub fn get_event_timestamp(event: &ProtocolEvent) -> i64 {",
      "pub fn get_event_type(event: &ProtocolEvent) -> EventType {"
    );
    const typeBody = section(
      stateRs,
      "pub fn get_event_type(event: &ProtocolEvent) -> EventType {",
      "pub fn get_event_user(event: &ProtocolEvent) -> Option<Pubkey> {"
    );

    expect(timestampBody).to.include("ProtocolEvent::CircleMembershipChanged { timestamp, .. }");
    expect(typeBody).to.include("ProtocolEvent::CircleMembershipChanged { .. } |");
    expect(typeBody).to.include("ProtocolEvent::CircleFlagsUpdated { .. } => EventType::Circle");
  });
});
