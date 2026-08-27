import { describe, expect, it } from "vitest";

import { resolveRouteTap } from "./route-query.js";
import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";

function geometry(
  points: Array<{ x: number; y: number }>,
): ResolvedRouteGeometry {
  return {
    routeId: "route-1",
    netId: "net-1",
    centerline: points,
    segments: points.slice(0, -1).map((from, segmentIndex) => ({
      address: {
        routeId: "route-1",
        legId: `route-1-leg-${segmentIndex}`,
        segmentIndex,
      },
      from,
      to: points[segmentIndex + 1]!,
      mode: "manual" as const,
    })),
    vertices: points.map((point, index) => ({
      index,
      point,
      kind:
        index === 0 || index === points.length - 1
          ? ("junction" as const)
          : ("bend" as const),
    })),
    endpointJoins: [],
    endpointConnections: {
      from: {
        endpoint: { kind: "junction", junctionId: "from" },
        contactPoint: points[0]!,
        gridLanding: points[0]!,
        escapePath: [],
        outward: null,
      },
      to: {
        endpoint: { kind: "junction", junctionId: "to" },
        contactPoint: points.at(-1)!,
        gridLanding: points.at(-1)!,
        escapePath: [],
        outward: null,
      },
    },
  };
}

describe("route queries", () => {
  it("prefers an in-tolerance interior vertex over a closer segment projection", () => {
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ]),
        { x: 100, y: 3 },
        10,
      ),
    ).toMatchObject({
      address: { routeId: "route-1", segmentIndex: 0 },
      point: { x: 100, y: 0 },
      distanceSquared: 9,
    });
  });

  it("projects to every Route segment, clamps endpoints, and includes diagonals", () => {
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ]),
        { x: 50, y: 6 },
        10,
      ),
    ).toMatchObject({ point: { x: 50, y: 0 }, distanceSquared: 36 });
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ]),
        { x: 200, y: 0 },
        10,
      ),
    ).toBeNull();
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]),
        { x: 50, y: 50 },
        10,
      ),
    ).toMatchObject({ point: { x: 50, y: 50 }, distanceSquared: 0 });
  });

  it("breaks equal-distance route hits by the lower segment index", () => {
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 100, y: 0 },
          { x: 150, y: 0 },
        ]),
        { x: 75, y: 0 },
        30,
      )?.address,
    ).toEqual({
      routeId: "route-1",
      legId: "route-1-leg-0",
      segmentIndex: 0,
    });
  });
});
