interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(input: string): SemanticVersion {
  const match = VERSION.exec(input);
  if (!match) throw new Error(`Invalid semantic version '${input}'`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
  if (leftNumber !== undefined) return -1;
  if (rightNumber !== undefined) return 1;
  return left.localeCompare(right);
}

function compare(left: SemanticVersion, right: SemanticVersion): number {
  const releaseDifference = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (releaseDifference !== 0) return releaseDifference;
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const difference = compareIdentifier(leftPart, rightPart);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function compareSemVer(left: string, right: string): number {
  return compare(parseVersion(left), parseVersion(right));
}

export function isPrereleaseSemVer(version: string): boolean {
  return parseVersion(version).prerelease.length > 0;
}

function upperBound(base: SemanticVersion, operator: "^" | "~"): SemanticVersion {
  if (operator === "~") return { major: base.major, minor: base.minor + 1, patch: 0, prerelease: [] };
  if (base.major > 0) return { major: base.major + 1, minor: 0, patch: 0, prerelease: [] };
  if (base.minor > 0) return { major: 0, minor: base.minor + 1, patch: 0, prerelease: [] };
  return { major: 0, minor: 0, patch: base.patch + 1, prerelease: [] };
}

function satisfiesComparator(version: SemanticVersion, comparator: string): boolean {
  if (comparator === "*") return true;
  const shorthand = /^([~^])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(comparator);
  if (shorthand) {
    const base = parseVersion(shorthand[2]!);
    return compare(version, base) >= 0 && compare(version, upperBound(base, shorthand[1] as "^" | "~")) < 0;
  }
  const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(comparator);
  if (!match) throw new Error(`Unsupported semantic version comparator '${comparator}'`);
  const difference = compare(version, parseVersion(match[2]!));
  switch (match[1] ?? "=") {
    case ">=": return difference >= 0;
    case "<=": return difference <= 0;
    case ">": return difference > 0;
    case "<": return difference < 0;
    default: return difference === 0;
  }
}

export function satisfiesSemVer(versionInput: string, rangeInput: string): boolean {
  const version = parseVersion(versionInput);
  const alternatives = rangeInput.split("||").map((range) => range.trim());
  if (alternatives.length === 0 || alternatives.some((alternative) => alternative.length === 0)) {
    throw new Error("Semantic version range must not contain an empty alternative");
  }
  return alternatives.some((alternative) => {
    const comparators = alternative.split(/\s+/).filter(Boolean);
    return comparators.every((comparator) => satisfiesComparator(version, comparator));
  });
}

export function isValidSemVer(version: string): boolean {
  try {
    parseVersion(version);
    return true;
  } catch {
    return false;
  }
}

export function isValidSemVerRange(range: string): boolean {
  try {
    satisfiesSemVer("0.1.0", range);
    return true;
  } catch {
    return false;
  }
}
