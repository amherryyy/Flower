import { sha256 } from "./template.js";
import type {
  GeneratedTextMergeConflict,
  GeneratedTextMergeResult,
  GeneratedTextMergeStatus
} from "./types.js";

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_DIFF_CELLS = 1_000_000;

interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  replacement: string[];
}

export class GeneratedTextMergeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GeneratedTextMergeError";
    this.code = code;
  }
}

function assertText(value: string, label: string): void {
  if (value.includes("\0")) {
    throw new GeneratedTextMergeError(`${label} generated content is binary`, "update.generatedMergeBinary");
  }
  if (Buffer.byteLength(value) > MAX_TEXT_BYTES) {
    throw new GeneratedTextMergeError(`${label} generated content exceeds the merge limit`, "update.generatedMergeTooLarge");
  }
}

function lines(value: string): string[] {
  return value.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

function diff(base: readonly string[], changed: readonly string[]): DiffHunk[] {
  const columns = changed.length + 1;
  const cells = (base.length + 1) * columns;
  if (cells > MAX_DIFF_CELLS) {
    throw new GeneratedTextMergeError("Generated text diff exceeds the merge complexity limit", "update.generatedMergeTooComplex");
  }
  const lcs = new Uint32Array(cells);
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let changedIndex = changed.length - 1; changedIndex >= 0; changedIndex -= 1) {
      const index = baseIndex * columns + changedIndex;
      lcs[index] = base[baseIndex] === changed[changedIndex]
        ? lcs[(baseIndex + 1) * columns + changedIndex + 1]! + 1
        : Math.max(lcs[(baseIndex + 1) * columns + changedIndex]!, lcs[baseIndex * columns + changedIndex + 1]!);
    }
  }

  const hunks: DiffHunk[] = [];
  let baseIndex = 0;
  let changedIndex = 0;
  let active: { baseStart: number; changedStart: number } | undefined;
  const flush = (): void => {
    if (!active) return;
    hunks.push({
      baseStart: active.baseStart,
      baseEnd: baseIndex,
      replacement: changed.slice(active.changedStart, changedIndex)
    });
    active = undefined;
  };

  while (baseIndex < base.length || changedIndex < changed.length) {
    if (baseIndex < base.length && changedIndex < changed.length && base[baseIndex] === changed[changedIndex]) {
      flush();
      baseIndex += 1;
      changedIndex += 1;
      continue;
    }
    active ??= { baseStart: baseIndex, changedStart: changedIndex };
    const insert = changedIndex < changed.length && (
      baseIndex === base.length ||
      lcs[baseIndex * columns + changedIndex + 1]! >= lcs[(baseIndex + 1) * columns + changedIndex]!
    );
    if (insert) changedIndex += 1;
    else baseIndex += 1;
  }
  flush();
  return hunks;
}

function interacts(left: DiffHunk, right: DiffHunk): boolean {
  const leftInsertion = left.baseStart === left.baseEnd;
  const rightInsertion = right.baseStart === right.baseEnd;
  if (leftInsertion && rightInsertion) return left.baseStart === right.baseStart;
  if (leftInsertion) return left.baseStart > right.baseStart && left.baseStart < right.baseEnd;
  if (rightInsertion) return right.baseStart > left.baseStart && right.baseStart < left.baseEnd;
  return Math.max(left.baseStart, right.baseStart) < Math.min(left.baseEnd, right.baseEnd);
}

function applyHunks(base: readonly string[], start: number, end: number, hunks: readonly DiffHunk[]): string[] {
  const output: string[] = [];
  let cursor = start;
  for (const hunk of hunks) {
    output.push(...base.slice(cursor, hunk.baseStart), ...hunk.replacement);
    cursor = hunk.baseEnd;
  }
  output.push(...base.slice(cursor, end));
  return output;
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function startsWithLines(value: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((line, index) => line === value[index]);
}

function endsWithLines(value: readonly string[], suffix: readonly string[]): boolean {
  const offset = value.length - suffix.length;
  return offset >= 0 && suffix.every((line, index) => line === value[offset + index]);
}

function orderedBefore(left: DiffHunk, right: DiffHunk): boolean {
  if (left.baseStart !== right.baseStart) return left.baseStart < right.baseStart;
  const leftInsertion = left.baseStart === left.baseEnd;
  const rightInsertion = right.baseStart === right.baseEnd;
  if (leftInsertion !== rightInsertion) return leftInsertion;
  return left.baseEnd <= right.baseEnd;
}

function complete(
  status: Exclude<GeneratedTextMergeStatus, "conflict">,
  content: string,
  baseDigest: string,
  currentDigest: string,
  targetDigest: string
): GeneratedTextMergeResult {
  return {
    status,
    baseDigest,
    currentDigest,
    targetDigest,
    outputDigest: sha256(content),
    content,
    conflicts: []
  };
}

export function mergeGeneratedText(baseText: string, currentText: string, targetText: string): GeneratedTextMergeResult {
  assertText(baseText, "Base");
  assertText(currentText, "Current");
  assertText(targetText, "Target");
  const baseDigest = sha256(baseText);
  const currentDigest = sha256(currentText);
  const targetDigest = sha256(targetText);

  if (currentText === baseText && targetText === baseText) {
    return complete("unchanged", baseText, baseDigest, currentDigest, targetDigest);
  }
  if (currentText === baseText) {
    return complete("replace", targetText, baseDigest, currentDigest, targetDigest);
  }
  if (targetText === baseText) {
    return complete("preserve", currentText, baseDigest, currentDigest, targetDigest);
  }
  if (currentText === targetText) {
    return complete("converged", currentText, baseDigest, currentDigest, targetDigest);
  }

  const base = lines(baseText);
  const currentHunks = diff(base, lines(currentText));
  const targetHunks = diff(base, lines(targetText));
  const output: string[] = [];
  const conflicts: GeneratedTextMergeConflict[] = [];
  let currentIndex = 0;
  let targetIndex = 0;
  let baseCursor = 0;
  let lastCurrent: DiffHunk | undefined;
  let lastTarget: DiffHunk | undefined;

  while (currentIndex < currentHunks.length || targetIndex < targetHunks.length) {
    const current = currentHunks[currentIndex];
    const target = targetHunks[targetIndex];
    if (current && target && interacts(current, target)) {
      const currentGroup: DiffHunk[] = [current];
      const targetGroup: DiffHunk[] = [target];
      currentIndex += 1;
      targetIndex += 1;
      let expanded = true;
      while (expanded) {
        expanded = false;
        const nextCurrent = currentHunks[currentIndex];
        if (nextCurrent && targetGroup.some((hunk) => interacts(nextCurrent, hunk))) {
          currentGroup.push(nextCurrent);
          currentIndex += 1;
          expanded = true;
        }
        const nextTarget = targetHunks[targetIndex];
        if (nextTarget && currentGroup.some((hunk) => interacts(nextTarget, hunk))) {
          targetGroup.push(nextTarget);
          targetIndex += 1;
          expanded = true;
        }
      }
      const group = [...currentGroup, ...targetGroup];
      const start = Math.min(...group.map(({ baseStart }) => baseStart));
      const end = Math.max(...group.map(({ baseEnd }) => baseEnd));
      output.push(...base.slice(baseCursor, start));
      const currentOutput = applyHunks(base, start, end, currentGroup);
      const targetOutput = applyHunks(base, start, end, targetGroup);
      if (sameLines(currentOutput, targetOutput)) {
        output.push(...currentOutput);
      } else {
        conflicts.push({
          baseStart: start,
          baseEnd: end,
          base: base.slice(start, end).join(""),
          current: currentOutput.join(""),
          target: targetOutput.join("")
        });
        output.push(...base.slice(start, end));
      }
      lastCurrent = currentGroup.at(-1);
      lastTarget = targetGroup.at(-1);
      baseCursor = end;
      continue;
    }

    const selected = current && (!target || orderedBefore(current, target)) ? current : target!;
    const selectedIsCurrent = selected === current;
    if (selectedIsCurrent) currentIndex += 1;
    else targetIndex += 1;
    if (selected.baseStart === selected.baseEnd) {
      const oppositePrevious = selectedIsCurrent ? lastTarget : lastCurrent;
      const oppositeNext = selectedIsCurrent ? target : current;
      const representedByPrevious = oppositePrevious?.baseEnd === selected.baseStart &&
        endsWithLines(oppositePrevious.replacement, selected.replacement);
      const representedByNext = oppositeNext?.baseStart === selected.baseStart &&
        oppositeNext.baseEnd > oppositeNext.baseStart &&
        startsWithLines(oppositeNext.replacement, selected.replacement);
      if (representedByPrevious || representedByNext) continue;
    }
    output.push(...base.slice(baseCursor, selected.baseStart), ...selected.replacement);
    baseCursor = selected.baseEnd;
    if (selectedIsCurrent) lastCurrent = selected;
    else lastTarget = selected;
  }
  output.push(...base.slice(baseCursor));

  if (conflicts.length > 0) {
    return { status: "conflict", baseDigest, currentDigest, targetDigest, conflicts };
  }
  return complete("merge", output.join(""), baseDigest, currentDigest, targetDigest);
}
