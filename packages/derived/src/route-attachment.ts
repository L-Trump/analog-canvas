import type { Point, RouteAnnotationAttachment } from "@icm/model";

import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";

export interface ResolvedRouteAttachment {
  conductorPoint: Point;
  labelPoint: Point;
  rotation: 0 | 90 | 180 | 270;
}

/** Resolve a persisted route attachment against canonical route geometry. */
export function resolveRouteAttachment(
  geometry: ResolvedRouteGeometry,
  attachment: RouteAnnotationAttachment,
): ResolvedRouteAttachment | null {
  const segment = geometry.segments.find(
    (candidate) => candidate.address.legId === attachment.legId,
  );
  if (!segment) return null;
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const conductorPoint = {
    x: segment.from.x + dx * attachment.t,
    y: segment.from.y + dy * attachment.t,
  };
  const normal = { x: -dy / length, y: dx / length };
  const direction = attachment.direction === "forward" ? 1 : -1;
  const angle = Math.round(
    (Math.atan2(dy * direction, dx * direction) * 180) / Math.PI,
  );
  const rotation = ((angle % 360) + 360) % 360;
  if (
    rotation !== 0 &&
    rotation !== 90 &&
    rotation !== 180 &&
    rotation !== 270
  ) {
    return null;
  }
  return {
    conductorPoint,
    labelPoint: {
      x: conductorPoint.x + normal.x * attachment.normalOffset,
      y: conductorPoint.y + normal.y * attachment.normalOffset,
    },
    rotation,
  };
}
