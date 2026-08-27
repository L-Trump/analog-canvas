import type { Annotation, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveRouteEditPath } from "./route-operations.js";

export interface NetLabelRouteAnchor {
  annotationId: string;
  routeId: string;
  segmentIndex: number;
  segmentCount: number;
  t: number;
  normalOffset: number;
  arcFraction: number;
}

export interface RouteMarkerAnchor {
  annotationId: string;
  routeId: string;
  segmentIndex: number;
  segmentCount: number;
  t: number;
  position: Point;
  direction: Point;
  routeStart: Point;
  routeEnd: Point;
}

export function closestRouteMarkerAnchor(
  points: readonly Point[],
  position: Point,
  preferredDirection: Point,
): { segmentIndex: number; t: number; distanceSquared: number } | null {
  const candidates = points.slice(0, -1).flatMap((from, segmentIndex) => {
    const to = points[segmentIndex + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return [];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((position.x - from.x) * dx + (position.y - from.y) * dy) /
          lengthSquared,
      ),
    );
    const anchor = { x: from.x + dx * t, y: from.y + dy * t };
    const direction = { x: Math.sign(dx), y: Math.sign(dy) };
    return [
      {
        segmentIndex,
        t,
        distanceSquared:
          (position.x - anchor.x) ** 2 + (position.y - anchor.y) ** 2,
        directionPenalty:
          direction.x === preferredDirection.x &&
          direction.y === preferredDirection.y
            ? 0
            : direction.x === -preferredDirection.x &&
                direction.y === -preferredDirection.y
              ? 1
              : 2,
      },
    ];
  });
  const closest = candidates.sort(
    (left, right) =>
      left.distanceSquared - right.distanceSquared ||
      left.directionPenalty - right.directionPenalty ||
      left.segmentIndex - right.segmentIndex,
  )[0];
  return closest
    ? {
        segmentIndex: closest.segmentIndex,
        t: closest.t,
        distanceSquared: closest.distanceSquared,
      }
    : null;
}

function routeMarkerAttachment(annotation: Annotation) {
  if (annotation.kind !== "route-marker") return null;
  if (annotation.anchor.kind === "route") {
    return {
      routeId: annotation.anchor.routeId,
      legId: annotation.anchor.legId,
      t: annotation.anchor.t,
      direction: annotation.anchor.direction,
      normalOffset: annotation.anchor.normalOffset,
    };
  }
  return null;
}

function closestRouteAnchor(
  points: readonly Point[],
  position: Point,
):
  | (Omit<NetLabelRouteAnchor, "annotationId" | "routeId" | "segmentCount"> & {
      distanceSquared: number;
    })
  | null {
  const lengths = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]!;
    return Math.hypot(to.x - from.x, to.y - from.y);
  });
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (totalLength === 0) return null;
  let traversed = 0;
  const candidates = lengths.flatMap((length, segmentIndex) => {
    const from = points[segmentIndex]!;
    const to = points[segmentIndex + 1]!;
    if (length === 0) return [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((position.x - from.x) * dx + (position.y - from.y) * dy) /
          (length * length),
      ),
    );
    const anchor = { x: from.x + dx * t, y: from.y + dy * t };
    const delta = {
      x: position.x - anchor.x,
      y: position.y - anchor.y,
    };
    const candidate = {
      segmentIndex,
      t,
      normalOffset: delta.x * (-dy / length) + delta.y * (dx / length),
      arcFraction: (traversed + t * length) / totalLength,
      distanceSquared: delta.x * delta.x + delta.y * delta.y,
    };
    traversed += length;
    return [candidate];
  });
  return (
    candidates.sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.segmentIndex - right.segmentIndex,
    )[0] ?? null
  );
}

export function captureNetLabelRouteAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
): NetLabelRouteAnchor[] {
  const polylines = document.routes.flatMap((route) => {
    const polyline = resolveRouteEditPath(document, resolver, route);
    return polyline ? [{ route, polyline }] : [];
  });
  return document.annotations.flatMap((annotation) => {
    const annotationAnchor = annotation.anchor;
    if (
      (annotation.kind !== "net-label" && annotation.kind !== "power-label") ||
      annotationAnchor.kind !== "route"
    ) {
      return [];
    }
    const closest = polylines
      .filter(({ route }) => route.id === annotationAnchor.routeId)
      .flatMap(({ route, polyline }) => {
        const anchor = closestRouteAnchor(
          polyline.points,
          annotationAnchor.fallbackPosition,
        );
        return anchor
          ? [
              {
                ...anchor,
                annotationId: annotation.id,
                routeId: route.id,
                segmentCount: polyline.points.length - 1,
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.routeId.localeCompare(right.routeId, "en"),
      )[0];
    if (!closest) return [];
    const { distanceSquared: _distanceSquared, ...anchor } = closest;
    return [anchor];
  });
}

export function captureRouteMarkerAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
): RouteMarkerAnchor[] {
  return document.annotations.flatMap((annotation) => {
    const attachment = routeMarkerAttachment(annotation);
    if (!attachment) return [];
    const route = document.routes.find(
      (candidate) => candidate.id === attachment.routeId,
    );
    if (!route) return [];
    const polyline = resolveRouteEditPath(document, resolver, route);
    if (!polyline) return [];
    const segmentIndex = route.legs.findIndex(
      (leg) => leg.id === attachment.legId,
    );
    if (segmentIndex < 0) return [];
    const from = polyline.points[segmentIndex];
    const to = polyline.points[segmentIndex + 1];
    const routeStart = polyline.points[0];
    const routeEnd = polyline.points.at(-1);
    if (!from || !to || !routeStart || !routeEnd) return [];
    return [
      {
        annotationId: annotation.id,
        routeId: route.id,
        segmentIndex,
        segmentCount: polyline.points.length - 1,
        t: attachment.t,
        position: {
          x: from.x + (to.x - from.x) * attachment.t,
          y: from.y + (to.y - from.y) * attachment.t,
        },
        direction: { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) },
        routeStart,
        routeEnd,
      },
    ];
  });
}

export function pointAtArcFraction(
  points: readonly Point[],
  fraction: number,
): { segmentIndex: number; t: number } | null {
  const lengths = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]!;
    return Math.hypot(to.x - from.x, to.y - from.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return null;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let traversed = 0;
  for (const [segmentIndex, length] of lengths.entries()) {
    if (length === 0) continue;
    if (traversed + length >= target || segmentIndex === lengths.length - 1) {
      return {
        segmentIndex,
        t: Math.max(0, Math.min(1, (target - traversed) / length)),
      };
    }
    traversed += length;
  }
  return null;
}
