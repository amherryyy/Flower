import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { TemplateFile, TemplateManifest, VerifiedTemplate } from "./types.js";
import { normalizeProjectPath } from "./ownership.js";
import { validateDocument } from "./validation.js";

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalTemplateDigest(manifest: TemplateManifest): string {
  const identity = {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    version: manifest.version,
    stack: manifest.stack,
    files: [...manifest.files]
      .map(({ source, target, digest, render = false }) => ({ source, target, digest, render }))
      .sort((left, right) => left.target.localeCompare(right.target)),
    verificationScripts: manifest.verificationScripts
  };
  return sha256(JSON.stringify(identity));
}

function assertTemplateManifest(document: unknown): asserts document is TemplateManifest {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Template manifest must be a JSON object");
  }
  const candidate = document as Partial<TemplateManifest>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.id !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.description !== "string" ||
    !candidate.stack ||
    !Array.isArray(candidate.files) ||
    !Array.isArray(candidate.verificationScripts)
  ) {
    throw new Error("Template manifest is missing required fields");
  }
}

async function safeSourcePath(root: string, file: TemplateFile): Promise<string> {
  const relative = normalizeProjectPath(file.source);
  const candidate = path.resolve(root, relative);
  const resolvedRoot = await realpath(root);
  const resolvedFile = await realpath(candidate);
  const relation = path.relative(resolvedRoot, resolvedFile);
  if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
    throw new Error(`Template source '${file.source}' escapes the template root`);
  }
  return resolvedFile;
}

export async function loadAndVerifyTemplate(rootInput: string, schema?: object): Promise<VerifiedTemplate> {
  const root = path.resolve(rootInput);
  const manifestPath = path.join(root, "flower.template.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (schema) {
    const validation = validateDocument(schema, manifest, "template");
    if (!validation.valid) {
      throw new Error(`Template manifest is invalid: ${validation.diagnostics.map((diagnostic) => `${diagnostic.path} ${diagnostic.message}`).join("; ")}`);
    }
  }
  assertTemplateManifest(manifest);

  const targets = new Set<string>();
  for (const file of manifest.files) {
    const target = normalizeProjectPath(file.target);
    if (targets.has(target)) throw new Error(`Template target '${target}' is duplicated`);
    targets.add(target);
    if (!/^sha256:[a-f0-9]{64}$/.test(file.digest)) {
      throw new Error(`Template file '${file.source}' has an invalid digest`);
    }
    const contents = await readFile(await safeSourcePath(root, file));
    const actual = sha256(contents);
    if (actual !== file.digest) {
      throw new Error(`Template digest mismatch for '${file.source}'`);
    }
  }

  return { root, manifest, digest: canonicalTemplateDigest(manifest) };
}

export function renderTemplate(contents: string, values: Record<string, string>): string {
  return contents.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Template variable '${key}' is not defined`);
    return value;
  });
}
