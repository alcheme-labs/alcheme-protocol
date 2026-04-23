import { strict as assert } from "node:assert";
import { describe, it } from "mocha";

import {
  buildCrystalOutputViewModelFromRecord,
} from "../../frontend/src/features/crystal-output/adapter";

describe("formal CrystalOutput contract consumption", () => {
  it("only exposes formal output truth when a crystallization output record exists", () => {
    const view = buildCrystalOutputViewModelFromRecord({
      knowledge: {
        knowledgeId: "kn_003",
        title: "Formal crystal",
        version: 2,
        contributorsCount: 3,
        createdAt: "2026-03-16T12:07:00.000Z",
        stats: {
          citationCount: 2,
        },
        contributors: [
          {
            sourceType: "SNAPSHOT",
            sourceDraftPostId: 88,
            sourceAnchorId: "legacy-anchor",
            sourceSummaryHash: "l".repeat(64),
            sourceMessagesDigest: "g".repeat(64),
          },
        ],
        references: [],
        citedBy: [],
      },
      record: {
        output: {
          knowledgeId: "kn_003",
          sourceDraftPostId: 91,
          sourceDraftVersion: 4,
          contentHash: "c".repeat(64),
          contributorsRoot: "r".repeat(64),
          createdAt: "2026-03-16T12:08:00.000Z",
        },
        bindingEvidence: {
          sourceAnchorId: "formal-anchor",
          sourceSummaryHash: "s".repeat(64),
          sourceMessagesDigest: "m".repeat(64),
        },
      },
    });

    assert.deepEqual(view, {
      knowledgeId: "kn_003",
      title: "Formal crystal",
      versionLabel: "v2",
      citationCount: 2,
      contributorCount: 3,
      outboundReferenceCount: 0,
      inboundReferenceCount: 0,
      sourceBindingKind: "snapshot",
      sourceDraftPostId: 91,
      sourceAnchorId: "formal-anchor",
      sourceSummaryHash: "s".repeat(64),
      sourceMessagesDigest: "m".repeat(64),
      createdAt: "2026-03-16T12:08:00.000Z",
      missingTeam03Inputs: [],
    });
  });

  it("withholds CrystalOutput truth when the formal output record is unavailable", () => {
    const view = buildCrystalOutputViewModelFromRecord({
      knowledge: {
        knowledgeId: "kn_004",
        title: "Pending crystal",
        version: 1,
        contributorsCount: 2,
        createdAt: "2026-03-16T12:09:00.000Z",
        stats: {
          citationCount: 0,
        },
        contributors: [
          {
            sourceType: "SNAPSHOT",
            sourceDraftPostId: 77,
            sourceAnchorId: "legacy-anchor",
            sourceSummaryHash: "q".repeat(64),
            sourceMessagesDigest: "z".repeat(64),
          },
        ],
        references: [],
        citedBy: [],
      },
      record: null,
    });

    assert.equal(view, null);
  });
});
