import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeProjectPath } from "./ownership.js";
import { compareSemVer, isValidSemVer } from "./semver.js";
import { sha256 } from "./template.js";
import { validateDocument } from "./validation.js";
import type {
  AgentSkillAdapter,
  AgentSkillManifest,
  VerifiedAgentSkillFile,
  VerifiedAgentSkillPackage
} from "./types.js";

const MAX_FILES = 32;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

export class AgentSkillError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AgentSkillError";
    this.code = code;
  }
}

function diagnosticMessage(diagnostics: Array<{ path: string; message: string }>): string {
  return diagnostics.map(({ path: diagnosticPath, message }) => `${diagnosticPath} ${message}`).join("; ");
}

function safeRelativePath(value: string): string {
  try {
    if (value.includes("\\")) throw new Error("backslashes are not canonical");
    return normalizeProjectPath(value);
  } catch {
    throw new AgentSkillError(`Skill file path '${value}' is unsafe`, "skill.unsafePath");
  }
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new AgentSkillError(`Skill package contains symbolic link '${relative}'`, "skill.unsafePath");
    }
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(relative);
    else throw new AgentSkillError(`Skill package contains unsupported entry '${relative}'`, "skill.unsafePath");
  }
  return files;
}

async function safeFile(root: string, relativeInput: string): Promise<string> {
  const relative = safeRelativePath(relativeInput);
  const candidate = path.resolve(root, relative);
  try {
    const details = await lstat(candidate);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("not a regular file");
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(candidate)]);
    const relation = path.relative(resolvedRoot, resolvedFile);
    if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
      throw new Error("escaped package root");
    }
    return resolvedFile;
  } catch (error) {
    throw new AgentSkillError(
      `Skill file '${relativeInput}' is unavailable: ${error instanceof Error ? error.message : "read failure"}`,
      "skill.fileMissing"
    );
  }
}

function assertCompatibility(manifest: AgentSkillManifest, flowerVersion: string, adapter?: AgentSkillAdapter): void {
  if (!isValidSemVer(flowerVersion) || compareSemVer(flowerVersion, manifest.compatibleFlower.minimum) < 0 ||
      (manifest.compatibleFlower.maximumExclusive && compareSemVer(flowerVersion, manifest.compatibleFlower.maximumExclusive) >= 0)) {
    throw new AgentSkillError(
      `Skill '${manifest.id}' is not compatible with Flower ${flowerVersion}`,
      "skill.incompatibleFlower"
    );
  }
  if (adapter && !manifest.adapters.includes(adapter)) {
    throw new AgentSkillError(`Skill '${manifest.id}' does not support adapter '${adapter}'`, "skill.unsupportedAdapter");
  }
}

export async function loadAndVerifyAgentSkill(
  rootInput: string,
  manifestSchema: object,
  flowerVersion: string,
  adapter?: AgentSkillAdapter
): Promise<VerifiedAgentSkillPackage> {
  const root = path.resolve(rootInput);
  const manifestPath = path.join(root, "skill.json");
  let manifestBytes: Buffer;
  let manifestDocument: unknown;
  try {
    const rootDetails = await lstat(root);
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error("package root is not a regular directory");
    const manifestDetails = await lstat(manifestPath);
    if (!manifestDetails.isFile() || manifestDetails.isSymbolicLink()) throw new Error("manifest is not a regular file");
    manifestBytes = await readFile(manifestPath);
    manifestDocument = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new AgentSkillError(
      `Skill manifest is unavailable or invalid: ${error instanceof Error ? error.message : "read failure"}`,
      "skill.manifestInvalid"
    );
  }

  const validation = validateDocument(manifestSchema, manifestDocument, "skill");
  if (!validation.valid) {
    throw new AgentSkillError(`Skill manifest is invalid: ${diagnosticMessage(validation.diagnostics)}`, "skill.manifestInvalid");
  }
  const manifest = manifestDocument as AgentSkillManifest;
  assertCompatibility(manifest, flowerVersion, adapter);

  if (manifest.files.length > MAX_FILES) {
    throw new AgentSkillError(`Skill '${manifest.id}' declares too many files`, "skill.limitExceeded");
  }
  const paths = manifest.files.map((file) => safeRelativePath(file.path));
  if (new Set(paths).size !== paths.length || !paths.includes(safeRelativePath(manifest.entrypoint))) {
    throw new AgentSkillError(`Skill '${manifest.id}' has duplicate files or an undeclared entrypoint`, "skill.fileSetInvalid");
  }

  const actualFiles = await listFiles(root);
  const expectedFiles = ["skill.json", ...paths].sort((left, right) => left.localeCompare(right));
  if (actualFiles.length !== expectedFiles.length || actualFiles.some((file, index) => file !== expectedFiles[index])) {
    throw new AgentSkillError(`Skill '${manifest.id}' contains undeclared or missing files`, "skill.fileSetInvalid");
  }

  let totalBytes = 0;
  const files: VerifiedAgentSkillFile[] = [];
  for (const declared of manifest.files) {
    const sourcePath = await safeFile(root, declared.path);
    const bytes = await readFile(sourcePath);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new AgentSkillError(`Skill '${manifest.id}' exceeds the package size limits`, "skill.limitExceeded");
    }
    if (bytes.byteLength !== declared.bytes || sha256(bytes) !== declared.digest) {
      throw new AgentSkillError(`Skill file '${declared.path}' does not match its manifest`, "skill.digestMismatch");
    }
    files.push({ ...declared, sourcePath });
  }

  const entrypoint = files.find((file) => file.path === manifest.entrypoint)!;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(await readFile(entrypoint.sourcePath));
  } catch {
    throw new AgentSkillError(`Skill entrypoint '${manifest.entrypoint}' is not UTF-8 text`, "skill.entrypointInvalid");
  }

  const manifestDigest = sha256(manifestBytes);
  const digest = sha256(JSON.stringify({
    manifestDigest,
    files: files.map(({ path: filePath, bytes, digest: fileDigest }) => ({ path: filePath, bytes, digest: fileDigest }))
  }));
  return { root, manifestPath, manifestDigest, manifest, files, digest };
}
