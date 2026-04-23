import { strict as assert } from "node:assert";
import { describe, it } from "mocha";

import {
  buildDraftReferenceLinkPreview,
  pickDraftReferenceLinks,
} from "../../frontend/src/features/crystal-output/adapter";
import {
  fetchDraftReferenceLinks,
} from "../../frontend/src/features/circle-summary/api";

describe("draft reference link consumers", () => {
  it("reads DraftReferenceLink through the formal public route and strips private parser payloads", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          referenceLinks: [
            {
              referenceId: "ref-1",
              draftPostId: 42,
              draftVersion: 4,
              sourceBlockId: "paragraph:0",
              crystalName: "Seed Crystal",
              crystalBlockAnchor: "anchor-1",
              status: "parsed",
              linkText: "@crystal(Seed Crystal#anchor-1)",
            },
          ],
        }),
      } as any;
    }) as any;

    try {
      const links = await fetchDraftReferenceLinks({ draftPostId: 42 });

      assert.match(calls[0] || "", /\/api\/v1\/drafts\/42\/reference-links/);
      assert.deepEqual(links, [
        {
          referenceId: "ref-1",
          draftPostId: 42,
          draftVersion: 4,
          sourceBlockId: "paragraph:0",
          crystalName: "Seed Crystal",
          crystalBlockAnchor: "anchor-1",
          status: "parsed",
        },
      ]);
      assert.equal("linkText" in links[0], false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("lets summary, output, and knowledge consumers reuse the same public DraftReferenceLink payload", () => {
    const links = pickDraftReferenceLinks([
      {
        referenceId: "ref-1",
        draftPostId: 42,
        draftVersion: 4,
        sourceBlockId: "paragraph:0",
        crystalName: "Seed Crystal",
        crystalBlockAnchor: "anchor-1",
        status: "parsed",
        linkText: "forbidden",
      },
      {
        referenceId: "ref-2",
        draftPostId: 42,
        draftVersion: 4,
        sourceBlockId: "paragraph:1",
        crystalName: "Frozen Crystal",
        crystalBlockAnchor: null,
        status: "parsed",
      },
    ]);

    const preview = buildDraftReferenceLinkPreview({
      draftPostId: 42,
      referenceLinks: links,
    });

    assert.equal(preview.totalCount, 2);
    assert.equal(preview.sourceBlockCount, 2);
    assert.deepEqual(preview.crystalNames, ["Seed Crystal", "Frozen Crystal"]);
  });
});
