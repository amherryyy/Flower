import type {
  Diagnostic,
  FlowerRelease,
  FlowerReleaseChannel,
  ModuleManifest,
  VersionCandidateEvaluation,
  VersionModuleCompatibility,
  VersionResolution,
  VersionResolutionInput
} from "./types.js";
import { compareSemVer, isPrereleaseSemVer, isValidSemVer, isValidSemVerRange, satisfiesSemVer } from "./semver.js";

const ALLOWED_CHANNELS: Readonly<Record<FlowerReleaseChannel, ReadonlySet<FlowerReleaseChannel>>> = {
  stable: new Set(["stable"]),
  preview: new Set(["stable", "preview"]),
  development: new Set(["stable", "preview", "development"])
};

function diagnostic(code: string, path: string, message: string): Diagnostic {
  return { code, path, message, severity: "error" };
}

function sortedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
  );
}

function moduleIndex(catalog: readonly ModuleManifest[], diagnostics: Diagnostic[]): Map<string, ModuleManifest> {
  const index = new Map<string, ModuleManifest>();
  for (const module of catalog) {
    const identity = `${module.id}@${module.version}`;
    if (!isValidSemVer(module.version)) {
      diagnostics.push(diagnostic("update.invalidModuleVersion", identity, `Module '${module.id}' has an invalid semantic version`));
    }
    if (!isValidSemVerRange(module.compatibleFlower)) {
      diagnostics.push(diagnostic(
        "update.invalidModuleCompatibility",
        identity,
        `Module '${identity}' has an unsupported Flower compatibility range`
      ));
    }
    if (index.has(identity)) {
      diagnostics.push(diagnostic("update.duplicateModulePackage", identity, `Module catalog contains duplicate '${identity}' packages`));
    } else {
      index.set(identity, module);
    }
  }
  return index;
}

function evaluateCandidate(
  release: FlowerRelease,
  installed: Readonly<Record<string, string>>,
  modules: ReadonlyMap<string, ModuleManifest>
): VersionCandidateEvaluation {
  const evaluations: VersionModuleCompatibility[] = Object.entries(installed)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([moduleId, moduleVersion]) => {
      const manifest = modules.get(`${moduleId}@${moduleVersion}`);
      if (!manifest) {
        return { moduleId, moduleVersion, compatible: false, reason: "package-not-found" };
      }
      const compatible = satisfiesSemVer(release.version, manifest.compatibleFlower);
      return {
        moduleId,
        moduleVersion,
        compatibleFlower: manifest.compatibleFlower,
        compatible,
        ...(compatible ? {} : { reason: "flower-version-unsupported" as const })
      };
    });
  return {
    version: release.version,
    channel: release.channel,
    compatible: evaluations.every(({ compatible }) => compatible),
    modules: evaluations
  };
}

function blocked(input: VersionResolutionInput, diagnostics: Diagnostic[], candidates: VersionCandidateEvaluation[] = []): VersionResolution {
  return {
    valid: false,
    state: "blocked",
    currentVersion: input.currentVersion,
    channel: input.channel,
    candidates,
    diagnostics: sortedDiagnostics(diagnostics)
  };
}

export function resolveFrameworkVersion(input: VersionResolutionInput): VersionResolution {
  const diagnostics: Diagnostic[] = [];
  if (!isValidSemVer(input.currentVersion)) {
    diagnostics.push(diagnostic("update.invalidCurrentVersion", "currentVersion", "Current Flower version is not valid semantic versioning"));
  }
  if (input.requestedVersion !== undefined && !isValidSemVer(input.requestedVersion)) {
    diagnostics.push(diagnostic("update.invalidRequestedVersion", "requestedVersion", "Requested Flower version is not valid semantic versioning"));
  }

  const releases = new Map<string, FlowerRelease>();
  for (const release of input.releases) {
    if (!isValidSemVer(release.version)) {
      diagnostics.push(diagnostic("update.invalidReleaseVersion", release.version, `Release '${release.version}' is not valid semantic versioning`));
    } else if (release.channel === "stable" && isPrereleaseSemVer(release.version)) {
      diagnostics.push(diagnostic("update.invalidStablePrerelease", release.version, `Stable release '${release.version}' cannot be a prerelease`));
    }
    if (releases.has(release.version)) {
      diagnostics.push(diagnostic("update.duplicateRelease", release.version, `Release catalog contains duplicate version '${release.version}'`));
    } else {
      releases.set(release.version, release);
    }
  }

  const modules = moduleIndex(input.moduleCatalog ?? [], diagnostics);
  if (diagnostics.length > 0) return blocked(input, diagnostics);

  if (input.requestedVersion !== undefined && compareSemVer(input.requestedVersion, input.currentVersion) < 0) {
    diagnostics.push(diagnostic(
      "update.downgradeUnsupported",
      input.requestedVersion,
      `Flower updates cannot downgrade ${input.currentVersion} to ${input.requestedVersion}`
    ));
    return blocked(input, diagnostics);
  }

  const eligible = [...releases.values()]
    .filter((release) => ALLOWED_CHANNELS[input.channel].has(release.channel))
    .filter((release) => compareSemVer(release.version, input.currentVersion) >= 0)
    .sort((left, right) => compareSemVer(right.version, left.version));

  let considered = eligible;
  if (input.requestedVersion !== undefined) {
    const requested = releases.get(input.requestedVersion);
    if (!requested) {
      diagnostics.push(diagnostic("update.releaseNotFound", input.requestedVersion, `Requested release '${input.requestedVersion}' is not in the catalog`));
      return blocked(input, diagnostics);
    }
    if (!ALLOWED_CHANNELS[input.channel].has(requested.channel)) {
      diagnostics.push(diagnostic(
        "update.channelBlocked",
        requested.version,
        `The ${input.channel} channel does not accept ${requested.channel} release '${requested.version}'`
      ));
      return blocked(input, diagnostics);
    }
    considered = [requested];
  }

  const candidates = considered.map((release) => evaluateCandidate(release, input.installedModules ?? {}, modules));
  const selected = candidates.find(({ compatible }) => compatible);
  if (!selected) {
    if (candidates.length === 0 && input.requestedVersion === undefined) {
      return {
        valid: true,
        state: "unchanged",
        currentVersion: input.currentVersion,
        targetVersion: input.currentVersion,
        channel: input.channel,
        candidates: [],
        diagnostics: []
      };
    }
    diagnostics.push(diagnostic(
      "update.noCompatibleRelease",
      input.requestedVersion ?? "releases",
      input.requestedVersion === undefined
        ? "No channel-eligible release is compatible with every installed module"
        : `Requested release '${input.requestedVersion}' is incompatible with one or more installed modules`
    ));
    return blocked(input, diagnostics, candidates);
  }

  return {
    valid: true,
    state: compareSemVer(selected.version, input.currentVersion) === 0 ? "unchanged" : "update",
    currentVersion: input.currentVersion,
    targetVersion: selected.version,
    channel: input.channel,
    candidates,
    diagnostics: []
  };
}
