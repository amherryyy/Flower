import { describe, expect, it } from "vitest";
import {
  inspectUpload,
  validateUpload,
  type UploadCandidate,
  type UploadContent,
  type UploadMalwareScanner,
  type UploadPolicy,
  type UploadSanitizer
} from "../packages/kernel/src/index.js";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const organizationId = "123e4567-e89b-42d3-a456-426614174001";
const policy: UploadPolicy = {
  schemaVersion: 1,
  maxBytes: 1024,
  ownerScopes: ["user", "organization"],
  mediaTypes: [
    { mediaType: "image/png", extensions: [".png"], signatures: ["89504e470d0a1a0a"] },
    { mediaType: "application/pdf", extensions: [".pdf"], signatures: ["255044462d"] }
  ]
};
const candidate: UploadCandidate = {
  fileName: "avatar.png",
  size: 512,
  declaredMediaType: "image/png",
  headerBytes: Buffer.from("89504e470d0a1a0a", "hex"),
  owner: { scope: "user", id: userId }
};

describe("upload validation", () => {
  it("accepts an allowed signature, extension, size, and authenticated owner", () => {
    expect(validateUpload(policy, candidate, { userId, organizationIds: [] })).toEqual({ valid: true, diagnostics: [] });
  });

  it("rejects traversal names and type, extension, signature, and size mismatches", () => {
    const result = validateUpload(policy, {
      ...candidate,
      fileName: "../payload.pdf",
      size: 2048,
      declaredMediaType: "application/pdf",
      headerBytes: Buffer.from("89504e470d0a1a0a", "hex")
    }, { userId, organizationIds: [] });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "upload.fileName",
      "upload.size",
      "upload.signature"
    ]));
  });

  it("rejects ownership claims outside the authenticated actor's organizations", () => {
    const result = validateUpload(policy, {
      ...candidate,
      owner: { scope: "organization", id: organizationId }
    }, { userId, organizationIds: [] });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "upload.ownerDenied" }));
  });

  it("accepts an explicit organization membership claim", () => {
    const result = validateUpload(policy, {
      ...candidate,
      owner: { scope: "organization", id: organizationId }
    }, { userId, organizationIds: [organizationId] });
    expect(result.valid).toBe(true);
  });

  it("scans before and after sanitization and returns only the transformed content", async () => {
    const original = content(candidate, "original");
    const sanitized = content({ ...candidate, size: 500 }, "sanitized");
    const scans: UploadContent[] = [];
    const scanner: UploadMalwareScanner = {
      async scan(value) {
        scans.push(value);
        return { verdict: "clean", engine: "fixture-scanner" };
      }
    };
    const sanitizer: UploadSanitizer = { async sanitize() { return sanitized; } };
    const result = await inspectUpload(policy, original, { userId, organizationIds: [] }, scanner, sanitizer);
    expect(scans).toEqual([original, result.content]);
    expect(result.content.candidate.size).toBe(500);
    expect(result.scannerEngines).toEqual(["fixture-scanner", "fixture-scanner"]);
  });

  it("fails closed for malware, inconclusive scans, sanitizer errors, and invalid transformed output", async () => {
    const original = content(candidate, "original");
    const clean: UploadMalwareScanner = { async scan() { return { verdict: "clean", engine: "fixture" }; } };
    const infected: UploadMalwareScanner = { async scan() { return { verdict: "infected", engine: "fixture" }; } };
    const unknown: UploadMalwareScanner = { async scan() { return { verdict: "unknown", engine: "fixture" }; } };
    const passthrough: UploadSanitizer = { async sanitize(value) { return value; } };
    await expect(inspectUpload(policy, original, { userId, organizationIds: [] }, infected, passthrough)).rejects.toEqual(
      expect.objectContaining({ code: "upload.malwareDetected" })
    );
    await expect(inspectUpload(policy, original, { userId, organizationIds: [] }, unknown, passthrough)).rejects.toEqual(
      expect.objectContaining({ code: "upload.scanInconclusive" })
    );
    await expect(inspectUpload(policy, original, { userId, organizationIds: [] }, {
      async scan() { throw new Error("scanner offline"); }
    }, passthrough)).rejects.toEqual(expect.objectContaining({ code: "upload.scannerUnavailable" }));
    await expect(inspectUpload(policy, original, { userId, organizationIds: [] }, clean, {
      async sanitize() { throw new Error("offline"); }
    })).rejects.toEqual(expect.objectContaining({ code: "upload.sanitizerUnavailable" }));
    await expect(inspectUpload(policy, original, { userId, organizationIds: [] }, clean, {
      async sanitize() { return content({ ...candidate, headerBytes: new Uint8Array() }, "unsafe"); }
    })).rejects.toEqual(expect.objectContaining({ code: "upload.sanitizationRejected" }));

    let scan = 0;
    await expect(inspectUpload(policy, original, { userId, organizationIds: [] }, {
      async scan() { return { verdict: ++scan === 1 ? "clean" : "infected", engine: "fixture" }; }
    }, passthrough)).rejects.toEqual(expect.objectContaining({ code: "upload.malwareDetected" }));
  });
});

function content(upload: UploadCandidate, value: string): UploadContent {
  return {
    candidate: upload,
    async *open() { yield Buffer.from(value); }
  };
}
