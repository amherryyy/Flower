import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createJournalEntry,
  redactJournalValue,
  writeLocalJournal
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local operation journal", () => {
  it("redacts sensitive fields and recognizable credentials recursively", () => {
    const redacted = redactJournalValue({
      apiKey: "secret-value",
      nested: {
        authorization: "Bearer visible-token",
        connection: "postgresql://flower:password@example.test/database"
      }
    });

    expect(redacted).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        connection: "postgresql://flower:[REDACTED]@example.test/database"
      }
    });
  });

  it("writes a redacted entry atomically under the project-local journal", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "flower-journal-"));
    temporaryDirectories.push(projectRoot);
    const entry = createJournalEntry("flower test", "completed", {
      result: { token: "not-for-disk", count: 2 }
    });

    const journalPath = await writeLocalJournal(projectRoot, entry);
    const stored = JSON.parse(await readFile(journalPath, "utf8")) as {
      result: { token: string; count: number };
    };

    expect(path.dirname(journalPath)).toBe(path.join(projectRoot, ".flower", "journal", "local"));
    expect(stored.result).toEqual({ token: "[REDACTED]", count: 2 });
  });

  it("rejects journal identifiers that could escape the local journal directory", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "flower-journal-"));
    temporaryDirectories.push(projectRoot);
    const entry = {
      ...createJournalEntry("flower test", "failed"),
      id: "../outside"
    };

    await expect(writeLocalJournal(projectRoot, entry)).rejects.toThrow(/unsafe filename/);
  });
});
