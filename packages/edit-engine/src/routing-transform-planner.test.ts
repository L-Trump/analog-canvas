import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { planRoutingTransform } from "./routing-transform-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("routing transform planner", () => {
  it("translates a selected loose conductor through the shared closure", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      {
        id: "J1",
        netId: "net",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "net",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const plan = planRoutingTransform(
      document,
      resolver,
      { instanceIds: [], routeIds: ["wire"], junctionIds: [] },
      { kind: "translate", delta: { x: 20, y: 30 } },
    );
    expect(plan.affected.internalRoutes).toEqual(["wire"]);
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluated.finalDocument.junctions).toMatchObject([
      { id: "J1", position: { x: 20, y: 30 } },
      { id: "J2", position: { x: 120, y: 30 } },
    ]);
  });

  it("supports a 180-degree operation and rejects protected conductors", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 50, y: 50 },
        rotation: 0,
        mirror: "none",
      },
    });
    const rotation = planRoutingTransform(
      document,
      resolver,
      { instanceIds: ["R1"], routeIds: [], junctionIds: [] },
      { kind: "rotate", degrees: 180, center: { x: 50, y: 50 } },
    );
    const rotated = gateRoutingOperationPlan(document, rotation, {
      symbolResolver: resolver,
    });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(
        rotated.evaluated.finalDocument.instances[0]?.placement,
      ).toMatchObject({ position: { x: 50, y: 50 }, rotation: 180 });
    }

    const protectedDocument = createEmptyDocument("protected", "Protected");
    protectedDocument.nets.push({ id: "net", terminals: [] });
    protectedDocument.junctions.push(
      { id: "A", netId: "net", position: { x: 0, y: 0 } },
      { id: "B", netId: "net", position: { x: 100, y: 0 } },
    );
    protectedDocument.routes.push(
      createRoutePath({
        id: "trunk",
        netId: "net",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "B" },
        bends: [],
        modes: ["trunk"],
      }),
    );
    const rejected = planRoutingTransform(
      protectedDocument,
      resolver,
      { instanceIds: [], routeIds: ["trunk"], junctionIds: [] },
      { kind: "translate", delta: { x: 10, y: 0 } },
    );
    expect(rejected.diagnostics).toMatchObject([
      { code: "ROUTING_TRANSFORM_PROTECTED", objectIds: ["trunk"] },
    ]);
  });
});
