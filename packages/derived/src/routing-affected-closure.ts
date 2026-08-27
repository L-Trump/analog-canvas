import { routeEnd } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";

import { deriveInternalGroupSelection } from "./routing-components.js";

export interface RoutingSelectionSeed {
  readonly instanceIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly junctionIds: readonly string[];
  readonly annotationIds?: readonly string[];
}

export interface RoutingAffectedClosure {
  readonly instances: readonly string[];
  readonly internalRoutes: readonly string[];
  readonly boundaryRoutes: readonly string[];
  readonly externalRoutes: readonly string[];
  readonly internalJunctions: readonly string[];
  readonly boundaryJunctions: readonly string[];
  readonly electricalAnnotationIds: readonly string[];
  readonly protectedObjectIds: readonly string[];
}

function stable(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function junctionDegree(
  document: SchematicDocument,
  junctionId: string,
): number {
  return document.routes.reduce((degree, route) => {
    const endpoints = [route.start, routeEnd(route)];
    return (
      degree +
      endpoints.filter(
        (endpoint) =>
          endpoint.kind === "junction" && endpoint.junctionId === junctionId,
      ).length
    );
  }, 0);
}

function isInside(
  endpoint: RouteEndpoint,
  instanceIds: ReadonlySet<string>,
  junctionIds: ReadonlySet<string>,
): boolean {
  return endpoint.kind === "terminal"
    ? instanceIds.has(endpoint.instanceId)
    : junctionIds.has(endpoint.junctionId);
}

/**
 * Derive the electrical closure of one visual selection without inspecting
 * pointer geometry. A marquee may seed stable object IDs, but a Route merely
 * passing through it never becomes selected by this read model.
 */
export function deriveRoutingAffectedClosure(
  document: SchematicDocument,
  seed: RoutingSelectionSeed,
): RoutingAffectedClosure {
  const knownInstances = new Set(document.instances.map((item) => item.id));
  const knownJunctions = new Set(document.junctions.map((item) => item.id));
  const knownRoutes = new Set(document.routes.map((item) => item.id));
  const instances = stable(
    seed.instanceIds.filter((id) => knownInstances.has(id)),
  );
  const instanceIds = new Set(instances);
  const internal = deriveInternalGroupSelection(document, instances);
  const internalRouteIds = new Set(internal.routeIds);
  const internalJunctionIds = new Set(internal.junctionIds);

  for (const junctionId of seed.junctionIds) {
    if (knownJunctions.has(junctionId)) internalJunctionIds.add(junctionId);
  }

  // A selected isolated Wire owns both degree-one route-anchor Junctions.
  // Other selected Routes remain physical geometry, not an implicit request
  // to absorb their external electrical neighbourhood into the selection.
  for (const routeId of seed.routeIds) {
    if (!knownRoutes.has(routeId) || internalRouteIds.has(routeId)) continue;
    const route = document.routes.find((item) => item.id === routeId)!;
    const end = routeEnd(route);
    if (
      route.start.kind === "junction" &&
      end.kind === "junction" &&
      junctionDegree(document, route.start.junctionId) === 1 &&
      junctionDegree(document, end.junctionId) === 1
    ) {
      internalRouteIds.add(route.id);
      internalJunctionIds.add(route.start.junctionId);
      internalJunctionIds.add(end.junctionId);
    }
  }

  const boundaryRouteIds = new Set<string>();
  const externalRouteIds = new Set<string>();
  const boundaryJunctionIds = new Set<string>();
  for (const route of document.routes) {
    if (internalRouteIds.has(route.id)) continue;
    const end = routeEnd(route);
    const startInside = isInside(route.start, instanceIds, internalJunctionIds);
    const endInside = isInside(end, instanceIds, internalJunctionIds);
    if (startInside !== endInside) {
      boundaryRouteIds.add(route.id);
      for (const endpoint of [route.start, end]) {
        if (
          endpoint.kind === "junction" &&
          !internalJunctionIds.has(endpoint.junctionId)
        ) {
          boundaryJunctionIds.add(endpoint.junctionId);
        }
      }
    } else {
      externalRouteIds.add(route.id);
    }
  }

  const explicitlySelectedAnnotations = new Set(seed.annotationIds ?? []);
  const electricalAnnotationIds = stable(
    document.annotations.flatMap((annotation) => {
      const electricalKind =
        annotation.kind === "net-label" ||
        annotation.kind === "power-label" ||
        annotation.kind === "route-marker";
      const followsObject =
        annotation.anchor.kind === "object" &&
        (instanceIds.has(annotation.anchor.objectId) ||
          internalJunctionIds.has(annotation.anchor.objectId));
      const followsRoute =
        annotation.anchor.kind === "route" &&
        internalRouteIds.has(annotation.anchor.routeId);
      return electricalKind &&
        (followsObject ||
          followsRoute ||
          explicitlySelectedAnnotations.has(annotation.id))
        ? [annotation.id]
        : [];
    }),
  );

  const protectedObjectIds = new Set<string>();
  for (const route of document.routes) {
    if (
      route.legs.some((leg) => leg.mode === "locked" || leg.mode === "trunk")
    ) {
      protectedObjectIds.add(route.id);
    }
  }
  for (const annotation of document.annotations) {
    if (annotation.locked) protectedObjectIds.add(annotation.id);
  }
  for (const owner of [...document.layoutGroups, ...document.constraints]) {
    if (!owner.locked) continue;
    for (const objectId of owner.objectIds) protectedObjectIds.add(objectId);
  }

  return {
    instances,
    internalRoutes: stable(internalRouteIds),
    boundaryRoutes: stable(boundaryRouteIds),
    externalRoutes: stable(externalRouteIds),
    internalJunctions: stable(internalJunctionIds),
    boundaryJunctions: stable(boundaryJunctionIds),
    electricalAnnotationIds,
    protectedObjectIds: stable(protectedObjectIds),
  };
}
