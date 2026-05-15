import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = new URL("..", import.meta.url).pathname;
const npmCacheDir = join(tmpdir(), "alcheme-sdk-npm-cache");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      LC_ALL: "C",
      NODE_PATH: join(cwd, "node_modules"),
      npm_config_cache: npmCacheDir,
      npm_config_loglevel: "error",
    },
  });
}

run("npm", ["run", "build"]);
const packOutput = execFileSync("npm", ["pack", "--json"], {
  cwd,
  encoding: "utf8",
  env: {
    ...process.env,
    LC_ALL: "C",
    npm_config_cache: npmCacheDir,
    npm_config_loglevel: "error",
  },
});
const pack = JSON.parse(packOutput)[0];
const tarballPath = join(cwd, pack.filename);
const checkDir = mkdtempSync(join(tmpdir(), "alcheme-sdk-runtime-import-check-"));

try {
  run("tar", ["-xzf", tarballPath, "-C", checkDir]);
  const packageScopeDir = join(checkDir, "node_modules", "@alcheme");
  mkdirSync(packageScopeDir, { recursive: true });
  symlinkSync(join(checkDir, "package"), join(packageScopeDir, "sdk"), "dir");
  const script = [
    'require("@alcheme/sdk/runtime/communication")',
    'require("@alcheme/sdk/runtime/voice")',
    'require("@alcheme/sdk/runtime/errors")',
    'require("@alcheme/sdk/server")',
    'require("@alcheme/sdk/runtime/server")',
    'require("@alcheme/sdk/protocol")',
    'console.log("runtime subpath imports ok")',
  ].join(";\n");
  run("node", ["-e", script], { cwd: checkDir });
} finally {
  rmSync(checkDir, { recursive: true, force: true });
  rmSync(tarballPath, { force: true });
}
