import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Flower project manifest names this project", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.flower/project.json", import.meta.url), "utf8"));
  assert.equal(manifest.project.id, "{{projectId}}");
  assert.equal(manifest.mode, "project");
});
