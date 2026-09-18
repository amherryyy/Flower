import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FLOWER_VERSION, type JournalEntry } from "./types.js";

const SENSITIVE_KEY = /^(?:.*(?:password|secret|token|credential|authorization|cookie|private[_-]?key|api[_-]?key).*)$/i;

function redactString(value: string): string {
  return value
    .replace(/\b(?:sk|ghp|gho|ghu|ghs|ghr|sb_secret)_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

export function redactJournalValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactJournalValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactJournalValue(childValue, childKey)
      ])
    );
  }
  return value;
}

export function createJournalEntry(
  command: string,
  status: JournalEntry["status"],
  details: Partial<Omit<JournalEntry, "id" | "timestamp" | "command" | "flowerVersion" | "status">> = {}
): JournalEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    command,
    flowerVersion: FLOWER_VERSION,
    status,
    ...details
  };
}

export async function writeLocalJournal(
  projectRoot: string,
  entry: JournalEntry
): Promise<string> {
  const root = path.resolve(projectRoot);
  const journalDirectory = path.resolve(root, ".flower", "journal", "local");
  if (!/^[A-Za-z0-9-]{1,128}$/.test(entry.id)) {
    throw new Error("Journal entry id contains unsafe filename characters");
  }
  const timestamp = new Date(entry.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Journal entry timestamp is invalid");
  }

  await mkdir(journalDirectory, { recursive: true });
  const [realRoot, realJournalDirectory] = await Promise.all([
    realpath(root),
    realpath(journalDirectory)
  ]);
  const relativeJournalPath = path.relative(realRoot, realJournalDirectory);
  if (
    path.isAbsolute(relativeJournalPath) ||
    relativeJournalPath === ".." ||
    relativeJournalPath.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Journal directory escaped the project root through a symbolic link");
  }

  const filename = `${timestamp.toISOString().replaceAll(":", "-")}-${entry.id}.json`;
  const finalPath = path.join(journalDirectory, filename);
  const temporaryPath = `${finalPath}.tmp`;
  const redacted = redactJournalValue(entry);
  await writeFile(temporaryPath, `${JSON.stringify(redacted, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  await rename(temporaryPath, finalPath);
  return finalPath;
}
