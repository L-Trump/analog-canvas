import { createEmptyProject } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  resolveDocumentRoutingGeometry,
  resolveRouteGeometry,
} from "./resolved-route-geometry.js";
import { resolveRouteAttachment } from "./route-attachment.js";
import { electricalTopologyHash } from "./topology-hash.js";

const resolver = new InMemorySymbolResolver([
  {
    schemaVersion: 1 as const,
    id: "dual",
    name: "Dual",
    viewBox: { x: -20, y: -20, width: 40, height: 40 },
    pins: [
      {
        name: "R",
        role: "passive",
        at: { x: 20, y: 0 },
        direction: "east" as const,
        presentation: { visibility: "visible" as const },
      },
    ],
    primitives: [
      { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
    ],
    variants: [],
  },
]);

function document(id: string): SchematicDocument {
  return createEmptyProject(id, id, id).documents[0]!;
}

describe("resolved route geometry", () => {
  it("characterizes the schema-25 route contract before stable-leg migration", () => {
    const project = createEmptyProject(
      "route-contract",
      "Route contract",
      "doc",
    );
    const schematic = project.documents[0]!;
    schematic.nets.push({ id: "n", terminals: [] });
    schematic.junctions.push(
      { id: "j1", netId: "n", position: { x: 0, y: 0 } },
      { id: "j2", netId: "n", position: { x: 100, y: 100 } },
    );
    schematic.routes.push({
      id: "route-contract",
      netId: "n",
      from: { kind: "junction", junctionId: "j1" },
      to: { kind: "junction", junctionId: "j2" },
      waypoints: [
        { x: 40, y: 0 },
        { x: 40, y: 100 },
      ],
      segmentModes: ["escape", "manual", "trunk"],
    });

    const topologyBefore = electricalTopologyHash(project);
    const serializedRoute = JSON.parse(
      JSON.stringify(schematic.routes[0]),
    ) as unknown;
    const geometry = resolveRouteGeometry(
      schematic,
      resolver,
      schematic.routes[0]!,
    );

    expect(serializedRoute).toEqual({
      id: "route-contract",
      netId: "n",
      from: { kind: "junction", junctionId: "j1" },
      to: { kind: "junction", junctionId: "j2" },
      waypoints: [
        { x: 40, y: 0 },
        { x: 40, y: 100 },
      ],
      segmentModes: ["escape", "manual", "trunk"],
    });
    expect(geometry?.centerline).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(geometry?.segments.map((segment) => segment.mode)).toEqual([
      "escape",
      "manual",
      "trunk",
    ]);
    expect(
      geometry &&
        resolveRouteAttachment(geometry, {
          routeId: "route-contract",
          segmentIndex: 1,
          t: 0.25,
          direction: "forward",
          normalOffset: 10,
        }),
    ).toEqual({
      conductorPoint: { x: 40, y: 25 },
      labelPoint: { x: 30, y: 25 },
      rotation: 90,
    });

    schematic.routes[0]!.waypoints = [
      { x: 60, y: 0 },
      { x: 60, y: 100 },
    ];
    expect(electricalTopologyHash(project)).toBe(topologyBefore);
  });

  it("resolves one canonical centerline with ordered segments and vertices", () => {
    const schematic = document("orthogonal-route");
    schematic.junctions.push(
      { id: "j1", netId: "n", position: { x: 0, y: 0 } },
      { id: "j2", netId: "n", position: { x: 100, y: 100 } },
    );
    schematic.routes.push({
      id: "route-1",
      netId: "n",
      from: { kind: "junction", junctionId: "j1" },
      to: { kind: "junction", junctionId: "j2" },
      waypoints: [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      segmentModes: ["manual", "auto", "escape"],
    });

    expect(
      resolveRouteGeometry(schematic, resolver, schematic.routes[0]!),
    ).toMatchObject({
      routeId: "route-1",
      netId: "n",
      centerline: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 100 },
      ],
      segments: [
        {
          address: { routeId: "route-1", segmentIndex: 0 },
          from: { x: 0, y: 0 },
          to: { x: 50, y: 0 },
          mode: "manual",
        },
        {
          address: { routeId: "route-1", segmentIndex: 1 },
          from: { x: 50, y: 0 },
          to: { x: 50, y: 100 },
          mode: "auto",
        },
        {
          address: { routeId: "route-1", segmentIndex: 2 },
          from: { x: 50, y: 100 },
          to: { x: 100, y: 100 },
          mode: "escape",
        },
      ],
      vertices: [
        { index: 0, kind: "junction", point: { x: 0, y: 0 } },
        { index: 1, kind: "bend", point: { x: 50, y: 0 } },
        { index: 2, kind: "bend", point: { x: 50, y: 100 } },
        { index: 3, kind: "junction", point: { x: 100, y: 100 } },
      ],
    });
  });

  it("is unresolved when either stored endpoint cannot be resolved", () => {
    const schematic = document("missing-endpoint");
    schematic.junctions.push({
      id: "present",
      netId: "n",
      position: { x: 100, y: 0 },
    });
    schematic.routes.push({
      id: "route-missing",
      netId: "n",
      from: { kind: "junction", junctionId: "missing" },
      to: { kind: "junction", junctionId: "present" },
      waypoints: [],
      segmentModes: ["manual"],
    });

    expect(
      resolveRouteGeometry(schematic, resolver, schematic.routes[0]!),
    ).toBeNull();
  });

  it("retains terminal miter ingredients at a real pin origin", () => {
    const schematic = document("terminal-miter");
    schematic.instances.push({
      id: "I1",
      symbolId: "dual",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    schematic.junctions.push({
      id: "j1",
      netId: "n",
      position: { x: 200, y: 100 },
    });
    schematic.routes.push({
      id: "route-terminal",
      netId: "n",
      from: { kind: "terminal", instanceId: "I1", pinName: "R" },
      to: { kind: "junction", junctionId: "j1" },
      waypoints: [],
      segmentModes: ["manual"],
    });

    expect(
      resolveRouteGeometry(schematic, resolver, schematic.routes[0]!)
        ?.endpointJoins,
    ).toEqual([
      {
        kind: "terminal-miter",
        routeId: "route-terminal",
        at: { x: 120, y: 100 },
        pinOutward: { x: 1, y: 0 },
        routeDirection: { x: 1, y: 0 },
      },
    ]);
  });

  it("aggregates deterministic route order and degree-two route-anchor joins", () => {
    const schematic = document("route-anchor");
    schematic.junctions.push(
      { id: "left", netId: "n", position: { x: 0, y: 0 } },
      {
        id: "anchor",
        netId: "n",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      { id: "right", netId: "n", position: { x: 200, y: 0 } },
    );
    schematic.routes.push(
      {
        id: "z-right",
        netId: "n",
        from: { kind: "junction", junctionId: "anchor" },
        to: { kind: "junction", junctionId: "right" },
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "a-left",
        netId: "n",
        from: { kind: "junction", junctionId: "left" },
        to: { kind: "junction", junctionId: "anchor" },
        waypoints: [],
        segmentModes: ["manual"],
      },
    );

    const geometry = resolveDocumentRoutingGeometry(schematic, resolver);
    expect([...geometry.routes.keys()]).toEqual(["a-left", "z-right"]);
    expect(geometry.endpointJoins).toEqual([
      {
        kind: "route-anchor-miter",
        junctionId: "anchor",
        at: { x: 100, y: 0 },
        directions: [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
        ],
      },
    ]);
  });
});
