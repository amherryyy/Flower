import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeProjectPath } from "./ownership.js";
import { compareSemVer, isValidSemVer } from "./semver.js";
import { sha256 } from "./template.js";
import { validateDocument } from "./validation.js";
import type {
  ReleaseGeneratedFileArtifact,
  ReleaseMigrationDocument,
  ReleaseMigrationOperation,
  ReleasePackageManifest,
  VerifiedReleasePackage
} from "./types.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class ReleasePackageError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ReleasePackageError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validationMessage(label: string, diagnostics: Array<{ path: string; message: string }>): string {
  return `${label} is invalid: ${diagnostics.map(({ path: diagnosticPath, message }) => `${diagnosticPath} ${message}`).join("; ")}`;
}

function safeProjectPath(value: string, label: string): string {
  try {
    return normalizeProjectPath(value);
  } catch {
    throw new ReleasePackageError(`${label} '${value}' is unsafe`, "update.releaseUnsafePath");
  }
}

async function safePackageFile(root: string, source: string): Promise<string> {
  if (!source.startsWith("./")) {
    throw new ReleasePackageError(`Release source '${source}' must be package-local`, "update.releaseUnsafePath");
  }
  let relative: string;
  try {
    relative = normalizeProjectPath(source.slice(2));
  } catch {
    throw new ReleasePackageError(`Release source '${source}' is unsafe`, "update.releaseUnsafePath");
  }
  const candidate = path.resolve(root, relative);
  try {
    const details = await lstat(candidate);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new ReleasePackageError(`Release source '${source}' is not a regular file`, "update.releaseUnsafePath");
    }
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(candidate)]);
    const relation = path.relative(resolvedRoot, resolvedFile);
    if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
      throw new ReleasePackageError(`Release source '${source}' escapes the package`, "update.releaseUnsafePath");
    }
    return resolvedFile;
  } catch (error) {
    if (error instanceof ReleasePackageError) throw error;
    throw new ReleasePackageError(`Release source '${source}' is unavailable`, "update.releaseArtifactMissing");
  }
}

async function packageFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new ReleasePackageError(`Release package contains symbolic link '${relative}'`, "update.releaseUnsafePath");
    }
    if (entry.isDirectory()) files.push(...await packageFiles(root, absolute));
    else if (entry.isFile()) files.push(relative);
    else throw new ReleasePackageError(`Release package contains unsupported entry '${relative}'`, "update.releaseUnsafePath");
  }
  return files;
}

function operationKey(operation: ReleaseMigrationOperation): string {
  return operation.path.join("\0");
}

function compileMigration(document: ReleaseMigrationDocument): (input: Record<string, unknown>) => Record<string, unknown> {
  const operations = structuredClone(document.operations);
  return (input) => {
    const output = structuredClone(input);
    for (const operation of operations) {
      let parent: Record<string, unknown> = output;
      for (const segment of operation.path.slice(0, -1)) {
        const child = parent[segment];
        if (!isRecord(child)) {
          throw new ReleasePackageError(
            `Migration path '${operation.path.join(".")}' has a missing object parent`,
            "update.releaseMigrationPrecondition"
          );
        }
        parent = child;
      }
      const key = operation.path.at(-1)!;
      if (operation.op === "remove") {
        if (!Object.hasOwn(parent, key)) {
          throw new ReleasePackageError(
            `Migration path '${operation.path.join(".")}' does not exist`,
            "update.releaseMigrationPrecondition"
          );
        }
        delete parent[key];
      } else {
        parent[key] = structuredClone(operation.value);
      }
    }
    return output;
  };
}

async function migrationDocument(
  root: string,
  source: string,
  expectedDigest: string,
  schema: object
): Promise<{ document: ReleaseMigrationDocument; digest: string }> {
  const sourcePath = await safePackageFile(root, source);
  const bytes = await readFile(sourcePath);
  const digest = sha256(bytes);
  if (digest !== expectedDigest) {
    throw new ReleasePackageError(`Release artifact digest mismatch for '${source}'`, "update.releaseDigestMismatch");
  }
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new ReleasePackageError(`Release migration '${source}' is not valid JSON`, "update.releaseMigrationInvalid");
  }
  const validation = validateDocument(schema, document, "migration");
  if (!validation.valid) {
    throw new ReleasePackageError(validationMessage(`Release migration '${source}'`, validation.diagnostics), "update.releaseMigrationInvalid");
  }
  const typed = document as ReleaseMigrationDocument;
  const paths = typed.operations.map(operationKey);
  const invalidShape = typed.operations.some((operation) =>
    operation.path.some((key) => FORBIDDEN_KEYS.has(key)) ||
    (operation.op === "set") !== Object.hasOwn(operation, "value")
  );
  if (new Set(paths).size !== paths.length || invalidShape) {
    throw new ReleasePackageError(`Release migration '${source}' contains duplicate or unsafe operation paths`, "update.releaseMigrationInvalid");
  }
  return { document: typed, digest };
}

function assertUnique(values: readonly string[], label: string): void {
  const duplicate = values.find((value, index) => !value || values.indexOf(value) !== index);
  if (duplicate !== undefined) {
    throw new ReleasePackageError(`${label} contains a missing or duplicate identity '${duplicate}'`, "update.releaseDuplicateEntry");
  }
}

function generatedSources(artifact: ReleaseGeneratedFileArtifact): Array<{ source: string; digest: string }> {
  if (artifact.kind === "create") {
    if (artifact.baseSource || artifact.baseDigest || !artifact.targetSource || !artifact.targetDigest) {
      throw new ReleasePackageError(`Generated create '${artifact.path}' has invalid sources`, "update.releaseGeneratedInvalid");
    }
    return [{ source: artifact.targetSource, digest: artifact.targetDigest }];
  }
  if (artifact.kind === "remove") {
    if (artifact.baseSource || artifact.baseDigest || artifact.targetSource || artifact.targetDigest) {
      throw new ReleasePackageError(`Generated removal '${artifact.path}' cannot declare sources`, "update.releaseGeneratedInvalid");
    }
    return [];
  }
  if (!artifact.baseSource || !artifact.baseDigest || !artifact.targetSource || !artifact.targetDigest) {
    throw new ReleasePackageError(`Generated ${artifact.kind} '${artifact.path}' requires base and target sources`, "update.releaseGeneratedInvalid");
  }
  return [
    { source: artifact.baseSource, digest: artifact.baseDigest },
    { source: artifact.targetSource, digest: artifact.targetDigest }
  ];
}

async function verifiedText(root: string, source: string, expectedDigest: string): Promise<string> {
  const bytes = await readFile(await safePackageFile(root, source));
  if (sha256(bytes) !== expectedDigest) {
    throw new ReleasePackageError(`Release artifact digest mismatch for '${source}'`, "update.releaseDigestMismatch");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ReleasePackageError(`Release artifact '${source}' is not UTF-8 text`, "update.releaseArtifactInvalid");
  }
}

export async function loadAndVerifyReleasePackage(
  rootInput: string,
  manifestSchema: object,
  migrationSchema: object
): Promise<VerifiedReleasePackage> {
  const root = path.resolve(rootInput);
  const manifestPath = path.join(root, "flower.release.json");
  let manifestBytes: Buffer;
  let manifestDocument: unknown;
  try {
    const rootDetails = await lstat(root);
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error("package root is not a regular directory");
    const details = await lstat(manifestPath);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("manifest is not a regular file");
    manifestBytes = await readFile(manifestPath);
    manifestDocument = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new ReleasePackageError(
      `Release manifest is unavailable or invalid: ${error instanceof Error ? error.message : "read failure"}`,
      "update.releaseManifestInvalid"
    );
  }
  const validation = validateDocument(manifestSchema, manifestDocument, "release-package");
  if (!validation.valid) {
    throw new ReleasePackageError(validationMessage("Release manifest", validation.diagnostics), "update.releaseManifestInvalid");
  }
  const manifest = manifestDocument as ReleasePackageManifest;
  if (!isValidSemVer(manifest.sourceVersion) || !isValidSemVer(manifest.targetVersion) ||
      compareSemVer(manifest.targetVersion, manifest.sourceVersion) <= 0) {
    throw new ReleasePackageError("Release package must declare an increasing semantic-version transition", "update.releaseVersionInvalid");
  }

  assertUnique(manifest.manifestMigrations.map(({ manifest: kind, fromVersion }) => `${kind}@${fromVersion}`), "Manifest migrations");
  assertUnique(manifest.manifestMigrations.map(({ manifest: kind, id }) => `${kind}/${id}`), "Manifest migration ids");
  assertUnique(manifest.moduleMigrations.map(({ moduleId, fromVersion }) => `${moduleId}@${fromVersion}`), "Module migrations");
  assertUnique(manifest.moduleMigrations.map(({ moduleId, id }) => `${moduleId}/${id}`), "Module migration ids");
  assertUnique(manifest.generatedFiles.map(({ path: generatedPath }) => safeProjectPath(generatedPath, "Generated path")), "Generated files");
  assertUnique(manifest.dependencyChanges.map(({ name }) => name), "Dependency changes");
  assertUnique(manifest.databaseMigrations.map(({ id }) => id), "Database migrations");
  assertUnique(manifest.requiredApprovals.map(({ id }) => id), "Required approvals");
  assertUnique(manifest.verificationCommands.map(({ id }) => id), "Verification commands");
  assertUnique(manifest.rollbackLimitations.map(({ id }) => id), "Rollback limitations");
  for (const change of manifest.dependencyChanges) {
    const valid = (change.kind === "add" && change.fromVersion === undefined && Boolean(change.toVersion)) ||
      (change.kind === "remove" && Boolean(change.fromVersion) && change.toVersion === undefined) ||
      (change.kind === "update" && Boolean(change.fromVersion) && Boolean(change.toVersion) && change.fromVersion !== change.toVersion);
    if (!valid) throw new ReleasePackageError(`Dependency change '${change.name}' is invalid`, "update.releaseDependencyInvalid");
  }
  const moduleDocumentPaths = new Map<string, string>();
  for (const migration of manifest.moduleMigrations) {
    const documentPath = safeProjectPath(migration.documentPath, "Module document path");
    const existing = moduleDocumentPaths.get(migration.moduleId);
    if (existing && existing !== documentPath) {
      throw new ReleasePackageError(`Module '${migration.moduleId}' declares multiple configuration paths`, "update.releaseMigrationInvalid");
    }
    moduleDocumentPaths.set(migration.moduleId, documentPath);
  }

  const declaredSources = [
    ...manifest.manifestMigrations.map(({ source }) => source),
    ...manifest.moduleMigrations.map(({ source }) => source),
    ...manifest.generatedFiles.flatMap(generatedSources).map(({ source }) => source),
    ...manifest.databaseMigrations.map(({ source }) => source)
  ];
  assertUnique(declaredSources, "Release sources");

  const manifestMigrations: VerifiedReleasePackage["manifestMigrations"] = [];
  for (const artifact of manifest.manifestMigrations) {
    if (artifact.toVersion !== artifact.fromVersion + 1) {
      throw new ReleasePackageError(`Manifest migration '${artifact.id}' must advance exactly one version`, "update.releaseMigrationInvalid");
    }
    const loaded = await migrationDocument(root, artifact.source, artifact.digest, migrationSchema);
    manifestMigrations.push({
      id: artifact.id,
      manifest: artifact.manifest,
      fromVersion: artifact.fromVersion,
      toVersion: artifact.toVersion,
      digest: loaded.digest,
      migrate: compileMigration(loaded.document)
    });
  }

  const moduleMigrations: VerifiedReleasePackage["moduleMigrations"] = [];
  const moduleDocuments: VerifiedReleasePackage["moduleDocuments"] = [];
  for (const artifact of manifest.moduleMigrations) {
    if (!isValidSemVer(artifact.fromVersion) || !isValidSemVer(artifact.toVersion) || compareSemVer(artifact.toVersion, artifact.fromVersion) <= 0) {
      throw new ReleasePackageError(`Module migration '${artifact.id}' has an invalid version transition`, "update.releaseMigrationInvalid");
    }
    const loaded = await migrationDocument(root, artifact.source, artifact.digest, migrationSchema);
    moduleMigrations.push({
      id: artifact.id,
      moduleId: artifact.moduleId,
      fromVersion: artifact.fromVersion,
      toVersion: artifact.toVersion,
      digest: loaded.digest,
      migrate: compileMigration(loaded.document)
    });
    if (!moduleDocuments.some(({ moduleId }) => moduleId === artifact.moduleId)) {
      moduleDocuments.push({ moduleId: artifact.moduleId, path: safeProjectPath(artifact.documentPath, "Module document path") });
    }
  }

  const generated: VerifiedReleasePackage["generatedSources"] = [];
  for (const artifact of manifest.generatedFiles) {
    const sources = generatedSources(artifact);
    const contents = new Map<string, string>();
    for (const source of sources) {
      if (!DIGEST.test(source.digest)) throw new ReleasePackageError(`Generated source '${source.source}' has an invalid digest`, "update.releaseGeneratedInvalid");
      contents.set(source.source, await verifiedText(root, source.source, source.digest));
    }
    generated.push({
      path: safeProjectPath(artifact.path, "Generated path"),
      ...(artifact.baseSource ? { base: contents.get(artifact.baseSource)! } : {}),
      ...(artifact.targetSource ? { target: contents.get(artifact.targetSource)! } : {})
    });
  }

  for (const migration of manifest.databaseMigrations) {
    const sql = await verifiedText(root, migration.source, migration.digest);
    if (!sql.trim()) throw new ReleasePackageError(`Database migration '${migration.id}' is empty`, "update.releaseArtifactInvalid");
  }

  const actualFiles = (await packageFiles(root)).sort();
  const expectedFiles = ["flower.release.json", ...declaredSources.map((source) => safeProjectPath(source.slice(2), "Release source"))].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    const undeclared = actualFiles.filter((file) => !expectedFiles.includes(file));
    const missing = expectedFiles.filter((file) => !actualFiles.includes(file));
    throw new ReleasePackageError(
      `Release package file declaration mismatch${undeclared.length ? `; undeclared: ${undeclared.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
      "update.releaseFileMismatch"
    );
  }

  const manifestDigest = sha256(manifestBytes);
  const digest = sha256(JSON.stringify({
    manifest: manifestDigest,
    sources: declaredSources.map((source) => {
      const migration = [...manifest.manifestMigrations, ...manifest.moduleMigrations].find((entry) => entry.source === source);
      const generatedSource = manifest.generatedFiles.flatMap(generatedSources).find((entry) => entry.source === source);
      const database = manifest.databaseMigrations.find((entry) => entry.source === source);
      return { source, digest: migration?.digest ?? generatedSource?.digest ?? database!.digest };
    }).sort((left, right) => left.source.localeCompare(right.source))
  }));
  return { root, manifestPath, manifestDigest, digest, manifest, manifestMigrations, moduleMigrations, moduleDocuments, generatedSources: generated };
}
