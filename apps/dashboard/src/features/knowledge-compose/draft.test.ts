import { expect, it } from "vitest";
import { parseDocumentDraft } from "./draft";
import { createDocumentRequestId } from "./templates";
it("validates restored draft shapes and rejects invalid storage", () => {
  expect(parseDocumentDraft("not json")).toBeNull();
  expect(parseDocumentDraft(JSON.stringify({ kind: "unknown" }))).toBeNull();
  expect(
    parseDocumentDraft(
      JSON.stringify({
        kind: "manual",
        project: "demo",
        title: "draft",
        drafts: { manual: ["purpose"] },
        requestId: null,
      }),
    )?.drafts.manual,
  ).toEqual(["purpose"]);
});
it("creates v4 request IDs without relying on secure-context-only randomUUID", () => {
  expect(createDocumentRequestId()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
