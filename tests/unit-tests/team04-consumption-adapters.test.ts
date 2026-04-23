import { strict as assert } from "node:assert";
import { describe, it } from "mocha";

import {
  buildCrystalOutputViewModel,
} from "../../frontend/src/features/crystal-output/adapter";
import {
  attachStableOutputDraftBindings,
  buildCircleSummaryMapViewModel,
  formatCircleSummaryGeneratedByLabel,
  buildDraftReferenceLinkConsumptionNeeds,
  buildSummaryDependencyViewModel,
  formatDraftReferenceLinkConsumptionFieldLabel,
  formatSummaryDegradationLabel,
  pickCircleSummarySnapshot,
  pickAutoSelectedFrozenSummaryDraftConsumption,
  pickFrozenSummaryDraftConsumption,
} from "../../frontend/src/features/circle-summary/adapter";
import {
  buildForkReadinessViewModel,
  pickForkTeam04ResolvedInputs,
} from "../../frontend/src/features/fork-lineage/adapter";

describe("Team 04 consumption adapters", () => {
  it("maps crystal output from the existing knowledge chain without inventing a second output truth", () => {
    const view = buildCrystalOutputViewModel({
      knowledgeId: "kn_001",
      title: "Shared crystal",
      version: 3,
      contributorsCount: 4,
      createdAt: "2026-03-16T10:00:00.000Z",
      stats: {
        citationCount: 9,
      },
      contributors: [
        {
          sourceType: "SNAPSHOT",
          sourceDraftPostId: 42,
          sourceAnchorId: "anchor_123",
          sourceSummaryHash: "s".repeat(64),
          sourceMessagesDigest: "m".repeat(64),
        },
      ],
      references: [
        { knowledgeId: "kn_ref_1" },
        { knowledgeId: "kn_ref_2" },
      ],
      citedBy: [
        { knowledgeId: "kn_by_1" },
      ],
    });

    assert.deepEqual(view, {
      knowledgeId: "kn_001",
      title: "Shared crystal",
      versionLabel: "v3",
      citationCount: 9,
      contributorCount: 4,
      outboundReferenceCount: 2,
      inboundReferenceCount: 1,
      sourceBindingKind: "snapshot",
      sourceDraftPostId: 42,
      sourceAnchorId: "anchor_123",
      sourceSummaryHash: "s".repeat(64),
      sourceMessagesDigest: "m".repeat(64),
      createdAt: "2026-03-16T10:00:00.000Z",
      missingTeam03Inputs: [],
    });
  });

  it("falls back to settlement-backed output evidence when no snapshot contributor is present", () => {
    const view = buildCrystalOutputViewModel({
      knowledgeId: "kn_002",
      title: "Fallback crystal",
      version: 1,
      contributorsCount: 1,
      createdAt: "2026-03-16T12:00:00.000Z",
      stats: {
        citationCount: 0,
      },
      contributors: [
        {
          sourceType: "SETTLEMENT",
          sourceDraftPostId: null,
          sourceAnchorId: null,
          sourceSummaryHash: null,
          sourceMessagesDigest: null,
        },
      ],
      references: [],
      citedBy: [],
    });

    assert.equal(view.sourceBindingKind, "settlement_fallback");
    assert.equal(view.sourceDraftPostId, null);
    assert.equal(view.outboundReferenceCount, 0);
    assert.equal(view.inboundReferenceCount, 0);
    assert.deepEqual(view.missingTeam03Inputs, [
      "snapshot-backed output evidence",
      "stable output to draft binding",
    ]);
  });

  it("does not fabricate snapshot-backed evidence from unlabeled contributor fields", () => {
    const view = buildCrystalOutputViewModel({
      knowledgeId: "kn_002b",
      title: "Unlabeled crystal",
      version: 1,
      contributorsCount: 1,
      createdAt: "2026-03-16T12:05:00.000Z",
      stats: {
        citationCount: 0,
      },
      contributors: [
        {
          sourceType: null,
          sourceDraftPostId: 51,
          sourceAnchorId: "u".repeat(64),
          sourceSummaryHash: "v".repeat(64),
          sourceMessagesDigest: "w".repeat(64),
        },
      ],
      references: [],
      citedBy: [],
    });

    assert.equal(view.sourceBindingKind, "unlabeled");
    assert.equal(view.sourceDraftPostId, null);
    assert.equal(view.sourceAnchorId, null);
    assert.equal(view.sourceSummaryHash, null);
    assert.equal(view.sourceMessagesDigest, null);
    assert.deepEqual(view.missingTeam03Inputs, [
      "snapshot-backed output evidence",
      "stable output to draft binding",
    ]);
  });

  it("does not collapse conflicting snapshot contributors into a fake single draft binding", () => {
    const view = buildCrystalOutputViewModel({
      knowledgeId: "kn_002c",
      title: "Ambiguous snapshot crystal",
      version: 2,
      contributorsCount: 2,
      createdAt: "2026-03-16T12:06:00.000Z",
      stats: {
        citationCount: 1,
      },
      contributors: [
        {
          sourceType: "SNAPSHOT",
          sourceDraftPostId: 51,
          sourceAnchorId: "a".repeat(64),
          sourceSummaryHash: "b".repeat(64),
          sourceMessagesDigest: "c".repeat(64),
        },
        {
          sourceType: "SNAPSHOT",
          sourceDraftPostId: 52,
          sourceAnchorId: "d".repeat(64),
          sourceSummaryHash: "e".repeat(64),
          sourceMessagesDigest: "f".repeat(64),
        },
      ],
      references: [],
      citedBy: [],
    });

    assert.equal(view.sourceBindingKind, "snapshot");
    assert.equal(view.sourceDraftPostId, null);
    assert.equal(view.sourceAnchorId, null);
    assert.equal(view.sourceSummaryHash, null);
    assert.equal(view.sourceMessagesDigest, null);
    assert.deepEqual(view.missingTeam03Inputs, [
      "stable output to draft binding",
    ]);
  });

  it("narrows draft lifecycle consumption to frozen summary fields only", () => {
    const narrowed = pickFrozenSummaryDraftConsumption({
      draftPostId: 42,
      circleId: 7,
      documentStatus: "drafting",
      currentSnapshotVersion: 3,
      stableSnapshot: {
        draftVersion: 3,
        sourceKind: "review_bound_snapshot",
        createdAt: "2026-03-16T13:00:00.000Z",
        seedDraftAnchorId: "a".repeat(64),
        sourceEditAnchorId: "b".repeat(64),
        sourceSummaryHash: "c".repeat(64),
        sourceMessagesDigest: "d".repeat(64),
        contentHash: "e".repeat(64),
      },
      workingCopy: {
        draftPostId: 42,
        basedOnSnapshotVersion: 3,
        workingCopyHash: "f".repeat(64),
        status: "active",
        updatedAt: "2026-03-16T13:30:00.000Z",
        workingCopyContent: "forbidden",
        workingCopyId: "forbidden",
        roomKey: "forbidden",
        latestEditAnchorId: "forbidden",
        latestEditAnchorStatus: "forbidden",
      },
      handoff: {
        candidateId: "forbidden",
      },
      warnings: ["forbidden"],
    });

    assert.deepEqual(narrowed.document, {
      draftPostId: 42,
      circleId: 7,
      documentStatus: "drafting",
      currentSnapshotVersion: 3,
    });
    assert.deepEqual(narrowed.stableSnapshot, {
      draftVersion: 3,
      sourceKind: "review_bound_snapshot",
      createdAt: "2026-03-16T13:00:00.000Z",
      seedDraftAnchorId: "a".repeat(64),
      sourceEditAnchorId: "b".repeat(64),
      sourceSummaryHash: "c".repeat(64),
      sourceMessagesDigest: "d".repeat(64),
      contentHash: "e".repeat(64),
    });
    assert.deepEqual(narrowed.workingCopy, {
      draftPostId: 42,
      basedOnSnapshotVersion: 3,
      workingCopyHash: "f".repeat(64),
      status: "active",
      updatedAt: "2026-03-16T13:30:00.000Z",
    });
    assert.equal("workingCopyContent" in narrowed.workingCopy, false);
    assert.equal("workingCopyId" in narrowed.workingCopy, false);
    assert.equal("roomKey" in narrowed.workingCopy, false);
    assert.equal("handoff" in narrowed, false);
  });

  it("narrows CircleSummarySnapshot consumption to the frozen outer fields and keeps generator provenance", () => {
    const snapshot = pickCircleSummarySnapshot({
      summaryId: "circle-7-v2",
      circleId: 7,
      version: 2,
      issueMap: [
        {
          title: "主问题",
          body: "当前最成熟的议题入口。",
          emphasis: "primary",
        },
      ],
      conceptGraph: {
        nodes: [{ id: "knowledge-1", label: "结论 A", version: 2 }],
        edges: [],
      },
      viewpointBranches: [],
      factExplanationEmotionBreakdown: {
        facts: [],
        explanations: [],
        emotions: [],
      },
      emotionConflictContext: {
        tensionLevel: "low",
        notes: [],
      },
      sedimentationTimeline: [],
      openQuestions: [],
      generatedAt: "2026-03-21T00:15:00.000Z",
      generatedBy: "system_projection",
      internalDiagnostics: {
        staleBecause: "forbidden",
      },
    });

    assert.equal(snapshot.summaryId, "circle-7-v2");
    assert.equal(snapshot.generatedBy, "system_projection");
    assert.equal(formatCircleSummaryGeneratedByLabel(snapshot.generatedBy), "系统投影");
    assert.deepEqual(snapshot.issueMap, [
      {
        title: "主问题",
        body: "当前最成熟的议题入口。",
        emphasis: "primary",
      },
    ]);
    assert.equal("internalDiagnostics" in snapshot, false);
  });

  it("documents DraftReferenceLink consumption needs without assuming a public exit location", () => {
    const needs = buildDraftReferenceLinkConsumptionNeeds();

    assert.equal(needs.publicReadiness, "public_read_exit_live");
    assert.deepEqual(
      needs.fields.map((field) => field.field),
      [
        "referenceId",
        "draftPostId",
        "draftVersion",
        "sourceBlockId",
        "crystalName",
        "crystalBlockAnchor",
        "status",
      ],
    );
    assert.match(needs.note, /独立的 DraftReferenceLink 公共读出口/);
  });

  it("derives summary degradation state from frozen draft selection and output binding quality", () => {
    const state = buildSummaryDependencyViewModel({
      draft: null,
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_003",
          title: "Unbound crystal",
          version: 1,
          contributorsCount: 1,
          createdAt: "2026-03-16T14:00:00.000Z",
          stats: { citationCount: 0 },
          contributors: [],
          references: [],
          citedBy: [],
        }),
      ],
    });

    assert.deepEqual(state.missingTeam03Inputs, [
      "selected frozen draft lifecycle input",
      "snapshot-backed output evidence",
      "stable output to draft binding",
    ]);
    assert.equal(state.hasSelectedDraft, false);
  });

  it("auto-selects a frozen draft lifecycle input from a stable snapshot-bound output when summary route has no ?draft", () => {
    const draft = pickAutoSelectedFrozenSummaryDraftConsumption({
      requestedDraftPostId: null,
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_004",
          title: "Bound crystal",
          version: 2,
          contributorsCount: 2,
          createdAt: "2026-03-16T14:10:00.000Z",
          stats: { citationCount: 1 },
          contributors: [
            {
              sourceType: "SNAPSHOT",
              sourceDraftPostId: 77,
              sourceAnchorId: "a".repeat(64),
              sourceSummaryHash: "b".repeat(64),
              sourceMessagesDigest: "c".repeat(64),
            },
          ],
          references: [],
          citedBy: [],
        }),
      ],
      draftCandidates: [
        {
          document: {
            draftPostId: 77,
            circleId: 9,
            documentStatus: "drafting",
            currentSnapshotVersion: 3,
          },
          stableSnapshot: {
            draftVersion: 3,
            sourceKind: "review_bound_snapshot",
            createdAt: "2026-03-16T14:05:00.000Z",
            seedDraftAnchorId: "a".repeat(64),
            sourceEditAnchorId: "d".repeat(64),
            sourceSummaryHash: "b".repeat(64),
            sourceMessagesDigest: "c".repeat(64),
            contentHash: "e".repeat(64),
          },
          workingCopy: {
            draftPostId: 77,
            basedOnSnapshotVersion: 3,
            workingCopyHash: "f".repeat(64),
            status: "active",
            updatedAt: "2026-03-16T14:09:00.000Z",
          },
        },
      ],
    });

    assert.equal(draft?.document.draftPostId, 77);
  });

  it("upgrades output to a stable draft binding only when frozen snapshot evidence matches exactly one draft candidate", () => {
    const outputs = attachStableOutputDraftBindings({
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_005",
          title: "Derivable crystal",
          version: 2,
          contributorsCount: 2,
          createdAt: "2026-03-16T14:20:00.000Z",
          stats: { citationCount: 2 },
          contributors: [
            {
              sourceType: "SNAPSHOT",
              sourceDraftPostId: null,
              sourceAnchorId: "1".repeat(64),
              sourceSummaryHash: "2".repeat(64),
              sourceMessagesDigest: "3".repeat(64),
            },
          ],
          references: [],
          citedBy: [],
        }),
      ],
      draftCandidates: [
        {
          document: {
            draftPostId: 88,
            circleId: 9,
            documentStatus: "drafting",
            currentSnapshotVersion: 4,
          },
          stableSnapshot: {
            draftVersion: 4,
            sourceKind: "review_bound_snapshot",
            createdAt: "2026-03-16T14:18:00.000Z",
            seedDraftAnchorId: "1".repeat(64),
            sourceEditAnchorId: "4".repeat(64),
            sourceSummaryHash: "2".repeat(64),
            sourceMessagesDigest: "3".repeat(64),
            contentHash: "5".repeat(64),
          },
          workingCopy: {
            draftPostId: 88,
            basedOnSnapshotVersion: 4,
            workingCopyHash: "6".repeat(64),
            status: "active",
            updatedAt: "2026-03-16T14:19:00.000Z",
          },
        },
      ],
    });

    assert.equal(outputs[0].sourceBindingKind, "snapshot");
    assert.equal(outputs[0].sourceDraftPostId, 88);
    assert.deepEqual(outputs[0].missingTeam03Inputs, []);
  });

  it("auto-selects a frozen draft after deriving a unique stable binding from snapshot evidence", () => {
    const draft = pickAutoSelectedFrozenSummaryDraftConsumption({
      requestedDraftPostId: null,
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_005b",
          title: "Auto-derived crystal",
          version: 2,
          contributorsCount: 2,
          createdAt: "2026-03-16T14:22:00.000Z",
          stats: { citationCount: 2 },
          contributors: [
            {
              sourceType: "SNAPSHOT",
              sourceDraftPostId: null,
              sourceAnchorId: "1".repeat(64),
              sourceSummaryHash: "2".repeat(64),
              sourceMessagesDigest: "3".repeat(64),
            },
          ],
          references: [],
          citedBy: [],
        }),
      ],
      draftCandidates: [
        {
          document: {
            draftPostId: 88,
            circleId: 9,
            documentStatus: "drafting",
            currentSnapshotVersion: 4,
          },
          stableSnapshot: {
            draftVersion: 4,
            sourceKind: "review_bound_snapshot",
            createdAt: "2026-03-16T14:18:00.000Z",
            seedDraftAnchorId: "1".repeat(64),
            sourceEditAnchorId: "4".repeat(64),
            sourceSummaryHash: "2".repeat(64),
            sourceMessagesDigest: "3".repeat(64),
            contentHash: "5".repeat(64),
          },
          workingCopy: {
            draftPostId: 88,
            basedOnSnapshotVersion: 4,
            workingCopyHash: "6".repeat(64),
            status: "active",
            updatedAt: "2026-03-16T14:19:00.000Z",
          },
        },
      ],
    });

    assert.equal(draft?.document.draftPostId, 88);
    assert.equal(draft?.stableSnapshot.draftVersion, 4);
  });

  it("does not auto-select a frozen draft when multiple snapshot-bound outputs point to different drafts", () => {
    const draft = pickAutoSelectedFrozenSummaryDraftConsumption({
      requestedDraftPostId: null,
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_005c",
          title: "First bound crystal",
          version: 2,
          contributorsCount: 1,
          createdAt: "2026-03-16T14:23:00.000Z",
          stats: { citationCount: 1 },
          contributors: [
            {
              sourceType: "SNAPSHOT",
              sourceDraftPostId: 88,
              sourceAnchorId: "1".repeat(64),
              sourceSummaryHash: "2".repeat(64),
              sourceMessagesDigest: "3".repeat(64),
            },
          ],
          references: [],
          citedBy: [],
        }),
        buildCrystalOutputViewModel({
          knowledgeId: "kn_005d",
          title: "Second bound crystal",
          version: 2,
          contributorsCount: 1,
          createdAt: "2026-03-16T14:24:00.000Z",
          stats: { citationCount: 1 },
          contributors: [
            {
              sourceType: "SNAPSHOT",
              sourceDraftPostId: 99,
              sourceAnchorId: "7".repeat(64),
              sourceSummaryHash: "8".repeat(64),
              sourceMessagesDigest: "9".repeat(64),
            },
          ],
          references: [],
          citedBy: [],
        }),
      ],
      draftCandidates: [
        {
          document: {
            draftPostId: 88,
            circleId: 9,
            documentStatus: "drafting",
            currentSnapshotVersion: 4,
          },
          stableSnapshot: {
            draftVersion: 4,
            sourceKind: "review_bound_snapshot",
            createdAt: "2026-03-16T14:18:00.000Z",
            seedDraftAnchorId: "1".repeat(64),
            sourceEditAnchorId: "4".repeat(64),
            sourceSummaryHash: "2".repeat(64),
            sourceMessagesDigest: "3".repeat(64),
            contentHash: "5".repeat(64),
          },
          workingCopy: {
            draftPostId: 88,
            basedOnSnapshotVersion: 4,
            workingCopyHash: "6".repeat(64),
            status: "active",
            updatedAt: "2026-03-16T14:19:00.000Z",
          },
        },
        {
          document: {
            draftPostId: 99,
            circleId: 9,
            documentStatus: "drafting",
            currentSnapshotVersion: 5,
          },
          stableSnapshot: {
            draftVersion: 5,
            sourceKind: "review_bound_snapshot",
            createdAt: "2026-03-16T14:18:30.000Z",
            seedDraftAnchorId: "7".repeat(64),
            sourceEditAnchorId: "a".repeat(64),
            sourceSummaryHash: "8".repeat(64),
            sourceMessagesDigest: "9".repeat(64),
            contentHash: "b".repeat(64),
          },
          workingCopy: {
            draftPostId: 99,
            basedOnSnapshotVersion: 5,
            workingCopyHash: "c".repeat(64),
            status: "active",
            updatedAt: "2026-03-16T14:19:30.000Z",
          },
        },
      ],
    });

    assert.equal(draft, null);
  });

  it("closes all three Team 03 readiness gaps once snapshot evidence resolves a unique frozen draft baseline", () => {
    const draftCandidates = [
      {
        document: {
          draftPostId: 188,
          circleId: 9,
          documentStatus: "drafting" as const,
          currentSnapshotVersion: 4,
        },
        stableSnapshot: {
          draftVersion: 4,
          sourceKind: "review_bound_snapshot" as const,
          createdAt: "2026-03-16T14:18:00.000Z",
          seedDraftAnchorId: "1".repeat(64),
          sourceEditAnchorId: "4".repeat(64),
          sourceSummaryHash: "2".repeat(64),
          sourceMessagesDigest: "3".repeat(64),
          contentHash: "5".repeat(64),
        },
        workingCopy: {
          draftPostId: 188,
          basedOnSnapshotVersion: 4,
          workingCopyHash: "6".repeat(64),
          status: "active" as const,
          updatedAt: "2026-03-16T14:19:00.000Z",
        },
      },
    ];

    const outputs = attachStableOutputDraftBindings({
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_005c",
          title: "Resolved summary crystal",
          version: 2,
          contributorsCount: 2,
          createdAt: "2026-03-16T14:24:00.000Z",
          stats: { citationCount: 2 },
          contributors: [
            {
              sourceType: "SNAPSHOT",
              sourceDraftPostId: null,
              sourceAnchorId: "1".repeat(64),
              sourceSummaryHash: "2".repeat(64),
              sourceMessagesDigest: "3".repeat(64),
            },
          ],
          references: [],
          citedBy: [],
        }),
      ],
      draftCandidates,
    });

    const draft = pickAutoSelectedFrozenSummaryDraftConsumption({
      requestedDraftPostId: null,
      outputs,
      draftCandidates,
    });

    const state = buildSummaryDependencyViewModel({
      draft,
      outputs,
    });

    assert.equal(draft?.document.draftPostId, 188);
    assert.deepEqual(outputs[0].missingTeam03Inputs, []);
    assert.equal(state.hasSelectedDraft, true);
    assert.deepEqual(state.missingTeam03Inputs, []);
  });

  it("builds a summary map view model from stable outputs, draft baseline, and fork hint", () => {
    const outputs = [
      buildCrystalOutputViewModel({
        knowledgeId: "kn_summary_1",
        title: "先明确谁在主导当前议题",
        version: 3,
        contributorsCount: 4,
        createdAt: "2026-03-16T16:30:00.000Z",
        stats: { citationCount: 6 },
        contributors: [
          {
            sourceType: "SNAPSHOT",
            sourceDraftPostId: 201,
            sourceAnchorId: "1".repeat(64),
            sourceSummaryHash: "2".repeat(64),
            sourceMessagesDigest: "3".repeat(64),
          },
        ],
        references: [{ knowledgeId: "ref_1" }],
        citedBy: [{ knowledgeId: "ref_2" }, { knowledgeId: "ref_3" }],
      }),
      buildCrystalOutputViewModel({
        knowledgeId: "kn_summary_2",
        title: "是否继续向更高层共识推进",
        version: 1,
        contributorsCount: 2,
        createdAt: "2026-03-16T14:30:00.000Z",
        stats: { citationCount: 1 },
        contributors: [
          {
            sourceType: "SETTLEMENT",
            sourceDraftPostId: null,
            sourceAnchorId: null,
            sourceSummaryHash: null,
            sourceMessagesDigest: null,
          },
        ],
        references: [],
        citedBy: [],
      }),
    ];

    const draft = {
      document: {
        draftPostId: 201,
        circleId: 36,
        documentStatus: "drafting" as const,
        currentSnapshotVersion: 5,
      },
      stableSnapshot: {
        draftVersion: 5,
        sourceKind: "review_bound_snapshot" as const,
        createdAt: "2026-03-16T16:00:00.000Z",
        seedDraftAnchorId: "1".repeat(64),
        sourceEditAnchorId: "4".repeat(64),
        sourceSummaryHash: "2".repeat(64),
        sourceMessagesDigest: "3".repeat(64),
        contentHash: "5".repeat(64),
      },
      workingCopy: {
        draftPostId: 201,
        basedOnSnapshotVersion: 5,
        workingCopyHash: "6".repeat(64),
        status: "active" as const,
        updatedAt: "2026-03-16T16:20:00.000Z",
      },
    };

    const forkHint = buildForkReadinessViewModel({
      sourceCircleId: 36,
      sourceCircleName: "第六个",
      sourceLevel: 0,
      resolvedInputs: pickForkTeam04ResolvedInputs({
        circleId: 36,
        forkThresholdResolvedView: {
          enabled: true,
          thresholdMode: "contribution_threshold",
          minimumContributions: 3,
          minimumRole: "Member",
          requiresGovernanceVote: true,
        },
        inheritanceResolvedView: {
          circleId: 36,
          sourceType: "circle_override",
          inheritanceMode: "inherit_but_editable",
          localEditability: "editable",
          inheritsFromProfileId: "profile_36_v2",
          inheritsFromCircleId: 1,
          lv0AppliesToFutureCirclesOnly: true,
          inheritLockedMaterializedAtCreate: true,
          runtimeLiveParentLookup: false,
        },
        minimumFieldSet: {
          configVersion: 2,
          effectiveFrom: "2026-03-16T12:00:00.000Z",
          resolvedFromProfileVersion: 2,
          inheritancePrefillSource: "lv0_default_profile",
          knowledgeLineageInheritance: "upstream_until_fork_node",
        },
      }),
    });

    const summary = buildCircleSummaryMapViewModel({
      circleId: 36,
      draft,
      outputs,
      forkHint,
    });

    assert.equal(summary.hero.title, "圈层 36 的认知地图");
    assert.equal(summary.defaultFocusBranchId, "kn_summary_1");
    assert.deepEqual(summary.situation.map((item) => item.label), [
      "已经形成的结论",
      "当前可见入口",
      "可回看的正文",
    ]);
    assert.equal(summary.situation[0].description, "先看已经稳定沉淀下来的内容。");
    assert.equal(summary.situation[1].description, "这里只统计当前能直接进入的路线入口，不代表完整分支图。");
    assert.equal(summary.issueMap[0].title, "先看这条已经站稳的结论");
    assert.match(summary.issueMap[0].body, /先明确谁在主导当前议题/);
    assert.equal(summary.branches.length, 2);
    assert.equal(summary.branches[0].routeLabel, "主线入口");
    assert.equal(summary.branches[1].routeLabel, "并行观察点");
    assert.equal(summary.branches[0].routeHint, "如果你第一次进入这个圈层，先从这里开始。");
    assert.equal(summary.branches[0].statusLabel, "当前最成熟");
    assert.equal(summary.branches[0].bindingLabel, "已回到草稿 #201");
    assert.equal(summary.branches[0].citationSummary, "总被引 6 · 预览引用 1 / 预览被引 2");
    assert.equal(summary.coverage[0].label, "稳定快照支撑");
    assert.equal(summary.coverage[0].value, "1");
    assert.equal(summary.timeline[0].title, "稳定草稿基线 v5");
    assert.match(summary.timeline[1].summary, /已沉淀为知识结果/);
    assert.deepEqual(summary.openQuestions.map((item) => item.title), [
      "部分沉淀仍缺稳定快照",
      "部分结果还没有稳定回到来源草稿",
    ]);
  });

  it("keeps summary map honest when the circle still has no stable outputs", () => {
    const summary = buildCircleSummaryMapViewModel({
      circleId: 36,
      draft: null,
      outputs: [],
      forkHint: null,
    });

    assert.equal(summary.defaultFocusBranchId, null);
    assert.equal(summary.branches.length, 0);
    assert.equal(summary.issueMap[0].title, "先看这条已经站稳的结论");
    assert.match(summary.issueMap[0].body, /还没有形成稳定的沉淀结果/);
    assert.deepEqual(summary.openQuestions.map((item) => item.title), [
      "这个圈层的第一条稳定沉淀还没有出现",
      "还没有唯一的正文基线",
    ]);
  });

  it("keeps settlement fallback outputs degraded when no stable snapshot evidence exists", () => {
    const outputs = attachStableOutputDraftBindings({
      outputs: [
        buildCrystalOutputViewModel({
          knowledgeId: "kn_006",
          title: "Settlement only crystal",
          version: 1,
          contributorsCount: 1,
          createdAt: "2026-03-16T14:30:00.000Z",
          stats: { citationCount: 0 },
          contributors: [
            {
              sourceType: "SETTLEMENT",
              sourceDraftPostId: null,
              sourceAnchorId: null,
              sourceSummaryHash: null,
              sourceMessagesDigest: null,
            },
          ],
          references: [],
          citedBy: [],
        }),
      ],
      draftCandidates: [
        {
          document: {
            draftPostId: 99,
            circleId: 9,
            documentStatus: "drafting",
            currentSnapshotVersion: 2,
          },
          stableSnapshot: {
            draftVersion: 2,
            sourceKind: "review_bound_snapshot",
            createdAt: "2026-03-16T14:28:00.000Z",
            seedDraftAnchorId: "7".repeat(64),
            sourceEditAnchorId: "8".repeat(64),
            sourceSummaryHash: "9".repeat(64),
            sourceMessagesDigest: "a".repeat(64),
            contentHash: "b".repeat(64),
          },
          workingCopy: {
            draftPostId: 99,
            basedOnSnapshotVersion: 2,
            workingCopyHash: "c".repeat(64),
            status: "active",
            updatedAt: "2026-03-16T14:29:00.000Z",
          },
        },
      ],
    });

    assert.equal(outputs[0].sourceBindingKind, "settlement_fallback");
    assert.equal(outputs[0].sourceDraftPostId, null);
    assert.deepEqual(outputs[0].missingTeam03Inputs, [
      "snapshot-backed output evidence",
      "stable output to draft binding",
    ]);
  });

  it("maps Team 01 team04-inputs into a real fork hint view model", () => {
    const hint = buildForkReadinessViewModel({
      sourceCircleId: 88,
      sourceCircleName: "Protocol Garden",
      sourceLevel: 2,
      resolvedInputs: pickForkTeam04ResolvedInputs({
        circleId: 88,
        forkThresholdResolvedView: {
          enabled: true,
          thresholdMode: "contribution_threshold",
          minimumContributions: 5,
          minimumRole: "Member",
          requiresGovernanceVote: true,
        },
        inheritanceResolvedView: {
          circleId: 88,
          sourceType: "circle_override",
          inheritanceMode: "inherit_but_editable",
          localEditability: "editable",
          inheritsFromProfileId: "profile_88_v4",
          inheritsFromCircleId: 12,
          lv0AppliesToFutureCirclesOnly: true,
          inheritLockedMaterializedAtCreate: true,
          runtimeLiveParentLookup: false,
        },
        minimumFieldSet: {
          configVersion: 4,
          effectiveFrom: "2026-03-16T08:00:00.000Z",
          resolvedFromProfileVersion: 4,
          inheritancePrefillSource: "lv0_default_profile",
          knowledgeLineageInheritance: "upstream_until_fork_node",
        },
      }),
    });

    assert.equal(hint.sourceCircleId, 88);
    assert.equal(hint.sourceCircleName, "Protocol Garden");
    assert.equal(hint.sourceLevelLabel, "第 2 层");
    assert.equal(hint.thresholdLabel, "至少累计 5 份贡献，成员身份不低于普通成员，并通过一次治理表决。");
    assert.equal(hint.inheritanceLabel, "会先带入上游配置，创建后仍可继续调整。");
    assert.equal(hint.knowledgeLineageLabel, "会沿用上游知识脉络，直到新的分支节点出现。");
    assert.equal(hint.prefillSourceLabel, "创建时会带入默认配置（当前第 4 版）。");
    assert.equal(hint.currentQualificationLabel, "还差 5 份贡献，达到门槛后即可提交。");
    assert.equal(hint.contributionProgressLabel, "0 / 5 份贡献");
    assert.equal(hint.identityFloorLabel, "保护线：普通成员");
    assert.equal(hint.contributorCount, 0);
    assert.equal(hint.qualificationStatus, "contribution_shortfall");
    assert.equal(hint.canSubmitFork, false);
    assert.equal(hint.statusBadgeLabel, "贡献仍不足");
    assert.equal(hint.slogan, "当分歧已指向不同的未来，分叉比彼此裹挟更诚实。");
    assert.equal(
      hint.declarationPlaceholder,
      "写下这次分叉想守住的方向差异，以及为什么需要从当前圈层独立开始。",
    );
    assert.equal(hint.hintTitle, "继续分支条件");
    assert.equal(
      hint.hintBody,
      "这里会同时说明贡献门槛、身份保护线、继承方式和知识延续范围，创建入口只保留在圈层页。",
    );
  });

  it("narrows Team 01 team04-inputs to the minimum fork fields Team 04 should consume", () => {
    const narrowed = pickForkTeam04ResolvedInputs({
      circleId: 13,
      forkThresholdResolvedView: {
        enabled: false,
        thresholdMode: "contribution_threshold",
        minimumContributions: 1,
        minimumRole: "Initiate",
        requiresGovernanceVote: false,
      },
      inheritanceResolvedView: {
        circleId: 13,
        sourceType: "lv0_default",
        inheritanceMode: "independent",
        localEditability: "editable",
        inheritsFromProfileId: null,
        inheritsFromCircleId: null,
        lv0AppliesToFutureCirclesOnly: true,
        inheritLockedMaterializedAtCreate: true,
        runtimeLiveParentLookup: false,
      },
      minimumFieldSet: {
        configVersion: 1,
        effectiveFrom: "2026-03-16T08:00:00.000Z",
        resolvedFromProfileVersion: null,
        inheritancePrefillSource: "lv0_default_profile",
        knowledgeLineageInheritance: "upstream_until_fork_node",
      },
      policyProfile: {
        forbidden: true,
      },
    });

    assert.deepEqual(narrowed, {
      circleId: 13,
      forkThresholdResolvedView: {
        enabled: false,
        thresholdMode: "contribution_threshold",
        minimumContributions: 1,
        minimumRole: "Initiate",
        requiresGovernanceVote: false,
      },
      inheritanceResolvedView: {
        circleId: 13,
        sourceType: "lv0_default",
        inheritanceMode: "independent",
        localEditability: "editable",
        inheritsFromProfileId: null,
        inheritsFromCircleId: null,
      },
      minimumFieldSet: {
        configVersion: 1,
        effectiveFrom: "2026-03-16T08:00:00.000Z",
        resolvedFromProfileVersion: null,
        inheritancePrefillSource: "lv0_default_profile",
        knowledgeLineageInheritance: "upstream_until_fork_node",
      },
    });
  });

  it("formats summary degradation labels into product-facing Chinese copy", () => {
    assert.equal(
      formatSummaryDegradationLabel("selected frozen draft lifecycle input"),
      "尚未定位唯一的草稿基线",
    );
    assert.equal(
      formatSummaryDegradationLabel("snapshot-backed output evidence"),
      "当前结论还没有稳定快照来源",
    );
    assert.equal(
      formatSummaryDegradationLabel("stable output to draft binding"),
      "当前结论还没有稳定草稿绑定",
    );
  });

  it("formats DraftReferenceLink field labels into Chinese display copy", () => {
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("referenceId"), "引用标识");
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("draftPostId"), "来源草稿");
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("draftVersion"), "草稿版本");
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("sourceBlockId"), "来源段落");
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("crystalName"), "结晶名称");
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("crystalBlockAnchor"), "结晶片段");
    assert.equal(formatDraftReferenceLinkConsumptionFieldLabel("status"), "解析状态");
  });

  it("maps Team 01 team04-inputs into calm product-facing fork copy", () => {
    const hint = buildForkReadinessViewModel({
      sourceCircleId: 21,
      sourceCircleName: "Quiet Garden",
      sourceLevel: 3,
      resolvedInputs: pickForkTeam04ResolvedInputs({
        circleId: 21,
        forkThresholdResolvedView: {
          enabled: true,
          thresholdMode: "contribution_threshold",
          minimumContributions: 3,
          minimumRole: "Member",
          requiresGovernanceVote: true,
        },
        inheritanceResolvedView: {
          circleId: 21,
          sourceType: "circle_override",
          inheritanceMode: "inherit_but_editable",
          localEditability: "editable",
          inheritsFromProfileId: "profile_21_v2",
          inheritsFromCircleId: 8,
        },
        minimumFieldSet: {
          configVersion: 2,
          effectiveFrom: "2026-03-16T08:00:00.000Z",
          resolvedFromProfileVersion: 2,
          inheritancePrefillSource: "lv0_default_profile",
          knowledgeLineageInheritance: "upstream_until_fork_node",
        },
      }),
    });

    assert.equal(hint.sourceLevelLabel, "第 3 层");
    assert.equal(hint.thresholdLabel, "至少累计 3 份贡献，成员身份不低于普通成员，并通过一次治理表决。");
    assert.equal(hint.inheritanceLabel, "会先带入上游配置，创建后仍可继续调整。");
    assert.equal(hint.knowledgeLineageLabel, "会沿用上游知识脉络，直到新的分支节点出现。");
    assert.equal(hint.prefillSourceLabel, "创建时会带入默认配置（当前第 2 版）。");
    assert.equal(hint.currentQualificationLabel, "还差 3 份贡献，达到门槛后即可提交。");
    assert.equal(hint.contributionProgressLabel, "0 / 3 份贡献");
    assert.equal(hint.identityFloorLabel, "保护线：普通成员");
    assert.equal(hint.statusBadgeLabel, "贡献仍不足");
    assert.equal(hint.hintTitle, "继续分支条件");
    assert.match(hint.hintBody, /贡献门槛、身份保护线、继承方式和知识延续范围/);
  });
});
