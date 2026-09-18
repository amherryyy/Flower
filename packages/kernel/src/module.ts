import { FLOWER_VERSION, type Diagnostic, type ModuleManifest, type ModuleResolutionPlan, type ValidationResult } from "./types.js";
import { normalizeProjectPath } from "./ownership.js";
import { isValidSemVer, isValidSemVerRange, satisfiesSemVer } from "./semver.js";
import { combineValidationResults, validateDocument } from "./validation.js";

function sortedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
  );
}

export function validateModuleManifest(schema: object, document: unknown): ValidationResult {
  const schemaResult = validateDocument(schema, document, "module");
  if (!schemaResult.valid) return schemaResult;
  const manifest = document as ModuleManifest;
  const diagnostics: Diagnostic[] = [];

  if (!isValidSemVerRange(manifest.compatibleFlower)) {
    diagnostics.push({
      code: "module.invalidCompatibilityRange",
      path: "/compatibleFlower",
      message: "compatibleFlower is not a supported semantic version range",
      severity: "error"
    });
  }
  if (Object.hasOwn(manifest.dependsOn, manifest.id)) {
    diagnostics.push({
      code: "module.selfDependency",
      path: `/dependsOn/${manifest.id}`,
      message: "A module cannot depend on itself",
      severity: "error"
    });
  }
  if (manifest.conflictsWith.includes(manifest.id)) {
    diagnostics.push({
      code: "module.selfConflict",
      path: "/conflictsWith",
      message: "A module cannot conflict with itself",
      severity: "error"
    });
  }
  for (const dependency of Object.keys(manifest.dependsOn)) {
    if (!isValidSemVerRange(manifest.dependsOn[dependency]!)) {
      diagnostics.push({
        code: "module.invalidDependencyRange",
        path: `/dependsOn/${dependency}`,
        message: `Dependency '${dependency}' has an unsupported semantic version range`,
        severity: "error"
      });
    }
    if (manifest.conflictsWith.includes(dependency)) {
      diagnostics.push({
        code: "module.dependencyConflict",
        path: `/dependsOn/${dependency}`,
        message: `Module '${dependency}' cannot be both a dependency and a conflict`,
        severity: "error"
      });
    }
  }
  manifest.generatedPaths.forEach((generatedPath, index) => {
    try {
      normalizeProjectPath(generatedPath);
    } catch (error) {
      diagnostics.push({
        code: "module.invalidGeneratedPath",
        path: `/generatedPaths/${index}`,
        message: error instanceof Error ? error.message : "Generated path is invalid",
        severity: "error"
      });
    }
  });

  return combineValidationResults(schemaResult, {
    valid: diagnostics.length === 0,
    diagnostics: sortedDiagnostics(diagnostics)
  });
}

export function resolveModules(
  catalogInput: readonly ModuleManifest[],
  requestedInput: readonly string[],
  installed: Readonly<Record<string, string>> = {},
  flowerVersion = FLOWER_VERSION
): ModuleResolutionPlan {
  const diagnostics: Diagnostic[] = [];
  const catalog = new Map<string, ModuleManifest>();
  for (const manifest of catalogInput) {
    if (!isValidSemVer(manifest.version)) {
      diagnostics.push({
        code: "module.invalidVersion",
        path: manifest.id,
        message: `Module '${manifest.id}' has an invalid semantic version`,
        severity: "error"
      });
    }
    if (catalog.has(manifest.id)) {
      diagnostics.push({
        code: "module.duplicateCatalogEntry",
        path: manifest.id,
        message: `Catalog contains more than one manifest for '${manifest.id}'`,
        severity: "error"
      });
    } else {
      catalog.set(manifest.id, manifest);
    }
  }

  const requested = [...new Set(requestedInput)].sort();
  const state = new Map<string, "visiting" | "resolved">();
  const resolved: string[] = [];
  const reportedCycles = new Set<string>();

  const visit = (moduleId: string, ancestry: string[]): void => {
    if (state.get(moduleId) === "resolved") return;
    if (state.get(moduleId) === "visiting") {
      const start = ancestry.indexOf(moduleId);
      const cycle = [...ancestry.slice(Math.max(0, start)), moduleId].join(" -> ");
      if (!reportedCycles.has(cycle)) {
        reportedCycles.add(cycle);
        diagnostics.push({ code: "module.dependencyCycle", path: moduleId, message: `Module dependency cycle: ${cycle}`, severity: "error" });
      }
      return;
    }

    const manifest = catalog.get(moduleId);
    if (!manifest) {
      diagnostics.push({ code: "module.notFound", path: moduleId, message: `Module '${moduleId}' is not present in the catalog`, severity: "error" });
      return;
    }
    state.set(moduleId, "visiting");
    try {
      if (!satisfiesSemVer(flowerVersion, manifest.compatibleFlower)) {
        diagnostics.push({
          code: "module.incompatibleFlower",
          path: moduleId,
          message: `Module '${moduleId}' requires Flower ${manifest.compatibleFlower}; current version is ${flowerVersion}`,
          severity: "error"
        });
      }
    } catch {
      diagnostics.push({ code: "module.invalidCompatibilityRange", path: moduleId, message: `Module '${moduleId}' has an invalid Flower compatibility range`, severity: "error" });
    }

    for (const dependencyId of Object.keys(manifest.dependsOn).sort()) {
      const dependency = catalog.get(dependencyId);
      if (!dependency) {
        diagnostics.push({ code: "module.notFound", path: `${moduleId}/${dependencyId}`, message: `Dependency '${dependencyId}' required by '${moduleId}' is not present in the catalog`, severity: "error" });
        continue;
      }
      try {
        if (!isValidSemVer(dependency.version)) continue;
        if (!satisfiesSemVer(dependency.version, manifest.dependsOn[dependencyId]!)) {
          diagnostics.push({
            code: "module.dependencyVersionMismatch",
            path: `${moduleId}/${dependencyId}`,
            message: `Module '${moduleId}' requires '${dependencyId}' ${manifest.dependsOn[dependencyId]}, but the catalog provides ${dependency.version}`,
            severity: "error"
          });
        }
      } catch {
        diagnostics.push({ code: "module.invalidDependencyRange", path: `${moduleId}/${dependencyId}`, message: `Module '${moduleId}' has an invalid range for '${dependencyId}'`, severity: "error" });
      }
      visit(dependencyId, [...ancestry, moduleId]);
    }
    state.set(moduleId, "resolved");
    if (!resolved.includes(moduleId)) resolved.push(moduleId);
  };

  requested.forEach((moduleId) => visit(moduleId, []));
  const selected = new Set([...resolved, ...Object.keys(installed)]);
  for (const moduleId of resolved) {
    const manifest = catalog.get(moduleId)!;
    for (const conflict of [...manifest.conflictsWith].sort()) {
      if (selected.has(conflict)) {
        diagnostics.push({ code: "module.conflict", path: `${moduleId}/${conflict}`, message: `Module '${moduleId}' conflicts with '${conflict}'`, severity: "error" });
      }
    }
    const installedVersion = installed[moduleId];
    if (installedVersion !== undefined && installedVersion !== manifest.version) {
      diagnostics.push({
        code: "module.installedVersionMismatch",
        path: moduleId,
        message: `Module '${moduleId}' is installed at ${installedVersion}, but the catalog resolves ${manifest.version}`,
        severity: "error"
      });
    }
  }

  const finalDiagnostics = sortedDiagnostics(diagnostics);
  const valid = finalDiagnostics.length === 0;
  return {
    valid,
    requested,
    resolved,
    actions: valid ? resolved.map((moduleId) => {
      const manifest = catalog.get(moduleId)!;
      return { kind: installed[moduleId] === manifest.version ? "retain" as const : "install" as const, moduleId, version: manifest.version };
    }) : [],
    diagnostics: finalDiagnostics
  };
}
