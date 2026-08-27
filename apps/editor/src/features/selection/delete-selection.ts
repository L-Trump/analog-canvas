import {
  instanceOwnedAnnotationIds,
  planRoutingDeletion,
  planInstanceDeletion,
  proposeVisualRouteDeletion,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export interface VisualDeletionSelection {
  readonly instanceIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly junctionIds: readonly string[];
  readonly annotationIds: readonly string[];
  readonly draftingIds: readonly string[];
}

/**
 * Normalizes visual route deletion before edits are assembled. A selected
 * junction owns every route ending at it; a junction that becomes unused after
 * selected routes disappear is cleaned up in the same transaction. The fixed
 * point handles chains such as `junction → route → junction` without emitting
 * duplicate route or junction edits.
 */
export function collectVisualRouteDeletion(
  document: SchematicDocument,
  routeIds: readonly string[],
  junctionIds: readonly string[],
): { routeIds: string[]; junctionIds: string[] } {
  const proposal = proposeSelectionRouteDeletion(
    document,
    routeIds,
    junctionIds,
  );
  return { routeIds: proposal.routeIds, junctionIds: proposal.junctionIds };
}

/**
 * Route geometry is the authoritative deletion target whenever the visual
 * selection contains a Route. A marquee commonly includes the shared
 * Junction dot at a selected branch endpoint; treating that incidental dot as
 * an independent Junction deletion would expand into every sibling Route.
 * Junction-only deletion retains the explicit topology-vertex behavior.
 */
export function proposeSelectionRouteDeletion(
  document: SchematicDocument,
  routeIds: readonly string[],
  junctionIds: readonly string[],
) {
  return proposeVisualRouteDeletion(
    document,
    routeIds,
    routeIds.length > 0 ? [] : junctionIds,
  );
}

export function proposeConnectedInstanceDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  sequence: number,
): SchematicEdit[] {
  return planInstanceDeletion(document, resolver, instanceIds, sequence);
}

/**
 * One shared delete proposal for an arbitrary visual selection. Structural
 * workflows (such as Cell Pin removal) use this instead of falling
 * back to a separate Document transaction and changing deletion semantics.
 */
export function proposeVisualSelectionDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  selection: VisualDeletionSelection,
  sequence: number,
): SchematicEdit[] {
  return [
    ...planRoutingDeletion(document, resolver, selection, sequence).edits,
  ];
}

/**
 * `proposeConnectedInstanceDeletion()` removes every annotation owned by a
 * selected Instance, including an instance-bound free label. A marquee can
 * independently select that label, so callers must not append it twice.
 */
export function explicitAnnotationRemovals(
  document: SchematicDocument,
  instanceIds: readonly string[],
  annotationIds: readonly string[],
): string[] {
  const removedWithInstances = instanceOwnedAnnotationIds(
    document,
    instanceIds,
  );
  return [...new Set(annotationIds)].filter(
    (id) => !removedWithInstances.has(id),
  );
}
