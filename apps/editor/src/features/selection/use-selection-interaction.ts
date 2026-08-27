import {
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  clipboardPlacementAnchor,
  copyPlacementOrientationEdits,
  copySelection,
  proposePaste,
} from "../clipboard/clipboard";
import type { SchematicClipboard } from "../clipboard/clipboard";
import { endpointKey } from "@icm/derived";
import {
  createConnectivityProposal,
  executeTransaction,
  gateConnectivityProposal,
  proposeVisualRouteDeletion,
  proposeGroupMoveEdits,
  proposeGroupReflectionEdits,
  proposeGroupRotationEdits,
  type ConnectivityIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SnapGuideLine, SnapResult } from "../../snap/engine";

import type { InteractionState } from "../../interaction/interaction-state";
import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../../canvas/canvas-drag-visual";
import type { ScreenFlip } from "../../interaction/shortcut-orientation";
import {
  explicitAnnotationRemovals,
  proposeConnectedInstanceDeletion,
  proposeVisualSelectionDeletion,
} from "./delete-selection";
import type { VisualSelection } from "./visual-selection";
import {
  planSelectionMove,
  type SelectionMovePlan,
} from "./selection-move-plan";

type TransactionResult = { ok: boolean; revision: number };

interface ResolvedInstanceMove {
  snap: SnapResult;
  moves: { instanceId: string; position: Point }[];
}

interface MoveProjectionCache {
  screenPoint: Point;
  suppressSnap: boolean;
  tolerance: number;
  sourceRevision: number;
  resolved: ResolvedInstanceMove;
  document: SchematicDocument;
}

export interface InstanceMovePreview {
  instanceIds: string[];
  primaryInstanceId: string;
  originalPositions: Record<string, Point>;
  pointerStart: Point;
  movePlan: SelectionMovePlan;
}

interface CommandMoveSession {
  documentId: string;
  baseRevision: number;
  movePlan: SelectionMovePlan;
  instancePreview: InstanceMovePreview | null;
  pointerOrigin: Point;
  visual: ReturnType<typeof startCanvasDragVisual> | null;
  projectedDocument: SchematicDocument;
  prefixEdits: SchematicEdit[];
  latestPoint: Point | null;
  latestScreenPoint: Point | null;
  svg: SVGSVGElement | null;
  lastProjection: MoveProjectionCache | null;
  lastSnap?: SnapResult;
  lastDelta: Point;
}

export interface ProjectedInstanceMove {
  document: SchematicDocument;
  prefixEdits: readonly SchematicEdit[];
  resolvedMove?: ResolvedInstanceMove;
}

const isSameMoveProjectionInput = (
  cached: MoveProjectionCache | null,
  screenPoint: Point,
  suppressSnap: boolean,
  tolerance: number,
  sourceRevision: number,
): cached is MoveProjectionCache =>
  cached !== null &&
  // PointerEvent keeps sub-pixel coordinates while its following MouseEvent
  // rounds them to integers. Treat that browser precision loss as the same
  // physical input, but never reuse a projection for a genuinely new click.
  Math.abs(cached.screenPoint.x - screenPoint.x) < 1 &&
  Math.abs(cached.screenPoint.y - screenPoint.y) < 1 &&
  cached.suppressSnap === suppressSnap &&
  cached.tolerance === tolerance &&
  cached.sourceRevision === sourceRevision;

export interface UseSelectionInteractionOptions {
  document: SchematicDocument;
  resolver: SymbolResolver;
  visualSelection: VisualSelection;
  selectedIds: readonly string[];
  selectedRouteId: string | null;
  selectedAnnotationId: string | null;
  selectedDraftingId: string | null;
  selectedEndpoint: WireSource | null;
  selectedNoConnect: SchematicDocument["noConnects"][number] | undefined;
  selectedEndpointNetId: string | null;
  getInteractionState: () => InteractionState<SchematicClipboard>;
  transact: (
    edits: SchematicEdit[],
    options?: { preserveInteraction?: boolean },
  ) => TransactionResult;
  transactProjectDocument: (
    transactionId: string,
    edits: readonly SchematicEdit[],
  ) => TransactionResult;
  commitCellTerminalSelection: (
    terminalIds: readonly string[],
    documentEdits: readonly SchematicEdit[],
  ) => boolean;
  setStatus: (status: string) => void;
  setSelectedEndpoint: (endpoint: WireSource | null) => void;
  resetSelection: () => void;
  replaceSelectionKind: (
    kind: "instance" | "drafting",
    ids: readonly string[],
  ) => void;
  selectOnly: (kind: "instance", ids: readonly string[]) => void;
  deleteSelectedRouteConnection: () => void;
  deleteSelectedAnnotation: () => void;
  clearTransientCanvasState: () => void;
  cancelAllTransientInteraction: () => void;
  cancelInteraction: () => void;
  cancelCanvasDrag: () => void;
  paintSnapGuides: (guides: []) => void;
  beginCopyPlacementInteraction: (
    clipboard: SchematicClipboard,
    anchor: Point,
  ) => void;
  setCopyPreviewPoint: (point: Point) => void;
  nextUniqueSuffix: () => number;
  endpointTestId: (endpoint: WireSource["endpoint"]) => string;
  tool: string;
  canvasDragSessionRef: MutableRefObject<CanvasDragSession | null>;
  pointFromClient: (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid: false,
  ) => Point;
  completeVisualSelectionMove: (
    movePlan: SelectionMovePlan,
    delta: Point,
  ) => void;
  snapCoordinate: (value: number, grid: number) => number;
  updateInstanceSelection: (instanceId: string, additive: boolean) => void;
  suppressInstanceClickRef: MutableRefObject<boolean>;
  resolveInstanceMove: (
    preview: InstanceMovePreview,
    position: Point,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projectedDocument?: SchematicDocument,
  ) => { snap: SnapResult; moves: { instanceId: string; position: Point }[] };
  completeInstanceMove: (
    preview: InstanceMovePreview,
    position: Point,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
    projection?: ProjectedInstanceMove,
  ) => void;
  logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
  snapGuides: (guides: SnapGuideLine[]) => void;
  setProjectedMovePreview: (document: SchematicDocument | null) => void;
  beginSelectionMoveInteraction: () => void;
  visualMoveOrigin: (movePlan: SelectionMovePlan) => Point;
}

/**
 * Owns commands whose meaning is the current visual selection. Pointer move
 * orchestration is added here separately so the existing selection reducer
 * remains the sole source of selected object identities.
 */
export function useSelectionInteraction(
  options: UseSelectionInteractionOptions,
) {
  const copyCounter = useRef(0);
  const commandMoveSessionRef = useRef<CommandMoveSession | null>(null);
  const transactConnectivity = (
    intent: ConnectivityIntent,
    edits: readonly SchematicEdit[],
    preview?: unknown,
    options_: { preserveInteraction?: boolean } = {},
  ): TransactionResult => {
    const gate = gateConnectivityProposal(
      options.document,
      createConnectivityProposal(options.document, {
        intent,
        diagnostics: [],
        edits,
        ...(preview === undefined ? {} : { preview }),
      }),
    );
    if (!gate.ok) {
      options.setStatus(gate.message);
      return { ok: false, revision: options.document.revision };
    }
    return options.transact([...gate.edits], options_);
  };

  const projectedInstancePreview = (
    session: CommandMoveSession,
  ): InstanceMovePreview | null => {
    const primaryInstanceId = session.instancePreview?.primaryInstanceId;
    if (!primaryInstanceId) return null;
    const primary = session.projectedDocument.instances.find(
      (instance) => instance.id === primaryInstanceId,
    );
    if (!primary?.placement) return null;
    return {
      instanceIds: session.movePlan.instanceIds,
      primaryInstanceId,
      originalPositions: Object.fromEntries(
        session.movePlan.instanceIds.flatMap((instanceId) => {
          const placement = session.projectedDocument.instances.find(
            (instance) => instance.id === instanceId,
          )?.placement;
          return placement
            ? [[instanceId, { ...placement.position }] as const]
            : [];
        }),
      ),
      pointerStart: { ...primary.placement.position },
      movePlan: session.movePlan,
    };
  };

  const commandMoveTransformReason = (): string | null => {
    const session = commandMoveSessionRef.current;
    if (!session) return "Move is not active";
    if (
      session.documentId !== options.document.id ||
      session.baseRevision !== options.document.revision
    ) {
      return "The document changed; restart Move before transforming";
    }
    if (!session.instancePreview) {
      return "Rotate and mirror during Move require a component selection";
    }
    if (
      session.movePlan.looseRouteIds.length > 0 ||
      session.movePlan.freeAnnotationIds.length > 0 ||
      session.movePlan.draftingIds.length > 0
    ) {
      return "Rotate and mirror during Move require a component-and-wire closure";
    }
    return null;
  };

  const clearCommandMoveSession = (): void => {
    commandMoveSessionRef.current?.visual?.restore();
    commandMoveSessionRef.current = null;
    options.setProjectedMovePreview(null);
  };

  /**
   * The formal renderer is the sole semantic preview authority for Instance
   * movement. A dry-run applies exactly the same typed edits as commit, so
   * upright labels, Route markers, miter bridges, pin names and NoConnects are
   * all derived from one projected Document instead of ad-hoc DOM transforms.
   */
  const projectInstanceMove = (
    sourceDocument: SchematicDocument,
    moves: readonly { instanceId: string; position: Point }[],
  ): SchematicDocument => {
    const plan = proposeGroupMoveEdits(sourceDocument, options.resolver, moves);
    const result = executeTransaction(
      sourceDocument,
      {
        transactionId: "selection-move-semantic-preview",
        documentId: sourceDocument.id,
        expectedRevision: sourceDocument.revision,
        actor: { kind: "human", id: "selection-move-preview" },
        dryRun: true,
        edits: plan.edits,
      },
      { symbolResolver: options.resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.document;
  };

  const beginKeyboardSelectionMove = (): void => {
    if (commandMoveSessionRef.current) {
      options.setStatus(
        "Move is already active · click to place · Esc cancels",
      );
      return;
    }
    const movePlan = planSelectionMove(
      options.document,
      options.visualSelection,
    );
    if (movePlan.previewObjectIds.length === 0) {
      options.setStatus(
        "Selected objects are attached or locked and cannot move",
      );
      return;
    }
    const primaryInstanceId =
      options.selectedIds.at(-1) ?? movePlan.instanceIds.at(0) ?? null;
    const primary = primaryInstanceId
      ? options.document.instances.find((item) => item.id === primaryInstanceId)
      : undefined;
    const instancePreview = primary?.placement
      ? {
          instanceIds: movePlan.instanceIds,
          primaryInstanceId: primaryInstanceId!,
          originalPositions: Object.fromEntries(
            movePlan.instanceIds.flatMap((id) => {
              const item = options.document.instances.find(
                (candidate) => candidate.id === id,
              );
              return item?.placement
                ? [[id, { ...item.placement.position }] as const]
                : [];
            }),
          ),
          pointerStart: { ...primary.placement.position },
          movePlan,
        }
      : null;
    commandMoveSessionRef.current = {
      documentId: options.document.id,
      baseRevision: options.document.revision,
      movePlan,
      instancePreview,
      pointerOrigin: instancePreview
        ? instancePreview.pointerStart
        : options.visualMoveOrigin(movePlan),
      visual: null,
      projectedDocument: structuredClone(options.document),
      prefixEdits: [],
      latestPoint: null,
      latestScreenPoint: null,
      svg: null,
      lastProjection: null,
      lastDelta: { x: 0, y: 0 },
    };
    options.setProjectedMovePreview(null);
    options.beginSelectionMoveInteraction();
    options.setStatus(
      "Move: move the pointer, then click to place (Esc to cancel)",
    );
  };

  const updateCommandMovePreview = (
    point: Point,
    screenPoint: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
  ): boolean => {
    const session = commandMoveSessionRef.current;
    if (!session || session.documentId !== options.document.id) return false;
    if (session.baseRevision !== options.document.revision) {
      clearCommandMoveSession();
      options.snapGuides([]);
      options.cancelInteraction();
      options.setStatus("Move cancelled because the document changed");
      return false;
    }
    session.latestPoint = point;
    session.latestScreenPoint = screenPoint;
    session.svg = svg;
    if (session.instancePreview) {
      const tolerance = options.logicalRadiusForPixels(svg, 7);
      const cached = isSameMoveProjectionInput(
        session.lastProjection,
        screenPoint,
        suppressSnap,
        tolerance,
        session.projectedDocument.revision,
      )
        ? session.lastProjection
        : null;
      const resolved =
        cached?.resolved ??
        options.resolveInstanceMove(
          session.instancePreview,
          point,
          tolerance,
          suppressSnap,
          session.lastSnap,
          session.projectedDocument,
        );
      session.lastSnap = resolved.snap;
      const primary = resolved.moves.find(
        (move) =>
          move.instanceId === session.instancePreview!.primaryInstanceId,
      );
      const original =
        session.instancePreview.originalPositions[
          session.instancePreview.primaryInstanceId
        ];
      if (!primary || !original) return false;
      session.lastDelta = {
        x: primary.position.x - original.x,
        y: primary.position.y - original.y,
      };
      options.snapGuides(resolved.snap.guides);
      try {
        const projectedDocument =
          cached?.document ??
          projectInstanceMove(session.projectedDocument, resolved.moves);
        session.lastProjection = {
          screenPoint: { ...screenPoint },
          suppressSnap,
          tolerance,
          sourceRevision: session.projectedDocument.revision,
          resolved,
          document: projectedDocument,
        };
        options.setProjectedMovePreview(projectedDocument);
      } catch (error) {
        session.lastProjection = null;
        options.setProjectedMovePreview(null);
        options.setStatus(
          error instanceof Error ? error.message : "Move preview failed",
        );
        return false;
      }
      return true;
    }

    session.lastDelta = {
      x: options.snapCoordinate(
        point.x - session.pointerOrigin.x,
        options.document.presentation.grid,
      ),
      y: options.snapCoordinate(
        point.y - session.pointerOrigin.y,
        options.document.presentation.grid,
      ),
    };
    options.setProjectedMovePreview(null);
    options.snapGuides([]);
    session.visual ??= startCanvasDragVisual(
      svg,
      session.movePlan.previewObjectIds,
    );
    session.visual.translate(session.lastDelta);
    return true;
  };

  const transformCommandMove = (
    transform:
      | { kind: "rotate"; deltaDegrees: 90 | -90 }
      | { kind: "mirror"; direction: ScreenFlip },
  ): boolean => {
    const reason = commandMoveTransformReason();
    if (reason) {
      options.setStatus(reason);
      return false;
    }
    const session = commandMoveSessionRef.current!;
    try {
      const plan =
        transform.kind === "rotate"
          ? proposeGroupRotationEdits(
              session.projectedDocument,
              options.resolver,
              session.movePlan.instanceIds,
              transform.deltaDegrees,
            )
          : proposeGroupReflectionEdits(
              session.projectedDocument,
              options.resolver,
              session.movePlan.instanceIds,
              transform.direction,
            );
      const result = executeTransaction(
        session.projectedDocument,
        {
          transactionId: "selection-move-orientation-preview",
          documentId: session.projectedDocument.id,
          expectedRevision: session.projectedDocument.revision,
          actor: { kind: "human", id: "selection-move-preview" },
          dryRun: true,
          edits: plan.edits,
        },
        { symbolResolver: options.resolver },
      );
      if (!result.ok) {
        options.setStatus(
          result.diagnostics[0]?.message ?? "Move transform was rejected",
        );
        return false;
      }
      session.projectedDocument = result.document;
      session.prefixEdits.push(...plan.edits);
      session.instancePreview = projectedInstancePreview(session);
      session.lastProjection = null;
      delete session.lastSnap;
      if (session.latestPoint && session.latestScreenPoint && session.svg) {
        if (
          !updateCommandMovePreview(
            session.latestPoint,
            session.latestScreenPoint,
            session.svg,
            false,
          )
        ) {
          return false;
        }
      } else {
        options.setProjectedMovePreview(session.projectedDocument);
      }
      options.setStatus(
        transform.kind === "rotate"
          ? "Move preview rotated · click to place · Esc cancels"
          : `Move preview mirrored ${
              transform.direction === "left-right" ? "left/right" : "top/bottom"
            } · click to place · Esc cancels`,
      );
      return true;
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Move transform failed",
      );
      return false;
    }
  };

  const commitCommandMove = (
    point: Point,
    screenPoint: Point,
    svg: SVGSVGElement,
  ): void => {
    if (!commandMoveSessionRef.current) return;
    // Click intent is authoritative. Re-resolve a genuinely new click against
    // the projected orientation Document; only the same physical pointer spot
    // may reuse preview because click events discard pointer sub-pixels.
    if (!updateCommandMovePreview(point, screenPoint, svg, false)) return;
    const session = commandMoveSessionRef.current!;
    session.visual?.restore();
    commandMoveSessionRef.current = null;
    options.setProjectedMovePreview(null);
    if (session.instancePreview) {
      const resolvedMove = session.lastProjection?.resolved;
      if (!resolvedMove) {
        options.setStatus("Move could not resolve the clicked position");
        options.snapGuides([]);
        options.cancelInteraction();
        return;
      }
      options.completeInstanceMove(
        session.instancePreview,
        point,
        options.logicalRadiusForPixels(svg, 7),
        false,
        session.lastSnap,
        {
          document: session.projectedDocument,
          prefixEdits: session.prefixEdits,
          resolvedMove,
        },
      );
    } else {
      options.completeVisualSelectionMove(session.movePlan, session.lastDelta);
    }
    options.snapGuides([]);
    options.cancelInteraction();
  };

  const selectInstance = (instanceId: string, additive: boolean): void => {
    options.setSelectedEndpoint(null);
    options.updateInstanceSelection(instanceId, additive);
  };

  const beginMove = (
    event: ReactPointerEvent<SVGElement>,
    instanceId: string,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (options.tool !== "pointer" || event.button !== 0) return;
    if (options.getInteractionState().kind === "moving-selection") {
      options.cancelInteraction();
    }
    event.stopPropagation();
    const instance = options.document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) return;
    const hasSelectionModifier =
      event.shiftKey || event.ctrlKey || event.metaKey;
    options.suppressInstanceClickRef.current =
      hitTarget.getAttribute("data-canvas-hit-kind") === "instance";
    if (hasSelectionModifier) {
      selectInstance(instanceId, true);
      options.setStatus(`Selected ${instanceId}`);
      return;
    }
    const movingSelection: VisualSelection = options.selectedIds.includes(
      instanceId,
    )
      ? options.visualSelection
      : {
          instanceIds: [instanceId],
          routeIds: [],
          junctionIds: [],
          annotationIds: [],
          draftingIds: [],
        };
    const movePlan = planSelectionMove(options.document, movingSelection);
    const movingIds = movePlan.instanceIds;
    if (!options.selectedIds.includes(instanceId))
      selectInstance(instanceId, false);
    if (movingIds.length === 0) return;
    options.canvasDragSessionRef.current?.cancel();
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const pointerStart = options.pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    const preview: InstanceMovePreview = {
      instanceIds: movingIds,
      primaryInstanceId: instanceId,
      originalPositions: Object.fromEntries(
        movingIds.map((id) => {
          const candidate = options.document.instances.find(
            (item) => item.id === id,
          )!;
          return [id, { ...candidate.placement!.position }];
        }),
      ),
      pointerStart,
      movePlan,
    };
    options.setProjectedMovePreview(null);
    const tolerance = options.logicalRadiusForPixels(svg, 7);
    let lastSnap: SnapResult | undefined;
    let lastProjection: MoveProjectionCache | null = null;
    const resolveProjection = (
      point: Point,
      screenPoint: Point,
      suppressSnap: boolean,
    ): MoveProjectionCache => {
      if (
        isSameMoveProjectionInput(
          lastProjection,
          screenPoint,
          suppressSnap,
          tolerance,
          options.document.revision,
        )
      ) {
        return lastProjection;
      }
      const resolved = options.resolveInstanceMove(
        preview,
        point,
        tolerance,
        suppressSnap,
        lastSnap,
      );
      const document = projectInstanceMove(options.document, resolved.moves);
      lastSnap = resolved.snap;
      lastProjection = {
        screenPoint: { ...screenPoint },
        suppressSnap,
        tolerance,
        sourceRevision: options.document.revision,
        resolved,
        document,
      };
      return lastProjection;
    };
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        try {
          const projection = resolveProjection(
            options.pointFromClient(client.x, client.y, svg, false),
            { x: client.x, y: client.y },
            Boolean(client.altKey),
          );
          options.snapGuides(projection.resolved.snap.guides);
          options.setProjectedMovePreview(projection.document);
        } catch (error) {
          lastProjection = null;
          options.setProjectedMovePreview(null);
          options.setStatus(
            error instanceof Error ? error.message : "Move preview failed",
          );
        }
      },
      onFinish: ({ client, dragged }) => {
        options.canvasDragSessionRef.current = null;
        options.setProjectedMovePreview(null);
        options.snapGuides([]);
        if (dragged) {
          const point = options.pointFromClient(client.x, client.y, svg, false);
          const suppressSnap = Boolean(client.altKey);
          let projection: MoveProjectionCache;
          try {
            projection = resolveProjection(
              point,
              { x: client.x, y: client.y },
              suppressSnap,
            );
          } catch (error) {
            options.setStatus(
              error instanceof Error ? error.message : "Move failed",
            );
            return;
          }
          options.completeInstanceMove(
            preview,
            point,
            tolerance,
            suppressSnap,
            projection.resolved.snap,
            {
              document: options.document,
              prefixEdits: [],
              resolvedMove: projection.resolved,
            },
          );
        }
      },
      onCancel: () => {
        options.canvasDragSessionRef.current = null;
        options.setProjectedMovePreview(null);
        options.snapGuides([]);
      },
    });
  };

  const beginVisualSelectionMove = (
    event: ReactPointerEvent<SVGElement>,
    selection: VisualSelection,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (options.tool !== "pointer" || event.button !== 0) return;
    const movePlan = planSelectionMove(options.document, selection);
    if (movePlan.previewObjectIds.length === 0) {
      options.cancelInteraction();
      options.setStatus(
        "Selected objects are attached or locked and cannot move",
      );
      return;
    }
    options.cancelInteraction();
    event.preventDefault();
    event.stopPropagation();
    options.canvasDragSessionRef.current?.cancel();
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const start = options.pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, movePlan.previewObjectIds));
    const deltaAt = (client: Point): Point => {
      const point = options.pointFromClient(client.x, client.y, svg, false);
      return {
        x: options.snapCoordinate(
          point.x - start.x,
          options.document.presentation.grid,
        ),
        y: options.snapCoordinate(
          point.y - start.y,
          options.document.presentation.grid,
        ),
      };
    };
    options.canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: 4,
      onPreview: (client) => {
        dragVisual().translate(deltaAt(client));
        options.paintSnapGuides([]);
      },
      onFinish: ({ client, dragged }) => {
        options.canvasDragSessionRef.current = null;
        visual?.restore();
        options.paintSnapGuides([]);
        if (dragged) {
          options.completeVisualSelectionMove(movePlan, deltaAt(client));
        }
      },
      onCancel: () => {
        options.canvasDragSessionRef.current = null;
        visual?.restore();
        options.paintSnapGuides([]);
      },
    });
  };

  const deleteSelectedJunction = (): void => {
    if (options.selectedEndpoint?.endpoint.kind !== "junction") return;
    const junctionId = options.selectedEndpoint.endpoint.junctionId;
    const proposal = proposeVisualRouteDeletion(
      options.document,
      [],
      [junctionId],
    );
    const result = transactConnectivity(
      "remove_wire_geometry",
      proposal.edits,
      proposal,
    );
    if (result.ok) {
      options.setSelectedEndpoint(null);
      options.setStatus(
        `Deleted junction and ${proposal.routeIds.length} attached routes`,
      );
    }
  };

  const toggleSelectedNoConnect = (): void => {
    const endpoint = options.selectedEndpoint?.endpoint;
    if (!endpoint || endpoint.kind === "junction") return;
    if (options.selectedNoConnect) {
      const result = transactConnectivity("add_or_remove_no_connect", [
        {
          kind: "remove_no_connect",
          noConnectId: options.selectedNoConnect.id,
        },
      ]);
      if (result.ok) {
        options.setStatus(
          `Cleared No Connect on ${options.endpointTestId(endpoint)}`,
        );
      }
      return;
    }
    if (options.selectedEndpointNetId) {
      options.setStatus(
        "Disconnect this endpoint before marking it No Connect",
      );
      return;
    }
    const result = transactConnectivity("add_or_remove_no_connect", [
      {
        kind: "add_no_connect",
        noConnect: { id: nextNoConnectId(), endpoint },
      },
    ]);
    if (result.ok) {
      options.setStatus(
        `Marked ${options.endpointTestId(endpoint)} No Connect`,
      );
    }
  };

  const nextNoConnectId = (): string => {
    const occupied = new Set([
      ...options.document.instances.map((instance) => instance.id),
      ...options.document.nets.map((net) => net.id),
      ...options.document.routes.map((route) => route.id),
      ...options.document.junctions.map((junction) => junction.id),
      ...options.document.noConnects.map((noConnect) => noConnect.id),
      ...options.document.annotations.map((annotation) => annotation.id),
      ...options.document.layoutGroups.map((group) => group.id),
      ...options.document.constraints.map((constraint) => constraint.id),
      ...(options.document.drafting?.objects ?? []).map((object) => object.id),
    ]);
    let id: string;
    do {
      id = `no-connect-ui-${options.nextUniqueSuffix()}`;
    } while (occupied.has(id));
    return id;
  };

  const disconnectSelectedEndpoint = (removeRoutes: boolean): void => {
    const endpoint = options.selectedEndpoint?.endpoint;
    if (!endpoint || endpoint.kind === "junction") return;
    const routeEdits = removeRoutes
      ? options.document.routes
          .filter((route) =>
            routeEndpoints(route).some(
              (candidate) => endpointKey(candidate) === endpointKey(endpoint),
            ),
          )
          .map((route): SchematicEdit => ({
            kind: "remove_route_geometry",
            routeId: route.id,
          }))
      : [];
    const result = transactConnectivity(
      "disconnect_endpoint",
      [...routeEdits, { kind: "disconnect_endpoint", endpoint }],
      { removeRoutes },
    );
    if (result.ok) {
      options.setSelectedEndpoint(null);
      options.setStatus(
        removeRoutes ? "Deleted endpoint connection" : "Disconnected endpoint",
      );
    }
  };

  const deleteSelection = (): void => {
    const formalTerminals = (options.document.netlist?.terminals ?? []).filter(
      (terminal) =>
        terminal.interfaceInstanceIds.some((instanceId) =>
          options.visualSelection.instanceIds.includes(instanceId),
        ),
    );
    if (formalTerminals.length > 0) {
      try {
        const deletionEdits = proposeVisualSelectionDeletion(
          options.document,
          options.resolver,
          options.visualSelection,
          options.nextUniqueSuffix(),
        );
        if (
          options.commitCellTerminalSelection(
            formalTerminals.map((terminal) => terminal.id),
            deletionEdits,
          )
        ) {
          options.resetSelection();
          options.setSelectedEndpoint(null);
          options.setStatus("Deleted selected schematic objects");
        }
      } catch (error) {
        options.setStatus(
          error instanceof Error ? error.message : "Delete failed",
        );
      }
      return;
    }
    const initialRouteIds = new Set(options.visualSelection.routeIds);
    const selectedAnnotationIds = new Set(
      options.visualSelection.annotationIds,
    );
    const selectedDraftingIds = new Set(options.visualSelection.draftingIds);
    const selectedJunctionIds = new Set([
      ...options.visualSelection.junctionIds,
      ...(options.selectedEndpoint?.endpoint.kind === "junction"
        ? [options.selectedEndpoint.endpoint.junctionId]
        : []),
    ]);
    const hasMixedSelection =
      initialRouteIds.size > 0 ||
      selectedAnnotationIds.size > 0 ||
      selectedDraftingIds.size > 0 ||
      selectedJunctionIds.size > 0;
    if (
      initialRouteIds.size === 1 &&
      selectedAnnotationIds.size === 0 &&
      selectedDraftingIds.size === 0 &&
      selectedJunctionIds.size === 0 &&
      options.selectedIds.length === 0
    ) {
      options.deleteSelectedRouteConnection();
      return;
    }
    if (hasMixedSelection) {
      const visualRouteDeletion = proposeVisualRouteDeletion(
        options.document,
        [...initialRouteIds],
        [...selectedJunctionIds],
        { instanceIdsScheduledForDeletion: options.selectedIds },
      );
      try {
        const instanceEdits =
          options.selectedIds.length > 0
            ? proposeConnectedInstanceDeletion(
                options.document,
                options.resolver,
                options.selectedIds,
                options.nextUniqueSuffix(),
              )
            : [];
        const explicitAnnotationIds = explicitAnnotationRemovals(
          options.document,
          options.selectedIds,
          [...selectedAnnotationIds].filter(
            (annotationId) =>
              !visualRouteDeletion.annotationIds.includes(annotationId),
          ),
        );
        const result = transactConnectivity(
          "delete_connection_intent",
          [
            ...instanceEdits,
            ...visualRouteDeletion.edits,
            ...explicitAnnotationIds.map((annotationId): SchematicEdit => ({
              kind: "remove_schematic_annotation",
              annotationId,
            })),
            ...[...selectedDraftingIds].map((objectId): SchematicEdit => ({
              kind: "remove_drafting_object",
              objectId,
            })),
          ],
          visualRouteDeletion,
        );
        if (result.ok) {
          options.resetSelection();
          options.setSelectedEndpoint(null);
          options.setStatus("Deleted selected schematic objects");
        }
      } catch (error) {
        options.setStatus(
          error instanceof Error ? error.message : "Delete failed",
        );
      }
      return;
    }
    if (options.selectedEndpoint?.endpoint.kind === "junction") {
      deleteSelectedJunction();
      return;
    }
    if (options.selectedAnnotationId) {
      options.deleteSelectedAnnotation();
      return;
    }
    if (options.selectedDraftingId) {
      const result = options.transact([
        {
          kind: "remove_drafting_object",
          objectId: options.selectedDraftingId,
        },
      ]);
      if (result.ok) {
        options.replaceSelectionKind("drafting", []);
        options.setStatus(
          `Deleted drafting object ${options.selectedDraftingId}`,
        );
      }
      return;
    }
    if (options.selectedRouteId) {
      options.deleteSelectedRouteConnection();
      return;
    }
    if (options.selectedIds.length === 0) return;
    try {
      const deletion = proposeConnectedInstanceDeletion(
        options.document,
        options.resolver,
        options.selectedIds,
        options.nextUniqueSuffix(),
      );
      const result = transactConnectivity("delete_connection_intent", deletion);
      if (result.ok) {
        options.replaceSelectionKind("instance", []);
        options.setStatus(
          "Deleted component selection; connected wires remain dangling",
        );
      }
    } catch (error) {
      options.setStatus(
        error instanceof Error ? error.message : "Delete failed",
      );
    }
  };

  const beginCopyPlacement = (): void => {
    const interactionKind = options.getInteractionState().kind;
    if (interactionKind === "copy-placement") {
      options.setStatus("Copy placement is already active · Esc cancels");
      return;
    }
    if (interactionKind !== "idle") {
      options.setStatus("Finish or cancel the active tool before copying");
      return;
    }
    const copied = copySelection(options.document, options.selectedIds);
    if (!copied) {
      options.setStatus("Select at least one component to copy");
      return;
    }
    const anchor = clipboardPlacementAnchor(copied);
    if (!anchor) {
      options.setStatus("Selected components have no placeable origin");
      return;
    }
    options.cancelCanvasDrag();
    options.clearTransientCanvasState();
    options.paintSnapGuides([]);
    options.beginCopyPlacementInteraction(copied, anchor);
    options.setStatus(
      `Place copy of ${copied.instances.length} components · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
    );
  };

  const commitCopyPlacement = (point: Point): void => {
    const interaction = options.getInteractionState();
    if (interaction.kind !== "copy-placement") return;
    const copyPlacement = interaction.copy;
    copyCounter.current += 1;
    const proposal = proposePaste(
      options.document,
      copyPlacement.clipboard,
      {
        x: point.x - copyPlacement.anchor.x,
        y: point.y - copyPlacement.anchor.y,
      },
      copyCounter.current,
    );
    if (proposal.errors.length > 0) {
      copyCounter.current -= 1;
      options.setStatus(proposal.errors[0]!);
      options.cancelAllTransientInteraction();
      return;
    }
    const orientationEdits = copyPlacementOrientationEdits(
      copyPlacement.clipboard.instances,
      proposal.instanceIds,
      copyPlacement.orientationOperations,
    );
    const edits = [...proposal.edits, ...orientationEdits];
    const editsCellInterface = edits.some(
      (edit) =>
        edit.kind === "add_cell_terminal" ||
        edit.kind === "update_cell_terminal",
    );
    let result: TransactionResult;
    if (editsCellInterface) {
      const gate = gateConnectivityProposal(
        options.document,
        createConnectivityProposal(options.document, {
          intent: "connect_without_wire",
          diagnostics: [],
          edits,
          preview: proposal,
        }),
      );
      if (!gate.ok) {
        options.setStatus(gate.message);
        result = { ok: false, revision: options.document.revision };
      } else {
        result = options.transactProjectDocument("copy-cell-pin", gate.edits);
      }
    } else {
      result = transactConnectivity("connect_without_wire", edits, proposal, {
        preserveInteraction: true,
      });
    }
    if (result.ok) {
      options.selectOnly("instance", proposal.instanceIds);
      options.setCopyPreviewPoint(point);
      options.setStatus(
        `Copied ${proposal.instanceIds.length} components · click to place another · Esc exits`,
      );
    }
  };

  return {
    beginCopyPlacement,
    beginKeyboardSelectionMove,
    beginMove,
    beginVisualSelectionMove,
    commitCopyPlacement,
    commitCommandMove,
    clearCommandMoveSession,
    deleteSelectedJunction,
    deleteSelection,
    toggleSelectedNoConnect,
    disconnectSelectedEndpoint,
    updateCommandMovePreview,
    canBeginKeyboardSelectionMove: () =>
      planSelectionMove(options.document, options.visualSelection)
        .previewObjectIds.length > 0,
    canTransformCommandMove: () => commandMoveTransformReason() === null,
    rotateCommandMove: (deltaDegrees: 90 | -90) =>
      transformCommandMove({ kind: "rotate", deltaDegrees }),
    mirrorCommandMove: (direction: ScreenFlip) =>
      transformCommandMove({ kind: "mirror", direction }),
    selectInstance,
  };
}
