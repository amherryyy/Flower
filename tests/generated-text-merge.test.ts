import { describe, expect, it } from "vitest";
import {
  GeneratedTextMergeError,
  mergeGeneratedText,
  sha256
} from "../packages/kernel/src/index.js";

describe("F6 generated-text three-way merge", () => {
  it("classifies unchanged, framework-only, project-only, and converged content", () => {
    const base = "one\ntwo\n";
    expect(mergeGeneratedText(base, base, base)).toMatchObject({ status: "unchanged", content: base });
    expect(mergeGeneratedText(base, base, "one\nTWO\n")).toMatchObject({ status: "replace", content: "one\nTWO\n" });
    expect(mergeGeneratedText(base, "ONE\ntwo\n", base)).toMatchObject({ status: "preserve", content: "ONE\ntwo\n" });
    expect(mergeGeneratedText(base, "ONE\ntwo\n", "ONE\ntwo\n")).toMatchObject({ status: "converged", content: "ONE\ntwo\n" });
  });

  it("merges non-overlapping project and framework edits without losing either side", () => {
    const result = mergeGeneratedText(
      "one\ntwo\nthree\nfour\n",
      "ONE\ntwo\nthree\nfour\n",
      "one\ntwo\nthree\nFOUR\n"
    );
    expect(result).toMatchObject({
      status: "merge",
      content: "ONE\ntwo\nthree\nFOUR\n",
      conflicts: []
    });
    expect(result.outputDigest).toBe(sha256(result.content!));
  });

  it("merges independent insertions and preserves their deterministic base order", () => {
    const result = mergeGeneratedText(
      "alpha\nbeta\ngamma\n",
      "alpha\nproject\nbeta\ngamma\n",
      "alpha\nbeta\nframework\ngamma\n"
    );
    expect(result.status).toBe("merge");
    expect(result.content).toBe("alpha\nproject\nbeta\nframework\ngamma\n");
  });

  it("accepts the same insertion from both sides only once", () => {
    const result = mergeGeneratedText("alpha\nbeta\n", "alpha\nshared\nbeta\n", "alpha\nshared\nbeta\n");
    expect(result.status).toBe("converged");
    expect(result.content).toBe("alpha\nshared\nbeta\n");
  });

  it("deduplicates a shared insertion while merging other independent edits", () => {
    const result = mergeGeneratedText(
      "a\nb\nc\nd\n",
      "a\nshared\nb\nC\nd\n",
      "A\nshared\nb\nc\nd\n"
    );
    expect(result.status).toBe("merge");
    expect(result.content).toBe("A\nshared\nb\nC\nd\n");
  });

  it("deduplicates a shared insertion before a neighboring replacement", () => {
    const result = mergeGeneratedText(
      "a\nb\nc\nd\n",
      "shared\na\nb\nC\nd\n",
      "shared\nA\nb\nc\nd\n"
    );
    expect(result.status).toBe("merge");
    expect(result.content).toBe("shared\nA\nb\nC\nd\n");
  });

  it("combines a deletion with a separate framework edit", () => {
    const result = mergeGeneratedText(
      "one\ntwo\nthree\nfour\n",
      "one\nthree\nfour\n",
      "one\ntwo\nthree\nFOUR\n"
    );
    expect(result.status).toBe("merge");
    expect(result.content).toBe("one\nthree\nFOUR\n");
  });

  it("returns structured conflicts without emitting conflict-marker content", () => {
    const result = mergeGeneratedText(
      "alpha\nbeta\ngamma\n",
      "alpha\nproject beta\ngamma\n",
      "alpha\nframework beta\ngamma\n"
    );
    expect(result.status).toBe("conflict");
    expect(result.content).toBeUndefined();
    expect(result.outputDigest).toBeUndefined();
    expect(result.conflicts).toEqual([{
      baseStart: 1,
      baseEnd: 2,
      base: "beta\n",
      current: "project beta\n",
      target: "framework beta\n"
    }]);
  });

  it("treats different insertions at the same base position as a conflict", () => {
    const result = mergeGeneratedText(
      "alpha\nbeta\n",
      "alpha\nproject\nbeta\n",
      "alpha\nframework\nbeta\n"
    );
    expect(result.status).toBe("conflict");
    expect(result.conflicts[0]).toMatchObject({ baseStart: 1, baseEnd: 1, base: "" });
  });

  it("preserves exact line endings in clean short-circuit and merged output", () => {
    const base = "one\r\ntwo\r\nthree\r\n";
    const result = mergeGeneratedText(base, "ONE\r\ntwo\r\nthree\r\n", "one\r\ntwo\r\nTHREE\r\n");
    expect(result.content).toBe("ONE\r\ntwo\r\nTHREE\r\n");
  });

  it("fails closed for binary and pathologically expensive inputs", () => {
    expect(() => mergeGeneratedText("a\0b", "a\0b", "a\0b")).toThrowError(
      expect.objectContaining({ code: "update.generatedMergeBinary" })
    );
    const large = `${"line\n".repeat(1000)}end\n`;
    const changed = `${"other\n".repeat(1000)}end\n`;
    expect(() => mergeGeneratedText(large, changed, large.replace("end", "target"))).toThrowError(
      expect.objectContaining({ code: "update.generatedMergeTooComplex" })
    );
    expect(GeneratedTextMergeError).toBeDefined();
  });
});
