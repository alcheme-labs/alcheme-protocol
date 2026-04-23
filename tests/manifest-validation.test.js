const { expect } = require("chai");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function runValidator(relativeFile) {
  return spawnSync(
    "node",
    ["scripts/validate-extension-manifest.js", relativeFile],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
}

describe("Extension manifest validator", () => {
  it("passes for a valid manifest fixture", () => {
    const res = runValidator(
      "tests/fixtures/extension-manifests/valid.contribution-engine.manifest.json"
    );

    expect(res.status).to.equal(0);
    expect(res.stdout).to.contain(
      "PASS tests/fixtures/extension-manifests/valid.contribution-engine.manifest.json"
    );
  });

  it("fails when permissions contain an unknown enum value", () => {
    const res = runValidator(
      "tests/fixtures/extension-manifests/invalid.unknown-permission.manifest.json"
    );

    expect(res.status).to.equal(1);
    expect(res.stderr).to.contain("expected one of");
    expect(res.stderr).to.contain("$.required_permissions[1]");
  });

  it("fails when permissions exceed the max limit", () => {
    const res = runValidator(
      "tests/fixtures/extension-manifests/invalid.too-many-permissions.manifest.json"
    );

    expect(res.status).to.equal(1);
    expect(res.stderr).to.contain("expected at most 10 item(s)");
  });

  it("fails when required fields are missing", () => {
    const res = runValidator(
      "tests/fixtures/extension-manifests/invalid.missing-required.manifest.json"
    );

    expect(res.status).to.equal(1);
    expect(res.stderr).to.contain("missing required field 'rollback_strategy'");
  });

  it("fails when a non-official extension claims the core SDK package", () => {
    const res = runValidator(
      "tests/fixtures/extension-manifests/invalid.core-sdk-non-official.manifest.json"
    );

    expect(res.status).to.equal(1);
    expect(res.stderr).to.contain(
      "only official service extensions may declare sdk_package '@alcheme/sdk'"
    );
  });
});
