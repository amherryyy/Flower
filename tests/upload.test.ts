import { describe, expect, it } from "vitest";
import { validateUpload, type UploadCandidate, type UploadPolicy } from "../packages/kernel/src/index.js";

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
});
