import type { SchematicEdit } from "@icm/edit-engine";
import type { DesignNetlistIR, NetlistFormat } from "@icm/netlist";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";

import { planCheckBulkDefaults } from "../netlist-export/check-and-save";
import type { WorkspaceSlot } from "./workspace-shelf";
import { saveToWorkspaceShelf } from "./workspace-shelf";
import {
  createVisualExportArtifact,
  createSvgExportArtifact,
  planDesignNetlistExport,
  requestBrowserDownload,
} from "./editor-export-commands";

type SpiceImportResult = Awaited<ReturnType<typeof importSpiceSources>>;
export interface SpiceImportReport {
  entryPath: string;
  diagnostics: SpiceImportResult["diagnostics"];
}

export interface EditorFileCommandDependencies {
  project: CircuitProject;
  getCurrentProject: () => CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  defaultViewBox: GridRect;
  publishSessionPresent: boolean;
  netlistIr: DesignNetlistIR | null;
  exportWarningsPresent: boolean;
  transact: (edits: SchematicEdit[]) => unknown;
  reportExport: (message: string) => Promise<void>;
  guardDirtyReplacement: (
    label: string,
    replace: () => void | Promise<void>,
  ) => Promise<void>;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox: GridRect,
    options: { source: "spice-import" },
  ) => void;
  setWorkspaceSlots: (slots: readonly WorkspaceSlot[]) => void;
  setNetlistPreflightOpen: (open: boolean) => void;
  setImportReport: (report: SpiceImportReport | null) => void;
  setImportReviewOpen: (open: boolean) => void;
  setSelectionOpen: (open: boolean) => void;
  setStatus: (status: string) => void;
}

/** File import/export commands and their user-facing gate/status policy. */
export function createEditorFileCommands({
  project,
  getCurrentProject,
  document,
  resolver,
  defaultViewBox,
  publishSessionPresent,
  netlistIr,
  exportWarningsPresent,
  transact,
  reportExport,
  guardDirtyReplacement,
  replaceActiveProject,
  setWorkspaceSlots,
  setNetlistPreflightOpen,
  setImportReport,
  setImportReviewOpen,
  setSelectionOpen,
  setStatus,
}: EditorFileCommandDependencies) {
  const exportSvg = (): void => {
    const artifact = createSvgExportArtifact(document, resolver, project.name);
    requestBrowserDownload(artifact, project.name);
    void reportExport(artifact.report);
  };

  // Saving a drawing settles only implicit MOS bodies. Design-netlist
  // diagnostics gate netlist export, not the author's ability to shelve an
  // intentionally abbreviated or idealized schematic.
  const checkAndSave = async (): Promise<void> => {
    const bulkPlan = planCheckBulkDefaults(document);
    const settledBodies = bulkPlan.edits.length > 0;
    if (settledBodies) transact([...bulkPlan.edits]);
    const ambiguousSides = [
      bulkPlan.ambiguous.nmos ? "NMOS" : null,
      bulkPlan.ambiguous.pmos ? "PMOS" : null,
    ].filter((side): side is string => side !== null);
    const notes = [
      settledBodies ? "bound the unwired MOS bodies" : null,
      ambiguousSides.length > 0
        ? `${ambiguousSides.join(" and ")} bodies need a supply chosen`
        : null,
    ].filter((note): note is string => note !== null);
    const prefix = notes.length > 0 ? `${notes.join("; ")} — ` : "";

    if (!publishSessionPresent) {
      setStatus(`${prefix}sign in to keep a copy on your shelf`);
      return;
    }
    const currentProject = getCurrentProject();
    const outcome = await saveToWorkspaceShelf(currentProject);
    if (outcome.status === "saved") {
      setWorkspaceSlots(outcome.slots);
      setStatus(`${prefix}saved "${currentProject.name}" to your shelf`);
      return;
    }
    setStatus(
      outcome.status === "signed-out"
        ? `${prefix}sign in again to keep a copy on your shelf`
        : outcome.status === "too-large"
          ? `${prefix}the circuit is too large for the shelf`
          : `${prefix}the shelf could not be reached (${outcome.message})`,
    );
  };

  const exportDesignNetlist = (
    format: NetlistFormat,
    warningsReviewed = false,
  ): void => {
    const plan = planDesignNetlistExport({
      format,
      ir: netlistIr,
      warningsPresent: exportWarningsPresent,
      warningsReviewed,
      projectName: project.name,
    });
    if (plan.status === "blocked") {
      setNetlistPreflightOpen(true);
      setStatus(plan.message);
      return;
    }
    requestBrowserDownload(plan.artifact, project.name);
    void reportExport(plan.artifact.report);
  };

  const exportRaster = async (format: "png" | "pdf"): Promise<void> => {
    setStatus(`Preparing ${format.toUpperCase()} export`);
    try {
      const artifact = await createVisualExportArtifact(
        format,
        document,
        resolver,
        project.name,
      );
      requestBrowserDownload(artifact, project.name);
      await reportExport(artifact.report);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    }
  };

  const importSpiceFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const sourceInputs = await Promise.all(
      [...files].map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const conventionalEntries = sourceInputs.filter((input) =>
      /\.(?:cir|sp|spi)$/iu.test(input.path),
    );
    const namedCircuitEntries = conventionalEntries.filter(
      (input) => input.path.split("/").at(-1)?.toLowerCase() === "circuit.spi",
    );
    const entryCandidates =
      namedCircuitEntries.length === 1
        ? namedCircuitEntries
        : conventionalEntries;
    if (entryCandidates.length !== 1) {
      setStatus(
        `Select one unambiguous .cir, .sp, or .spi entry and its local include files; found ${entryCandidates.length}`,
      );
      return;
    }
    setStatus("Importing SPICE sources");
    try {
      const result = await importSpiceSources(
        sourceInputs,
        entryCandidates[0]!.path,
      );
      const nextImportReport: SpiceImportReport = {
        entryPath: entryCandidates[0]!.path,
        diagnostics: result.diagnostics,
      };
      if (!result.project || !result.successful) {
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        const firstError = result.diagnostics.find(
          (item) => item.severity === "error",
        );
        setStatus(firstError?.message ?? "SPICE import failed");
        return;
      }
      const importedProject = result.project;
      const instanceCount = importedProject.documents.reduce(
        (count, candidate) => count + candidate.instances.length,
        0,
      );
      await guardDirtyReplacement("Import SPICE sources", () => {
        replaceActiveProject(importedProject, defaultViewBox, {
          source: "spice-import",
        });
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        setStatus(
          `Imported ${importedProject.documents.length} Documents and ${instanceCount} structural instances`,
        );
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SPICE import failed");
    }
  };

  return {
    exportSvg,
    checkAndSave,
    exportDesignNetlist,
    exportRaster,
    importSpiceFiles,
  };
}
