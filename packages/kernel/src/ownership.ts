import path from "node:path";
import type {
  Diagnostic,
  OwnershipManifest,
  OwnershipRule,
  PathClassification,
  ValidationResult
} from "./types.js";
import { combineValidationResults, validateDocument } from "./validation.js";

function normalizePattern(pattern: string): string {
  return pattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

export function normalizeProjectPath(input: string): string {
  if (path.isAbsolute(input)) {
    throw new Error("Project paths must be relative");
  }

  const normalized = normalizePattern(input);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Project paths must not traverse outside the project");
  }

  return segments.filter((segment) => segment !== "." && segment !== "").join("/");
}

function escapeRegex(character: string): string {
  return /[|\\{}()[\]^$+?.]/.test(character) ? `\\${character}` : character;
}

function globToRegex(pattern: string): RegExp {
  const normalized = normalizePattern(pattern);
  let expression = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    const next = normalized[index + 1];

    if (character === "*" && next === "*") {
      const followedBySlash = normalized[index + 2] === "/";
      expression += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
      continue;
    }

    if (character === "*") {
      expression += "[^/]*";
      continue;
    }

    expression += escapeRegex(character);
  }

  return new RegExp(`${expression}$`);
}

function patternSpecificity(pattern: string): number {
  return normalizePattern(pattern).replaceAll("**", "").replaceAll("*", "").length;
}

function sameRule(left: OwnershipRule, right: OwnershipRule): boolean {
  return left.owner === right.owner && left.policy === right.policy;
}

export function classifyPath(
  manifest: OwnershipManifest,
  inputPath: string
): PathClassification {
  const projectPath = normalizeProjectPath(inputPath);
  const matches = manifest.rules.filter((rule) => globToRegex(rule.pattern).test(projectPath));
  if (matches.length === 0) {
    return { path: projectPath, matches, conflict: false };
  }

  const highestSpecificity = Math.max(...matches.map((rule) => patternSpecificity(rule.pattern)));
  const strongestMatches = matches.filter(
    (rule) => patternSpecificity(rule.pattern) === highestSpecificity
  );
  const selected = strongestMatches[0];
  const conflict = Boolean(
    selected && strongestMatches.some((rule) => !sameRule(rule, selected))
  );

  return {
    path: projectPath,
    matches,
    ...(selected ? { rule: selected } : {}),
    conflict
  };
}

export function validateOwnershipManifest(
  schema: object,
  document: unknown
): ValidationResult {
  const schemaResult = validateDocument(schema, document, "ownership");
  if (!schemaResult.valid) {
    return schemaResult;
  }

  const manifest = document as OwnershipManifest;
  const diagnostics: Diagnostic[] = [];
  const rulesByPattern = new Map<string, OwnershipRule>();

  manifest.rules.forEach((rule, index) => {
    const normalized = normalizePattern(rule.pattern);
    const previous = rulesByPattern.get(normalized);

    if (previous && !sameRule(previous, rule)) {
      diagnostics.push({
        code: "ownership.patternConflict",
        path: `/rules/${index}/pattern`,
        message: `Pattern '${normalized}' has conflicting ownership rules`,
        severity: "error"
      });
    } else if (!previous) {
      rulesByPattern.set(normalized, rule);
    }
  });

  return combineValidationResults(schemaResult, {
    valid: diagnostics.length === 0,
    diagnostics
  });
}

export function validateOwnershipCoverage(
  manifest: OwnershipManifest,
  paths: string[]
): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  for (const inputPath of paths) {
    try {
      const classification = classifyPath(manifest, inputPath);
      if (classification.matches.length === 0) {
        diagnostics.push({
          code: "ownership.unclassifiedPath",
          path: classification.path,
          message: "Path is not covered by an ownership rule",
          severity: "error"
        });
      } else if (classification.conflict) {
        diagnostics.push({
          code: "ownership.pathConflict",
          path: classification.path,
          message: "Path matches equally specific conflicting ownership rules",
          severity: "error"
        });
      }
    } catch (error) {
      diagnostics.push({
        code: "ownership.invalidPath",
        path: inputPath,
        message: error instanceof Error ? error.message : "Invalid project path",
        severity: "error"
      });
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics: diagnostics.sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function validateMutationOwnership(
  manifest: OwnershipManifest,
  paths: string[],
  allowedOwners: OwnershipRule["owner"][] = ["project"]
): ValidationResult {
  const coverage = validateOwnershipCoverage(manifest, paths);
  const diagnostics = [...coverage.diagnostics];

  for (const inputPath of paths) {
    try {
      const classification = classifyPath(manifest, inputPath);
      if (
        classification.rule &&
        !classification.conflict &&
        !allowedOwners.includes(classification.rule.owner)
      ) {
        diagnostics.push({
          code: "ownership.writeDenied",
          path: classification.path,
          message: `Writes to '${classification.rule.owner}' paths are not allowed in this operation`,
          severity: "error"
        });
      }
    } catch {
      // Coverage already reports malformed paths.
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics: diagnostics.sort(
      (left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
    )
  };
}
