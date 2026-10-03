import { copyFile, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VerifiedReleasePackage } from "./types.js";

const RELEASE_DIGEST = /^sha256:([a-f0-9]{64})$/;

export class ReleasePackageStoreError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ReleasePackageStoreError";
    this.code = code;
  }
}

async function assertDirectory(pathname: string, label: string, allowMissing: boolean): Promise<void> {
  try {
    const details = await lstat(pathname);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new ReleasePackageStoreError(`${label} is not a safe directory`, "update.packageStoreUnsafe");
    }
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof ReleasePackageStoreError) throw error;
    throw new ReleasePackageStoreError(`${label} is unavailable`, "update.packageStoreUnsafe");
  }
}

function digestDirectory(digest: string): string {
  const match = RELEASE_DIGEST.exec(digest);
  if (!match) {
    throw new ReleasePackageStoreError("Release package digest is unsafe for local storage", "update.releaseDigestInvalid");
  }
  return match[1]!;
}

function declaredSources(release: VerifiedReleasePackage): string[] {
  const sources = [
    ...release.manifest.manifestMigrations.map(({ source }) => source),
    ...release.manifest.moduleMigrations.map(({ source }) => source),
    ...release.manifest.generatedFiles.flatMap((artifact) => [artifact.baseSource, artifact.targetSource].filter((source): source is string => Boolean(source))),
    ...release.manifest.databaseMigrations.map(({ source }) => source)
  ];
  return ["flower.release.json", ...sources.map((source) => source.slice(2))];
}

async function safeExistingDirectory(directory: string): Promise<boolean> {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new ReleasePackageStoreError("Cached release package path is unsafe", "update.packageStoreUnsafe");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class LocalReleasePackageStore {
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  private async directory(): Promise<string> {
    const flower = path.join(this.projectRoot, ".flower");
    const cache = path.join(flower, "cache");
    const packages = path.join(cache, "update-packages");
    await assertDirectory(this.projectRoot, "Project root", false);
    await assertDirectory(flower, "Flower control directory", false);
    await assertDirectory(cache, "Flower cache directory", true);
    await assertDirectory(packages, "Release package directory", true);
    try {
      await mkdir(packages, { recursive: true });
      await assertDirectory(cache, "Flower cache directory", false);
      await assertDirectory(packages, "Release package directory", false);
      const [resolvedRoot, resolvedPackages] = await Promise.all([realpath(this.projectRoot), realpath(packages)]);
      const relation = path.relative(resolvedRoot, resolvedPackages);
      if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
        throw new ReleasePackageStoreError("Release package directory escaped the project root", "update.packageStoreUnsafe");
      }
      return resolvedPackages;
    } catch (error) {
      if (error instanceof ReleasePackageStoreError) throw error;
      throw new ReleasePackageStoreError("Release package directory could not be created", "update.packageStoreUnsafe");
    }
  }

  async loadRoot(digest: string): Promise<string | undefined> {
    const root = path.join(await this.directory(), digestDirectory(digest));
    return await safeExistingDirectory(root) ? root : undefined;
  }

  async save(release: VerifiedReleasePackage): Promise<string> {
    const packages = await this.directory();
    const identity = digestDirectory(release.digest);
    const destination = path.join(packages, identity);
    const lockPath = path.join(packages, `${identity}.lock`);
    const temporary = path.join(packages, `${identity}.${randomUUID()}.tmp`);
    let lock;
    try {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new ReleasePackageStoreError("Release package is locked by another writer", "update.packageLocked");
        }
        throw error;
      }
      if (await safeExistingDirectory(destination)) return destination;
      await mkdir(temporary);
      for (const relativePath of declaredSources(release)) {
        const source = path.join(release.root, ...relativePath.split("/"));
        const target = path.join(temporary, ...relativePath.split("/"));
        const details = await lstat(source);
        if (!details.isFile() || details.isSymbolicLink()) {
          throw new ReleasePackageStoreError(`Release package source is unsafe: ${relativePath}`, "update.packageStoreUnsafe");
        }
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      await rename(temporary, destination);
      return destination;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof ReleasePackageStoreError) throw error;
      throw new ReleasePackageStoreError(
        `Release package could not be cached: ${error instanceof Error ? error.message : "filesystem failure"}`,
        "update.packageWriteFailed"
      );
    } finally {
      await lock?.close().catch(() => undefined);
      if (lock) await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}
