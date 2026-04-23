import { expect } from "chai";
import fs from "fs";
import path from "path";

function repoFile(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

function section(source: string, marker: string, nextMarker = ""): string {
  const start = source.indexOf(marker);
  if (start === -1) {
    return "";
  }
  const rest = source.slice(start);
  const end = nextMarker ? rest.indexOf(nextMarker) : -1;
  return end === -1 ? rest : rest.slice(0, end);
}

describe("create-content-v2 cost script", () => {
  it("threads eventEmitterPda through takeSample instead of using an undefined local", () => {
    const source = fs.readFileSync(
      repoFile("scripts/measure/create-content-v2-cost.ts"),
      "utf8",
    );

    const takeSampleSignature = section(
      source,
      "async function takeSample(params: {",
      "}): Promise<CostSample> {",
    );
    const takeSampleBody = section(
      source,
      "}): Promise<CostSample> {",
      "export async function measureCreateContentV2Cost(",
    );

    expect(takeSampleSignature).to.include("eventEmitterPda");
    expect(takeSampleBody).to.include("eventEmitterPda");
  });
});
