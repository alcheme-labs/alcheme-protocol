#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DEFAULT_SCHEMA_PATH = "docs/schemas/extension-manifest.schema.json";
const OFFICIAL_SERVICE_EXTENSION_IDS = new Set(["contribution-engine"]);

function readJson(relOrAbsPath) {
  const fullPath = path.isAbsolute(relOrAbsPath)
    ? relOrAbsPath
    : path.join(ROOT, relOrAbsPath);

  let raw;
  try {
    raw = fs.readFileSync(fullPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read file: ${fullPath} (${error.message})`);
  }

  try {
    return { fullPath, json: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`Invalid JSON in file: ${fullPath} (${error.message})`);
  }
}

function listExtensionManifests() {
  const start = path.join(ROOT, "extensions");
  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        walk(full);
      } else if (entry.isFile() && entry.name === "extension.manifest.json") {
        results.push(full);
      }
    }
  }

  if (fs.existsSync(start)) {
    walk(start);
  }
  return results;
}

function toRel(filePath) {
  return path.relative(ROOT, filePath) || filePath;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(value, schema, ptr, errors) {
  const where = ptr || "$";

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(
      `${where}: expected const value ${JSON.stringify(schema.const)}`
    );
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${where}: expected one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "object") {
    if (!isObject(value)) {
      errors.push(`${where}: expected object`);
      return;
    }

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(`${where}: missing required field '${key}'`);
        }
      }
    }

    const props = schema.properties || {};

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push(`${where}: unexpected field '${key}'`);
        }
      }
    }

    for (const [key, childSchema] of Object.entries(props)) {
      if (key in value) {
        validate(value[key], childSchema, `${where}.${key}`, errors);
      }
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${where}: expected array`);
      return;
    }

    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${where}: expected at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${where}: expected at most ${schema.maxItems} item(s)`);
    }

    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push(`${where}: expected unique items`);
          break;
        }
        seen.add(key);
      }
    }

    if (schema.items) {
      value.forEach((item, idx) => {
        validate(item, schema.items, `${where}[${idx}]`, errors);
      });
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${where}: expected string`);
      return;
    }

    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${where}: expected min length ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${where}: expected max length ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push(`${where}: does not match pattern ${schema.pattern}`);
      }
    }

    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch (_error) {
        errors.push(`${where}: expected valid URI`);
      }
    }
    return;
  }
}

function validateManifestSemantics(manifest, relPath, errors) {
  if (
    manifest.sdk_package === "@alcheme/sdk" &&
    !OFFICIAL_SERVICE_EXTENSION_IDS.has(manifest.extension_id)
  ) {
    errors.push(
      `${relPath}: only official service extensions may declare sdk_package '@alcheme/sdk'`
    );
  }
}

function parseArgs(argv) {
  const files = [];
  let schemaPath = DEFAULT_SCHEMA_PATH;
  let validateAll = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--schema") {
      if (!argv[i + 1]) {
        throw new Error("--schema requires a value");
      }
      schemaPath = argv[i + 1];
      i += 1;
    } else if (token === "--all") {
      validateAll = true;
    } else if (token === "--help" || token === "-h") {
      return { help: true };
    } else {
      files.push(token);
    }
  }

  return { files, schemaPath, validateAll, help: false };
}

function printHelp() {
  console.log(
    "Usage: node scripts/validate-extension-manifest.js [--schema <path>] [--all] [manifest ...]"
  );
  console.log("");
  console.log("Examples:");
  console.log("  node scripts/validate-extension-manifest.js --all");
  console.log(
    "  node scripts/validate-extension-manifest.js extensions/contribution-engine/extension.manifest.json"
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Argument error: ${error.message}`);
    process.exit(1);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let schema;
  try {
    schema = readJson(args.schemaPath).json;
  } catch (error) {
    console.error(`Schema error: ${error.message}`);
    process.exit(1);
  }

  const targets = new Set();
  for (const item of args.files) {
    const targetPath = path.isAbsolute(item) ? item : path.join(ROOT, item);
    targets.add(targetPath);
  }

  if (args.validateAll || args.files.length === 0) {
    for (const file of listExtensionManifests()) {
      targets.add(file);
    }
  }

  if (targets.size === 0) {
    console.error(
      "No manifest files found. Add --all or pass one or more file paths."
    );
    process.exit(1);
  }

  let failed = false;
  const sortedTargets = Array.from(targets).sort();

  for (const filePath of sortedTargets) {
    const relPath = toRel(filePath);
    let manifest;

    try {
      manifest = readJson(filePath).json;
    } catch (error) {
      failed = true;
      console.error(`FAIL ${relPath}`);
      console.error(`  - ${error.message}`);
      continue;
    }

    const errors = [];
    validate(manifest, schema, "$", errors);
    validateManifestSemantics(manifest, relPath, errors);

    if (errors.length > 0) {
      failed = true;
      console.error(`FAIL ${relPath}`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
    } else {
      console.log(`PASS ${relPath}`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main();
