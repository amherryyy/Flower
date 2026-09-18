import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeProjectPath } from "./ownership.js";
import { sha256 } from "./template.js";
import type { VerifiedModuleArtifact, VerifiedModuleMigration, VerifiedModulePackage } from "./types.js";
import { validateModuleManifest } from "./module.js";
import { assertValidJsonSchema } from "./validation.js";

async function confinedFile(root: string, relativeInput: string): Promise<string> {
  const relative = normalizeProjectPath(relativeInput);
  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(root),
    realpath(path.resolve(root, relative))
  ]);
  const relation = path.relative(resolvedRoot, resolvedFile);
  if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
    throw new Error(`Module file '${relativeInput}' escapes the module root`);
  }
  return resolvedFile;
}

export async function loadAndVerifyModulePackage(rootInput: string, schema: object): Promise<VerifiedModulePackage> {
  const root = path.resolve(rootInput);
  const manifestPath = path.join(root, "flower.module.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  const validation = validateModuleManifest(schema, manifest);
  if (!validation.valid) {
    throw new Error(`Module manifest is invalid: ${validation.diagnostics.map((diagnostic) => `${diagnostic.path} ${diagnostic.message}`).join("; ")}`);
  }
  const typedManifest = manifest as VerifiedModulePackage["manifest"];

  if (!typedManifest.configurationSchema.startsWith("./")) {
    throw new Error("Module configurationSchema must be a module-local './' path");
  }
  const configurationPath = await confinedFile(root, typedManifest.configurationSchema);
  const configurationBytes = await readFile(configurationPath);
  const configurationSchema = JSON.parse(configurationBytes.toString("utf8")) as object;
  assertValidJsonSchema(configurationSchema);

  const artifacts: VerifiedModuleArtifact[] = [];
  for (const generatedPath of [...typedManifest.generatedPaths].sort()) {
    const normalized = normalizeProjectPath(generatedPath);
    const sourcePath = await confinedFile(root, path.join("generators", normalized));
    const source = await readFile(sourcePath);
    artifacts.push({ path: normalized, sourcePath, sourceDigest: sha256(source) });
  }

  const migrations: VerifiedModuleMigration[] = [];
  const expectedMigrationFiles = new Set(typedManifest.migrations.map((migrationId) => `${migrationId}.sql`));
  try {
    const migrationEntries = await readdir(path.join(root, "migrations"), { withFileTypes: true });
    for (const entry of migrationEntries) {
      if (entry.name.endsWith(".sql") && !expectedMigrationFiles.has(entry.name)) {
        throw new Error(`Module migration file '${entry.name}' is not declared in the manifest`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const migrationId of typedManifest.migrations) {
    const sourcePath = await confinedFile(root, path.join("migrations", `${migrationId}.sql`));
    const source = await readFile(sourcePath);
    if (source.toString("utf8").trim().length === 0) {
      throw new Error(`Module migration '${migrationId}' is empty`);
    }
    migrations.push({ id: migrationId, sourcePath, sourceDigest: sha256(source) });
  }
  const manifestDigest = sha256(manifestBytes);
  const configurationDigest = sha256(configurationBytes);
  const digest = sha256(JSON.stringify({
    manifest: manifestDigest,
    configuration: configurationDigest,
    artifacts: artifacts.map(({ path: artifactPath, sourceDigest }) => ({ path: artifactPath, sourceDigest })),
    migrations: migrations.map(({ id, sourceDigest }) => ({ id, sourceDigest }))
  }));
  return {
    root,
    manifestPath,
    manifestDigest,
    configurationPath,
    configurationDigest,
    manifest: typedManifest,
    digest,
    artifacts,
    migrations
  };
}

export async function loadModuleCatalog(catalogRootInput: string, schema: object): Promise<VerifiedModulePackage[]> {
  const catalogRoot = path.resolve(catalogRootInput);
  const entries = await readdir(catalogRoot, { withFileTypes: true });
  const modules: VerifiedModulePackage[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    modules.push(await loadAndVerifyModulePackage(path.join(catalogRoot, entry.name), schema));
  }
  return modules;
}
