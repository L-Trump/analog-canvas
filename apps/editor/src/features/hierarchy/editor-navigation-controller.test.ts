import { buildProjectConnectivityIndex } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import {
  createEditorNavigationController,
  type EditorNavigationControllerDependencies,
} from "./editor-navigation-controller";

function dependencies(
  selectedHighlightIsActive = false,
): EditorNavigationControllerDependencies {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances.push({ id: "R1", symbolId: "resistor", placement: null });
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  return {
    project,
    document,
    resolver,
    connectivityIndex: buildProjectConnectivityIndex(project, resolver),
    documentStack: [],
    setDocumentStack:
      vi.fn() as unknown as EditorNavigationControllerDependencies["setDocumentStack"],
    documentViewBoxes: { current: new Map() },
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    defaultViewBox: { x: 0, y: 0, width: 100, height: 100 },
    setViewBox: vi.fn(),
    openDocument: (documentId) =>
      project.documents.find((candidate) => candidate.id === documentId),
    resetInteractionState: vi.fn(),
    selectOnly: vi.fn(),
    setSelectedEndpoint: vi.fn(),
    setHighlightedNetOrigin: vi.fn(),
    selectedHighlightNetId: "net-a",
    selectedHighlightEndpoint: undefined,
    selectedHighlightIsActive,
    closeSearch: vi.fn(),
    setSelectionOpen: vi.fn(),
    setInstanceTableOpen: vi.fn(),
    setCellManagerOpen: vi.fn(),
    selectedInstance: undefined,
    setStatus: vi.fn(),
  };
}

describe("editor navigation controller", () => {
  it("owns search-result focus and closes the search session", () => {
    const input = dependencies();
    const controller = createEditorNavigationController(input);

    controller.selectSearchResult({
      locator: {
        documentId: input.document.id,
        hierarchyPath: [],
        kind: "instance",
        objectId: "R1",
      },
      label: "R1",
      field: "instance-id",
      matchType: "exact",
    });

    expect(input.selectOnly).toHaveBeenCalledWith("instance", ["R1"]);
    expect(input.closeSearch).toHaveBeenCalledOnce();
  });

  it("owns Net highlight activation and clearing", () => {
    const activate = dependencies(false);
    createEditorNavigationController(activate).toggleHighlightedNet();
    expect(activate.setHighlightedNetOrigin).toHaveBeenCalledWith({
      documentId: activate.document.id,
      netId: "net-a",
      hierarchyPath: [],
    });

    const clear = dependencies(true);
    createEditorNavigationController(clear).toggleHighlightedNet();
    expect(clear.setHighlightedNetOrigin).toHaveBeenCalledWith(null);
  });
});
