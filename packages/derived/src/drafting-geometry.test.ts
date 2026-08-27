import { createEmptyDocument } from "@icm/model";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveDraftingObjectGeometry } from "./drafting-geometry.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function rectangle(
  id: string,
  center: { x: number; y: number },
  width = 80,
  height = 40,
): Extract<DraftingObject, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: center },
    center,
    width,
    height,
    rotation: 0,
    lineStyle: "solid",
  };
}

function circle(
  id: string,
  center: { x: number; y: number },
  radius = 40,
): Extract<DraftingObject, { kind: "circle" }> {
  return {
    id,
    kind: "circle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: center },
    center,
    radius,
    lineStyle: "solid",
  };
}

function anchoredLabel(
  id: string,
  rectangleId: string,
  fallbackPosition: { x: number; y: number },
): Extract<DraftingObject, { kind: "text" }> {
  return {
    id,
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: {
      kind: "object",
      objectId: rectangleId,
      localOffset: { x: 0, y: 0 },
      fallbackPosition,
    },
    content: { runs: [{ kind: "text", value: "PFD" }] },
    alignment: "middle",
    rotation: 0,
    typographyToken: "label",
  };
}

function documentWith(objects: DraftingObject[]): SchematicDocument {
  const document = createEmptyDocument("doc", "Drafting");
  document.drafting = { objects };
  return document;
}

describe("object-anchored drafting text on rectangles", () => {
  it("resolves circle geometry from its center and radius", () => {
    const object = circle("circle-1", { x: 100, y: 60 }, 30);
    const geometry = resolveDraftingObjectGeometry(
      documentWith([object]),
      resolver,
      object,
    );
    expect(geometry).toMatchObject({
      kind: "circle",
      center: { x: 100, y: 60 },
      radius: 30,
      bounds: { x: 64, y: 24, width: 72, height: 72 },
    });
  });
  it("resolves the label at the rectangle center", () => {
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }),
      anchoredLabel("label-1", "box-1", { x: 0, y: 0 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[1]!,
    );
    expect(geometry.kind).toBe("text");
    if (geometry.kind !== "text") return;
    expect(geometry.position).toEqual({ x: 100, y: 60 });
    expect(geometry.diagnostics).toEqual([]);
    // Bounds stay centered on the resolved anchor.
    expect(geometry.bounds.x + geometry.bounds.width / 2).toBeCloseTo(100);
    expect(geometry.bounds.y + geometry.bounds.height / 2).toBeCloseTo(60);
  });

  it("keeps the resolved center in sync with a moved rectangle", () => {
    const moved = documentWith([
      rectangle("box-1", { x: 250, y: -30 }),
      anchoredLabel("label-1", "box-1", { x: 0, y: 0 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      moved,
      resolver,
      moved.drafting!.objects[1]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 250, y: -30 });
  });

  it("applies the local offset relative to the rectangle center", () => {
    const label = anchoredLabel("label-1", "box-1", { x: 0, y: 0 });
    label.anchor = {
      kind: "object",
      objectId: "box-1",
      localOffset: { x: 10, y: -5 },
      fallbackPosition: { x: 0, y: 0 },
    };
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }),
      label,
    ]);
    const geometry = resolveDraftingObjectGeometry(document, resolver, label);
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 110, y: 55 });
  });

  it("falls back with a missing-target diagnostic when the rectangle is gone", () => {
    const document = documentWith([
      anchoredLabel("label-1", "box-gone", { x: 40, y: 20 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[0]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 40, y: 20 });
    expect(geometry.diagnostics).toHaveLength(1);
    expect(geometry.diagnostics[0]).toMatchObject({
      code: "DRAFTING_ANCHOR_TARGET_MISSING",
      anchorRole: "anchor",
      targetObjectIds: ["box-gone"],
    });
  });

  it("does not resolve non-rectangle drafting targets", () => {
    const otherText: Extract<DraftingObject, { kind: "text" }> = {
      id: "note-1",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 5, y: 5 } },
      content: { runs: [{ kind: "text", value: "free" }] },
      alignment: "start",
      rotation: 0,
    };
    const document = documentWith([
      otherText,
      anchoredLabel("label-1", "note-1", { x: 40, y: 20 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[1]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 40, y: 20 });
    expect(geometry.diagnostics[0]?.code).toBe(
      "DRAFTING_ANCHOR_TARGET_MISSING",
    );
  });
});
