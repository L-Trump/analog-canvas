import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { endpointKey, resolveEndpointPoint } from "./endpoint.js";
import {
  intersectSegments,
  pointOnSegment,
  projectPointToSegment,
} from "./segment-geometry.js";

import type {
  ResolvedDocumentRoutingGeometry,
  ResolvedRouteGeometry,
  ResolvedRouteSegment,
  RouteSegmentAddress,
} from "./resolved-route-geometry.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";

export interface RouteSegmentHit {
  address: RouteSegmentAddress;
  point: Point;
  t: number;
  distanceSquared: number;
}

export interface Crossing {
  routeAId: string;
  routeBId: string;
  netAId: string;
  netBId: string;
  point: Point;
  kind: "crossing" | "overlap";
}

export function projectPointToRouteSegment(
  point: Point,
  segment: ResolvedRouteSegment,
): RouteSegmentHit | null {
  const projected = projectPointToSegment(point, segment.from, segment.to);
  if (!projected) return null;
  return {
    address: segment.address,
    point: projected.point,
    t: projected.t,
    distanceSquared: projected.distanceSquared,
  };
}

export function nearestRouteSegment(
  geometry: ResolvedRouteGeometry,
  point: Point,
): RouteSegmentHit | null {
  return (
    geometry.segments
      .flatMap((segment) => {
        const hit = projectPointToRouteSegment(point, segment);
        return hit ? [hit] : [];
      })
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.address.segmentIndex - right.address.segmentIndex,
      )[0] ?? null
  );
}

/**
 * Preserve the editor's bend-first route hit behavior. A bend belongs to the
 * preceding segment; otherwise the nearest in-tolerance segment
 * wins, with the lower segment index as the deterministic tie-break.
 */
export function resolveRouteTap(
  geometry: ResolvedRouteGeometry,
  pointer: Point,
  tolerance: number,
): RouteSegmentHit | null {
  const toleranceSquared = tolerance * tolerance;
  const vertex = geometry.vertices
    .slice(1, -1)
    .map((candidate) => {
      const distanceSquared =
        (pointer.x - candidate.point.x) ** 2 +
        (pointer.y - candidate.point.y) ** 2;
      return {
        address: geometry.segments[candidate.index - 1]!.address,
        point: { ...candidate.point },
        t: 1,
        distanceSquared,
      };
    })
    .filter((candidate) => candidate.distanceSquared <= toleranceSquared)
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.address.segmentIndex - right.address.segmentIndex,
    )[0];
  if (vertex) return vertex;

  return (
    geometry.segments
      .flatMap((segment) => {
        const hit = projectPointToRouteSegment(pointer, segment);
        return hit && hit.distanceSquared <= toleranceSquared ? [hit] : [];
      })
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.address.segmentIndex - right.address.segmentIndex,
      )[0] ?? null
  );
}

export function findRouteSegmentsAtPoint(
  geometry: ResolvedDocumentRoutingGeometry,
  point: Point,
): RouteSegmentAddress[] {
  return [...geometry.routes.values()]
    .flatMap((route) =>
      route.segments
        .filter((segment) => pointOnSegment(point, segment.from, segment.to))
        .map((segment) => segment.address),
    )
    .sort(
      (left, right) =>
        left.routeId.localeCompare(right.routeId, "en") ||
        left.segmentIndex - right.segmentIndex,
    );
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function sharedExplicitEndpoint(
  left: RouteBranch,
  right: RouteBranch,
): RouteEndpoint | null {
  for (const leftEndpoint of [left.start, routeEnd(left)]) {
    for (const rightEndpoint of [right.start, routeEnd(right)]) {
      if (endpointKey(leftEndpoint) === endpointKey(rightEndpoint)) {
        return leftEndpoint;
      }
    }
  }
  return null;
}

export function deriveCrossings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
): Crossing[] {
  const routes = [...document.routes].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  const result: Crossing[] = [];
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < routes.length;
      rightIndex += 1
    ) {
      const left = routes[leftIndex]!;
      const right = routes[rightIndex]!;
      const leftGeometry = routingGeometry.routes.get(left.id);
      const rightGeometry = routingGeometry.routes.get(right.id);
      if (!leftGeometry || !rightGeometry) continue;
      const shared = sharedExplicitEndpoint(left, right);
      const sharedPoint = shared
        ? resolveEndpointPoint(document, resolver, shared)
        : null;
      for (const leftSegment of leftGeometry.segments) {
        for (const rightSegment of rightGeometry.segments) {
          const intersection = intersectSegments(
            leftSegment.from,
            leftSegment.to,
            rightSegment.from,
            rightSegment.to,
          );
          if (!intersection) continue;
          if (sharedPoint && samePoint(sharedPoint, intersection.point)) {
            continue;
          }
          result.push({
            routeAId: left.id,
            routeBId: right.id,
            netAId: left.netId,
            netBId: right.netId,
            point: intersection.point,
            kind: intersection.kind,
          });
        }
      }
    }
  }
  return result.sort(
    (left, right) =>
      left.routeAId.localeCompare(right.routeAId, "en") ||
      left.routeBId.localeCompare(right.routeBId, "en") ||
      left.point.x - right.point.x ||
      left.point.y - right.point.y,
  );
}
