import fs from "node:fs";
import path from "node:path";

const sourceDir = path.resolve("src/idl");
const outputDir = path.resolve("dist/idl");

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Missing static asset source directory: ${sourceDir}`);
}

fs.mkdirSync(outputDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) {
    continue;
  }

  fs.copyFileSync(
    path.join(sourceDir, entry.name),
    path.join(outputDir, entry.name)
  );
}
