import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyModuleUpdateMigrationPlan,
  applyVersionedManifestMigrationPlan,
  createModuleUpdateMigrationPlan,
  createUpdatePlan,
  createVersionedManifestMigrationPlan,
  mergeGeneratedText,
  resolveFrameworkVersion,
  sha256,
  verifyUpdatePlan,
  type ModuleManifest,
  type ModuleUpdateMigrationDefinition,
  type UpdatePlan,
  type VersionedManifestMigrationDefinition
} from "../packages/kernel/src/index.js";

interface Scenario {
  currentFlowerVersion: string;
  targetFlowerVersion: string;
  moduleId: string;
  currentModuleVersion: string;
  targetModuleVersion: string;
  generatedPath: string;
  projectOwnedPath: string;
}

interface AppliedScenario {
  plan: UpdatePlan;
  projectBytes: string;
  authBytes: string;
  generatedBytes: string;
  projectOwnedBytes: string;
}

const fixtureRoot = fileURLToPath(new URL("./upgrade-scenarios/0.1-to-0.2/", import.meta.url));
const temporaryRoots: string[] = [];

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(path)) as Record<string, unknown>;
}

function stableJson(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function moduleManifest(id: string, version: string, compatibleFlower: string): ModuleManifest {
  return {
    schemaVersion: 1,
    id,
    version,
    compatibleFlower,
    dependsOn: {},
    conflictsWith: [],
    provides: [],
    configurationSchema: "./schemas/config.json",
    migrations: [],
    generatedPaths: [],
    requiredChecks: []
  };
}

const manifestMigrations: VersionedManifestMigrationDefinition[] = [{
  id: "project-v1-v2",
  manifest: "project",
  fromVersion: 1,
  toVersion: 2,
  digest: sha256("fixture:project-v1-v2"),
  migrate(document) {
    const flower = document.flower as Record<string, unknown>;
    return {
      ...document,
      schemaVersion: 2,
      flower: { ...flower, version: "0.2.0" },
      modules: { ...(document.modules as Record<string, unknown>), auth: "2.0.0" },
      updatePolicy: "review"
    };
  }
}];

const moduleMigrations: ModuleUpdateMigrationDefinition[] = [
  {
    id: "auth-1.0.0-1.1.0",
    moduleId: "auth",
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    digest: sha256("fixture:auth-1.0.0-1.1.0"),
    migrate(document) {
      return { ...document, sessionMinutes: 60 };
    }
  },
  {
    id: "auth-1.1.0-2.0.0",
    moduleId: "auth",
    fromVersion: "1.1.0",
    toVersion: "2.0.0",
    digest: sha256("fixture:auth-1.1.0-2.0.0"),
    migrate(document) {
      const migrated = {
        ...document,
        magicLink: true,
        sessionDurationMinutes: document.sessionMinutes
      };
      delete migrated.sessionMinutes;
      return migrated;
    }
  }
];

async function applyCleanScenario(reverseInputs = false): Promise<AppliedScenario> {
  const scenario = await json(join(fixtureRoot, "scenario.json")) as unknown as Scenario;
  const destination = await mkdtemp(join(tmpdir(), "flower-upgrade-"));
  temporaryRoots.push(destination);
  await cp(join(fixtureRoot, "source"), destination, { recursive: true });

  const projectPath = join(destination, ".flower", "project.json");
  const authPath = join(destination, ".flower", "auth.json");
  const generatedPath = join(destination, ...scenario.generatedPath.split("/"));
  const projectOwnedPath = join(destination, ...scenario.projectOwnedPath.split("/"));
  const projectSource = await json(projectPath);
  const authSource = await json(authPath);
  const projectOwnedBefore = await text(projectOwnedPath);
  const base = await text(join(fixtureRoot, "bases", "0.1.0", ...scenario.generatedPath.split("/")));
  const current = await text(generatedPath);
  const target = await text(join(fixtureRoot, "targets", "0.2.0", ...scenario.generatedPath.split("/")));

  const releases = [
    { version: scenario.currentFlowerVersion, channel: "stable" as const },
    { version: scenario.targetFlowerVersion, channel: "stable" as const }
  ];
  const catalog = [moduleManifest(scenario.moduleId, scenario.currentModuleVersion, ">=0.1.0 <0.3.0")];
  const resolution = resolveFrameworkVersion({
    currentVersion: scenario.currentFlowerVersion,
    requestedVersion: scenario.targetFlowerVersion,
    channel: "stable",
    releases: reverseInputs ? [...releases].reverse() : releases,
    installedModules: { [scenario.moduleId]: scenario.currentModuleVersion },
    moduleCatalog: reverseInputs ? [...catalog].reverse() : catalog
  });
  const projectMigration = createVersionedManifestMigrationPlan(
    "project", projectSource, 2, reverseInputs ? [...manifestMigrations].reverse() : manifestMigrations
  );
  const moduleMigration = createModuleUpdateMigrationPlan(
    scenario.moduleId,
    scenario.currentModuleVersion,
    scenario.targetModuleVersion,
    authSource,
    reverseInputs ? [...moduleMigrations].reverse() : moduleMigrations
  );
  const merged = mergeGeneratedText(base, current, target);
  expect(merged.status).toBe("merge");

  const lockBytes = await text(join(destination, ".flower", "lock.json"));
  const ownershipBytes = await text(join(destination, ".flower", "ownership.json"));
  const input = {
    resolution,
    preconditions: {
      projectManifestDigest: sha256(await text(projectPath)),
      lockDigest: sha256(lockBytes),
      ownershipDigest: sha256(ownershipBytes),
      generatedStateDigest: sha256(`${merged.baseDigest}:${merged.currentDigest}`)
    },
    dependencyChanges: [{
      name: "@flower/kernel",
      kind: "update" as const,
      fromVersion: scenario.currentFlowerVersion,
      toVersion: scenario.targetFlowerVersion
    }],
    manifestMigrations: projectMigration.steps.map((step) => ({ ...step, manifest: "project" as const })),
    moduleMigrations: moduleMigration.steps.map((step) => ({ ...step, moduleId: scenario.moduleId })),
    generatedFiles: [{
      path: scenario.generatedPath,
      kind: "merge" as const,
      baseDigest: merged.baseDigest,
      currentDigest: merged.currentDigest,
      targetDigest: merged.targetDigest
    }],
    verificationCommands: [
      { id: "tests", command: "npm test" },
      { id: "typecheck", command: "npm run typecheck" }
    ]
  };
  if (reverseInputs) input.verificationCommands.reverse();
  const plan = createUpdatePlan(input);
  verifyUpdatePlan(plan);

  const migratedProject = applyVersionedManifestMigrationPlan(projectMigration, projectSource, manifestMigrations);
  const migratedAuth = applyModuleUpdateMigrationPlan(moduleMigration, authSource, moduleMigrations);
  await writeFile(projectPath, stableJson(migratedProject.document), "utf8");
  await writeFile(authPath, stableJson(migratedAuth.document), "utf8");
  await writeFile(generatedPath, merged.content!, "utf8");

  return {
    plan,
    projectBytes: await text(projectPath),
    authBytes: await text(authPath),
    generatedBytes: await text(generatedPath),
    projectOwnedBytes: await text(projectOwnedPath)
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("F6 0.1-to-0.2 upgrade scenario matrix", () => {
  it("materializes the fixture reproducibly and preserves project-owned code byte-for-byte", async () => {
    const first = await applyCleanScenario();
    const second = await applyCleanScenario(true);
    const expectedProject = await text(join(fixtureRoot, "expected", ".flower", "project.json"));
    const expectedAuth = await text(join(fixtureRoot, "expected", ".flower", "auth.json"));
    const expectedGenerated = await text(join(fixtureRoot, "expected", "src", "flower", "runtime.ts"));
    const sourceProjectOwned = await text(join(fixtureRoot, "source", "src", "domain", "account.ts"));

    expect(first.plan).toEqual(second.plan);
    expect(first.plan.state).toBe("apply");
    expect(first.projectBytes).toBe(expectedProject);
    expect(first.authBytes).toBe(expectedAuth);
    expect(first.generatedBytes).toBe(expectedGenerated);
    expect(first.projectOwnedBytes).toBe(sourceProjectOwned);
    expect(second).toEqual(first);
    expect(first.plan.generatedFiles.map(({ path }) => path)).not.toContain("src/domain/account.ts");
  });

  it("turns an overlapping generated edit into an explicit blocked plan", async () => {
    const scenario = await json(join(fixtureRoot, "scenario.json")) as unknown as Scenario;
    const [base, current, target, project, lock, ownership] = await Promise.all([
      text(join(fixtureRoot, "conflict", "base.ts")),
      text(join(fixtureRoot, "conflict", "current.ts")),
      text(join(fixtureRoot, "conflict", "target.ts")),
      text(join(fixtureRoot, "source", ".flower", "project.json")),
      text(join(fixtureRoot, "source", ".flower", "lock.json")),
      text(join(fixtureRoot, "source", ".flower", "ownership.json"))
    ]);
    const merged = mergeGeneratedText(base, current, target);
    expect(merged.status).toBe("conflict");
    expect(merged.content).toBeUndefined();
    expect(merged.conflicts).toHaveLength(1);

    const resolution = resolveFrameworkVersion({
      currentVersion: scenario.currentFlowerVersion,
      requestedVersion: scenario.targetFlowerVersion,
      channel: "stable",
      releases: [{ version: scenario.targetFlowerVersion, channel: "stable" }]
    });
    const plan = createUpdatePlan({
      resolution,
      preconditions: {
        projectManifestDigest: sha256(project),
        lockDigest: sha256(lock),
        ownershipDigest: sha256(ownership)
      },
      ownershipConflicts: [{
        path: scenario.generatedPath,
        owner: "generated",
        policy: "replace-if-unmodified",
        reason: "Project and framework changed the same generated lines"
      }]
    });
    expect(plan.state).toBe("blocked");
    expect(() => verifyUpdatePlan(plan)).not.toThrow();
  });

  it("rejects stale fixture metadata before materialization", async () => {
    const source = await json(join(fixtureRoot, "source", ".flower", "project.json"));
    const plan = createVersionedManifestMigrationPlan("project", source, 2, manifestMigrations);
    const changed = {
      ...source,
      project: { ...(source.project as Record<string, unknown>), name: "Changed after planning" }
    };
    expect(() => applyVersionedManifestMigrationPlan(plan, changed, manifestMigrations)).toThrowError(
      expect.objectContaining({ code: "update.manifestChanged" })
    );
  });
});
