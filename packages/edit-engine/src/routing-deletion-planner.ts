import {
  deriveRoutingAffectedClosure,
  type RoutingSelectionSeed,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  instanceOwnedAnnotationIds,
  planInstanceDeletion,
} from "./instance-lifecycle.js";
import {
  createRoutingOperationPlan,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import { proposeVisualRouteDeletion } from "./routing-planner.js";
import type { SchematicEdit } from "./edit-schema.js";

export interface RoutingDeletionSeed extends RoutingSelectionSeed {
  readonly draftingIds?: readonly string[];
}

/**
 * Plan one graph deletion. Route selection dominates incidental marquee
 * Junction dots; Junction-only selection owns its incident arms. Instance,
 * Route, attachment, layout-reference and drafting cleanup are committed as
 * one atomic operation without a second orphan-cleanup gesture.
 */
export function planRoutingDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingDeletionSeed,
  sequence: number,
): RoutingOperationPlan {
  const affected = deriveRoutingAffectedClosure(document, seed);
  const selectedInstances = new Set(affected.instances);
  const routeDeletion = proposeVisualRouteDeletion(
    document,
    seed.routeIds,
    seed.routeIds.length > 0 ? [] : seed.junctionIds,
    { instanceIdsScheduledForDeletion: affected.instances },
  );
  const instanceEdits =
    affected.instances.length > 0
      ? planInstanceDeletion(document, resolver, affected.instances, sequence)
      : [];
  const removedWithInstances = instanceOwnedAnnotationIds(
    document,
    selectedInstances,
  );
  const routeAnnotationIds = new Set(routeDeletion.annotationIds);
  const explicitAnnotationIds = [...new Set(seed.annotationIds ?? [])].filter(
    (annotationId) =>
      document.annotations.some(
        (annotation) => annotation.id === annotationId,
      ) &&
      !removedWithInstances.has(annotationId) &&
      !routeAnnotationIds.has(annotationId),
  );
  const draftingIds = [...new Set(seed.draftingIds ?? [])].filter((objectId) =>
    document.drafting?.objects.some((object) => object.id === objectId),
  );
  const edits: SchematicEdit[] = [
    ...instanceEdits,
    ...routeDeletion.edits,
    ...explicitAnnotationIds.map((annotationId): SchematicEdit => ({
      kind: "remove_schematic_annotation",
      annotationId,
    })),
    ...draftingIds.map((objectId): SchematicEdit => ({
      kind: "remove_drafting_object",
      objectId,
    })),
  ];
  const sourceBaseNetIds = [
    ...new Set(
      routeDeletion.routeIds.flatMap((routeId) => {
        const route = document.routes.find((item) => item.id === routeId);
        return route ? [route.netId] : [];
      }),
    ),
  ].sort((left, right) => left.localeCompare(right, "en"));

  return createRoutingOperationPlan(document, {
    intent: "delete",
    affected,
    ...(affected.instances.length === 0 && routeDeletion.routeIds.length > 0
      ? {
          expectedElectricalEffect: {
            kind: "partition" as const,
            sourceBaseNetIds,
            cutRouteIds: routeDeletion.routeIds,
          },
        }
      : {}),
    edits,
    diagnostics:
      edits.length > 0
        ? []
        : [
            {
              code: "ROUTING_DELETE_EMPTY",
              severity: "error",
              message: "The selection contains no deletable schematic objects",
            },
          ],
  });
}
