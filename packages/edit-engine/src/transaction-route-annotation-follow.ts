import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveRouteEditPath } from "./route-operations.js";
import {
  closestRouteMarkerAnchor,
  pointAtArcFraction,
  type NetLabelRouteAnchor,
  type RouteMarkerAnchor,
} from "./transaction-route-annotations.js";
import { snapPointToDocumentGrid } from "./transaction-preflight.js";

export function followNetLabelsOnChangedRoutes(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly NetLabelRouteAnchor[],
  changedRouteIds: ReadonlySet<string>,
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    if (
      !changedRouteIds.has(captured.routeId) ||
      changedObjectIds.has(captured.annotationId)
    ) {
      continue;
    }
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    const route = draft.routes.find(
      (candidate) => candidate.id === captured.routeId,
    );
    if (!annotation || annotation.kind !== "net-label" || !route) continue;
    const polyline = resolveRouteEditPath(draft, resolver, route);
    if (!polyline) continue;
    const segmentCount = polyline.points.length - 1;
    const attachment =
      segmentCount === captured.segmentCount &&
      captured.segmentIndex < segmentCount
        ? { segmentIndex: captured.segmentIndex, t: captured.t }
        : pointAtArcFraction(polyline.points, captured.arcFraction);
    if (!attachment) continue;
    const from = polyline.points[attachment.segmentIndex]!;
    const to = polyline.points[attachment.segmentIndex + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const anchor = {
      x: from.x + dx * attachment.t,
      y: from.y + dy * attachment.t,
    };
    const normal = { x: -dy / length, y: dx / length };
    const offset = {
      x: normal.x * captured.normalOffset,
      y: normal.y * captured.normalOffset,
    };
    if (annotation.anchor.kind !== "route") continue;
    annotation.anchor = {
      ...annotation.anchor,
      legId: route.legs[attachment.segmentIndex]!.id,
      t: attachment.t,
      normalOffset: Math.round(offset.x * normal.x + offset.y * normal.y),
      fallbackPosition: snapPointToDocumentGrid(
        { x: anchor.x + offset.x, y: anchor.y + offset.y },
        draft.presentation.grid,
      ),
    };
    changedObjectIds.add(annotation.id);
  }
}

export function followRouteMarkersOnChangedRoutes(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly RouteMarkerAnchor[],
  changedRouteIds: ReadonlySet<string>,
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    if (
      !changedRouteIds.has(captured.routeId) ||
      changedObjectIds.has(captured.annotationId)
    ) {
      continue;
    }
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    const route = draft.routes.find(
      (candidate) => candidate.id === captured.routeId,
    );
    if (!annotation || annotation.kind !== "route-marker" || !route) continue;
    const polyline = resolveRouteEditPath(draft, resolver, route);
    if (!polyline) continue;
    const segmentCount = polyline.points.length - 1;
    let attachment =
      segmentCount === captured.segmentCount &&
      captured.segmentIndex < segmentCount
        ? { segmentIndex: captured.segmentIndex, t: captured.t }
        : null;
    if (!attachment) {
      const nextStart = polyline.points[0]!;
      const nextEnd = polyline.points.at(-1)!;
      const startDelta = {
        x: nextStart.x - captured.routeStart.x,
        y: nextStart.y - captured.routeStart.y,
      };
      const endDelta = {
        x: nextEnd.x - captured.routeEnd.x,
        y: nextEnd.y - captured.routeEnd.y,
      };
      const expectedPosition =
        startDelta.x === endDelta.x && startDelta.y === endDelta.y
          ? {
              x: captured.position.x + startDelta.x,
              y: captured.position.y + startDelta.y,
            }
          : captured.position;
      const closest = closestRouteMarkerAnchor(
        polyline.points,
        expectedPosition,
        captured.direction,
      );
      attachment = closest
        ? { segmentIndex: closest.segmentIndex, t: closest.t }
        : null;
    }
    if (!attachment) continue;
    const from = polyline.points[attachment.segmentIndex]!;
    const to = polyline.points[attachment.segmentIndex + 1]!;
    const position = snapPointToDocumentGrid(
      {
        x: from.x + (to.x - from.x) * attachment.t,
        y: from.y + (to.y - from.y) * attachment.t,
      },
      draft.presentation.grid,
    );
    if (annotation.anchor.kind === "route") {
      annotation.anchor = {
        ...annotation.anchor,
        legId: route.legs[attachment.segmentIndex]!.id,
        t: attachment.t,
        fallbackPosition: position,
      };
    }
    changedObjectIds.add(annotation.id);
  }
}

export function remapRouteMarkersAfterSplit(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly RouteMarkerAnchor[],
  splitRouteIds: readonly string[],
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    const closest = splitRouteIds
      .flatMap((routeId) => {
        const route = draft.routes.find(
          (candidate) => candidate.id === routeId,
        );
        const polyline = route
          ? resolveRouteEditPath(draft, resolver, route)
          : null;
        if (!route || !polyline) return [];
        const attachment = closestRouteMarkerAnchor(
          polyline.points,
          captured.position,
          captured.direction,
        );
        return attachment ? [{ route, polyline, attachment }] : [];
      })
      .sort(
        (left, right) =>
          left.attachment.distanceSquared - right.attachment.distanceSquared ||
          left.route.id.localeCompare(right.route.id, "en"),
      )[0];
    if (!closest) continue;
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    if (!annotation || annotation.kind !== "route-marker") continue;
    const { segmentIndex, t } = closest.attachment;
    const from = closest.polyline.points[segmentIndex]!;
    const to = closest.polyline.points[segmentIndex + 1]!;
    const position = snapPointToDocumentGrid(
      {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      },
      draft.presentation.grid,
    );
    if (annotation.anchor.kind === "route") {
      annotation.anchor = {
        ...annotation.anchor,
        routeId: closest.route.id,
        legId: closest.route.legs[segmentIndex]!.id,
        t,
        fallbackPosition: position,
      };
    }
    changedObjectIds.add(annotation.id);
  }
}
