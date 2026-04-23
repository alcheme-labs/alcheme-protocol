import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "mocha";

import {
  formatCircleSummaryGeneratedByLabel,
  pickCircleSummarySnapshot,
  resolveCircleSummaryPresentation,
} from "../../frontend/src/features/circle-summary/adapter";
import {
  buildCrystalOutputViewModel,
} from "../../frontend/src/features/crystal-output/adapter";

describe("circle summary snapshot consumption", () => {
  const scaffoldSource = readFileSync(
    resolve(process.cwd(), "frontend/src/features/circle-summary/CircleSummaryScaffold.tsx"),
    "utf8",
  );
  const summaryApiSource = readFileSync(
    resolve(process.cwd(), "frontend/src/features/circle-summary/api.ts"),
    "utf8",
  );
  const summaryPageSource = readFileSync(
    resolve(process.cwd(), "frontend/src/app/(main)/circles/[id]/summary/page.tsx"),
    "utf8",
  );
  const sanctuaryTabSource = readFileSync(
    resolve(process.cwd(), "frontend/src/components/circle/SanctuaryTab/SanctuaryTab.tsx"),
    "utf8",
  );
  const crystalDetailSource = readFileSync(
    resolve(process.cwd(), "frontend/src/components/circle/CrystalDetailSheet/CrystalDetailSheet.tsx"),
    "utf8",
  );

  it("prefers CircleSummarySnapshot truth over scaffold inputs and exposes diagnostics", () => {
    const snapshot = pickCircleSummarySnapshot({
      summaryId: "circle-7-v4",
      circleId: 7,
      version: 4,
      issueMap: [
        {
          title: "快照主问题",
          body: "当前快照明确把这条议题作为主要入口。",
          emphasis: "primary",
        },
      ],
      conceptGraph: {
        nodes: [{ id: "knowledge-1", label: "结论 A", version: 4 }],
        edges: [],
      },
      viewpointBranches: [
        {
          knowledgeId: "knowledge-1",
          title: "快照主线",
          routeLabel: "主线入口",
          routeHint: "先沿着正式快照这条线往下看。",
          sourceDraftPostId: 42,
          sourceBindingKind: "snapshot",
          citationSummary: "总被引 3 · 预览引用 1 / 预览被引 1",
          createdAtLabel: "3月21日",
        },
      ],
      factExplanationEmotionBreakdown: {
        facts: [{ label: "已结晶输出", value: 1 }],
        explanations: [{ label: "主线说明", body: "当前主线由正式快照给出。" }],
        emotions: [{ label: "总体氛围", value: "趋于收敛" }],
      },
      emotionConflictContext: {
        tensionLevel: "low",
        notes: ["当前没有未关闭的问题单。"],
      },
      sedimentationTimeline: [
        {
          key: "draft-42-v4",
          title: "稳定草稿基线 v4",
          summary: "当前总结以草稿 #42 为正文来源。",
          timeLabel: "3月21日",
        },
      ],
      openQuestions: [
        {
          title: "下一步继续看哪里",
          body: "优先沿着当前主线继续补充引用关系。",
        },
      ],
      generatedAt: "2026-03-21T00:15:00.000Z",
      generatedBy: "system_llm",
      forbiddenInternalField: "ignore-me",
    });

    const fallbackOutput = buildCrystalOutputViewModel({
      knowledgeId: "knowledge-fallback",
      title: "Fallback crystal",
      version: 1,
      contributorsCount: 1,
      createdAt: "2026-03-21T00:00:00.000Z",
      stats: { citationCount: 0 },
      contributors: [],
      references: [],
      citedBy: [],
    });

    const resolved = resolveCircleSummaryPresentation({
      circleId: 7,
      snapshot,
      draft: null,
      outputs: [fallbackOutput],
      forkHint: null,
    });

    assert.equal(resolved.source, "snapshot");
    assert.equal(resolved.summaryMap.issueMap[0]?.title, "快照主问题");
    assert.equal(resolved.summaryMap.branches[0]?.title, "快照主线");
    assert.equal(resolved.diagnostics?.version, 4);
    assert.equal(resolved.diagnostics?.generatedBy, "system_llm");
    assert.equal(formatCircleSummaryGeneratedByLabel(resolved.diagnostics?.generatedBy || "system_projection"), "系统 LLM");
  });

  it("refuses to treat scaffold-derived routes as formal summary truth when no snapshot exists", () => {
    const output = buildCrystalOutputViewModel({
      knowledgeId: "knowledge-1",
      title: "Fallback crystal",
      version: 2,
      contributorsCount: 2,
      createdAt: "2026-03-21T00:00:00.000Z",
      stats: { citationCount: 1 },
      contributors: [],
      references: [],
      citedBy: [],
    });

    const resolved = resolveCircleSummaryPresentation({
      circleId: 7,
      snapshot: null,
      draft: null,
      outputs: [output],
      forkHint: null,
    });

    assert.equal(resolved.source, "pending_snapshot");
    assert.equal(resolved.summaryMap, null);
    assert.equal(resolved.diagnostics, null);
  });

  it("removes summary-page fork placeholders after the snapshot route becomes formal truth", () => {
    assert.doesNotMatch(scaffoldSource, /正在整理继续分支需要看的门槛与继承条件/);
    assert.doesNotMatch(scaffoldSource, /继续分支条件暂时还不可读/);
    assert.doesNotMatch(scaffoldSource, /继续分支条件仍待补齐/);
  });

  it("reads summary output evidence from the formal crystallization route instead of adapter-only contributors", () => {
    assert.match(summaryApiSource, /fetchCrystallizationOutputRecordByKnowledgeId/);
    assert.match(summaryApiSource, /buildCrystalOutputViewModelFromRecord/);
  });

  it("does not collapse formal-output read failures into a fake empty summary state", () => {
    assert.match(summaryApiSource, /formalReadWarnings\.push/);
    assert.match(summaryApiSource, /warning: formalReadWarnings\.length > 0/);
    assert.match(summaryPageSource, /nextOutputs\.warning/);
  });

  it("keeps adapter-only CrystalOutput panels out of sanctuary cards and routes crystal details through formal output reads", () => {
    assert.doesNotMatch(sanctuaryTabSource, /CrystalOutputEvidencePanel/);
    assert.doesNotMatch(sanctuaryTabSource, /buildCrystalOutputViewModel\(/);
    assert.match(crystalDetailSource, /buildCrystalOutputViewModelFromRecord/);
    assert.match(crystalDetailSource, /fetchCrystallizationOutputRecordByKnowledgeId/);
  });
});
