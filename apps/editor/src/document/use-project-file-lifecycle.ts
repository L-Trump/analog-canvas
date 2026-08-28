import { useEffect, useRef, useState } from "react";

import { createEmptyProject, createId } from "@icm/model";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols, findUnsupportedProjectSymbolIds } from "@icm/symbols";

import { materializeRazaviProjectBulkConnections } from "../presentation/razavi-presentation";
import type {
  BrowserRecoveryFormalFileHint,
  BrowserRecoveryGeneration,
  BrowserRecoverySource,
} from "./browser-recovery-contract";
import type { RecoveryCoordinator } from "./recovery-coordinator";
import {
  downloadTextArtifact,
  formatProjectOpenDiagnostics,
  projectFileBaseName,
  requestProjectDownload,
  resaveProjectArtifact,
  saveProjectArtifact,
  stageProjectFile,
} from "./project-file-service";
import type {
  ProjectFileState,
  ProjectSaveOutcome,
  ProjectSaveTarget,
} from "./project-file-service";
import { projectChangeToken } from "./project-session-lifecycle";
import {
  openWorkspaceSlot,
  type WorkspaceSlot,
} from "../features/editor-shell/workspace-shelf";

const REFRESH_RESTORE_STORAGE_KEY = "icm.restore-after-refresh.v1";

export interface FormalProjectBaseline {
  project: CircuitProject;
  viewBox: GridRect;
}

interface PreviousProjectSnapshot extends FormalProjectBaseline {
  fileState: ProjectFileState;
  formalBaseline: FormalProjectBaseline | null;
}

interface ReplaceGuardState {
  intent: string;
  perform: () => void | Promise<void>;
  recoveryProtected: boolean;
}

export interface ReplaceProjectOptions {
  source?: BrowserRecoverySource;
  keepWorkingCopy?: boolean;
  formalFileHint?: BrowserRecoveryFormalFileHint;
  rememberPrevious?: boolean;
  fileState?: ProjectFileState;
  formalBaseline?: FormalProjectBaseline | null;
}

type RecoveryLifecycle = Pick<
  RecoveryCoordinator,
  | "workingCopyId"
  | "stage"
  | "cancelPending"
  | "flushNow"
  | "beginWorkingCopy"
  | "noteFormalFileHint"
  | "discover"
  | "readSessionProject"
  | "deleteSession"
> & {
  ready: boolean;
  sessions: RecoveryCoordinator["sessions"];
};

export interface UseProjectFileLifecycleOptions {
  project: CircuitProject;
  projectSessionId: string;
  viewBox: GridRect;
  defaultViewBox: GridRect;
  recovery: RecoveryLifecycle;
  installProject(project: CircuitProject, viewBox: GridRect): SchematicDocument;
  setStatus(message: string): void;
}

export function useProjectFileLifecycle({
  project,
  projectSessionId,
  viewBox,
  defaultViewBox,
  recovery,
  installProject,
  setStatus,
}: UseProjectFileLifecycleOptions) {
  const [restoreAfterRefresh] = useState(() => {
    if (typeof window === "undefined") return false;
    const requested =
      window.sessionStorage.getItem(REFRESH_RESTORE_STORAGE_KEY) === "true";
    if (requested) {
      window.sessionStorage.removeItem(REFRESH_RESTORE_STORAGE_KEY);
    }
    return requested;
  });
  const refreshRestoreAttemptedRef = useRef(false);
  const [fileState, setFileState] = useState<ProjectFileState>("new");
  const saveTargetRef = useRef<ProjectSaveTarget | null>(null);
  const [formalProjectBaseline, setFormalProjectBaseline] =
    useState<FormalProjectBaseline | null>(null);
  const fileStateBaselineRef = useRef<{
    session: string;
    token: string;
  } | null>(null);
  const [previousProject, setPreviousProject] =
    useState<PreviousProjectSnapshot | null>(null);
  const [replaceGuard, setReplaceGuard] = useState<ReplaceGuardState | null>(
    null,
  );
  const [replaceGuardSaving, setReplaceGuardSaving] = useState(false);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [
    dismissedStartupRecoveryRecordId,
    setDismissedStartupRecoveryRecordId,
  ] = useState<string | null>(null);

  function isDirtyWork(): boolean {
    return fileState === "dirty" || fileState === "write-failed";
  }

  function replaceActiveProject(
    nextProject: CircuitProject,
    nextViewBox: GridRect = defaultViewBox,
    options: ReplaceProjectOptions = {},
  ): SchematicDocument {
    if (options.rememberPrevious !== false) {
      setPreviousProject({
        project: structuredClone(project),
        viewBox: { ...viewBox },
        fileState,
        formalBaseline: formalProjectBaseline
          ? {
              project: structuredClone(formalProjectBaseline.project),
              viewBox: { ...formalProjectBaseline.viewBox },
            }
          : null,
      });
    }
    recovery.cancelPending();
    if (options.keepWorkingCopy !== true) {
      recovery.beginWorkingCopy(options.source ?? "new");
    }
    if (options.formalFileHint !== undefined) {
      recovery.noteFormalFileHint(options.formalFileHint);
    }
    const prepared = materializeRazaviProjectBulkConnections(nextProject);
    const nextDocument = installProject(prepared.project, nextViewBox);
    saveTargetRef.current = null;
    const nextFileState =
      options.fileState ??
      (options.source === "opened-file"
        ? "opened"
        : options.source === "spice-import" || options.source === "recovered"
          ? "dirty"
          : "new");
    setFileState(nextFileState);
    setFormalProjectBaseline(options.formalBaseline ?? null);
    recovery.stage(prepared.project, {
      unsavedAtSnapshot:
        nextFileState === "dirty" || nextFileState === "write-failed",
    });
    return nextDocument;
  }

  async function saveProjectFile(
    options: { pickLocation?: boolean } = {},
  ): Promise<ProjectSaveOutcome> {
    const outcome = await saveProjectArtifact(
      project,
      {},
      options.pickLocation ? null : saveTargetRef.current,
    );
    if (outcome.status === "write-confirmed") {
      saveTargetRef.current = outcome.target ?? null;
      setFormalProjectBaseline({
        project: structuredClone(project),
        viewBox: { ...viewBox },
      });
      recovery.noteFormalFileHint({
        name: outcome.fileName,
        lastConfirmedWriteAt: outcome.at,
      });
      recovery.stage(project, { unsavedAtSnapshot: false });
      await recovery.flushNow();
      setFileState("write-confirmed");
      setStatus(`Saved ${outcome.fileName} (write confirmed)`);
      return outcome;
    }
    if (outcome.status === "download-requested") {
      setFormalProjectBaseline({
        project: structuredClone(project),
        viewBox: { ...viewBox },
      });
      recovery.noteFormalFileHint({
        name: outcome.fileName,
        lastDownloadRequestedAt: new Date().toISOString(),
      });
      recovery.stage(project, { unsavedAtSnapshot: false });
      await recovery.flushNow();
      setFileState("download-requested");
      setStatus(`Download requested: ${outcome.fileName}`);
      return outcome;
    }
    if (outcome.status === "picker-cancelled") {
      setStatus("Save cancelled");
      return outcome;
    }
    if (outcome.status === "permission-denied") {
      setStatus(
        `Save location unavailable and download failed: ${outcome.message}`,
      );
      return outcome;
    }
    if (outcome.status === "write-failed") {
      setFileState("write-failed");
      setStatus(
        `Save failed at ${outcome.stage}: ${outcome.message} — recovery kept; download the Project instead`,
      );
      return outcome;
    }
    if (outcome.status === "target-unavailable") {
      setStatus("Save location is no longer available — choose one again");
      return outcome;
    }
    setStatus(`Project could not be serialized: ${outcome.message}`);
    return outcome;
  }

  async function reportExport(message: string): Promise<void> {
    if (!isDirtyWork()) {
      setStatus(message);
      return;
    }
    const target = saveTargetRef.current;
    if (target) {
      const outcome = await resaveProjectArtifact(project, target);
      if (outcome.status === "write-confirmed") {
        recovery.noteFormalFileHint({
          name: outcome.fileName,
          lastConfirmedWriteAt: outcome.at,
        });
        recovery.stage(project, { unsavedAtSnapshot: false });
        await recovery.flushNow();
        setFileState("write-confirmed");
        setStatus(`${message} — also saved ${outcome.fileName}`);
        return;
      }
    }
    setStatus(`${message} — the Project file still has unsaved changes`);
  }

  function downloadCurrentProjectBackup(): void {
    const outcome = requestProjectDownload(project);
    if (outcome.status !== "download-requested") {
      setStatus(`Download failed: ${outcome.message}`);
      return;
    }
    setFormalProjectBaseline({
      project: structuredClone(project),
      viewBox: { ...viewBox },
    });
    recovery.noteFormalFileHint({
      name: outcome.fileName,
      lastDownloadRequestedAt: new Date().toISOString(),
    });
    recovery.stage(project, { unsavedAtSnapshot: false });
    setFileState("download-requested");
    setStatus(`Download requested: ${outcome.fileName}`);
  }

  async function guardDirtyReplacement(
    intent: string,
    perform: () => void | Promise<void>,
  ): Promise<void> {
    if (!isDirtyWork()) {
      await perform();
      return;
    }
    recovery.stage(project, { unsavedAtSnapshot: true });
    const recoveryState = await recovery.flushNow();
    setReplaceGuard({
      intent,
      perform,
      recoveryProtected: recoveryState === "stored",
    });
  }

  function cancelReplaceGuard(): void {
    if (replaceGuardSaving) return;
    setReplaceGuard(null);
  }

  function confirmReplaceGuard(): void {
    if (replaceGuardSaving) return;
    const guard = replaceGuard;
    if (!guard) return;
    setReplaceGuard(null);
    void guard.perform();
  }

  function saveAndContinueReplaceGuard(): void {
    const guard = replaceGuard;
    if (!guard || replaceGuardSaving) return;
    setReplaceGuardSaving(true);
    void (async () => {
      const outcome = await saveProjectFile();
      if (
        outcome.status === "write-confirmed" ||
        outcome.status === "download-requested"
      ) {
        setReplaceGuard(null);
        await guard.perform();
      }
      setReplaceGuardSaving(false);
    })();
  }

  function createNewProject(): void {
    void guardDirtyReplacement("Create a new Project", () => {
      const next = createEmptyProject(
        createId("project"),
        "New Circuit",
        createId("document"),
      );
      replaceActiveProject(next, defaultViewBox, { source: "new" });
      setStatus("Created a new Project · Previous Project is available");
    });
  }

  function restorePreviousProject(): void {
    const previous = previousProject;
    if (!previous) return;
    void guardDirtyReplacement(`Return to ${previous.project.name}`, () => {
      const restored = replaceActiveProject(
        previous.project,
        previous.viewBox,
        {
          source: "recovered",
          fileState: previous.fileState,
          formalBaseline: previous.formalBaseline,
        },
      );
      setStatus(
        `Returned to Previous Project ${previous.project.name} at revision ${restored.revision}`,
      );
    });
  }

  function revertToFormalProjectBaseline(): void {
    const baseline = formalProjectBaseline;
    if (!baseline || !isDirtyWork()) return;
    void guardDirtyReplacement("Revert to the last saved Project", () => {
      const restored = replaceActiveProject(
        baseline.project,
        baseline.viewBox,
        {
          source: "opened-file",
          fileState: "opened",
          formalBaseline: baseline,
        },
      );
      setStatus(`Reverted to saved Project revision ${restored.revision}`);
    });
  }

  function openRecoveryDialog(): void {
    void (async () => {
      await recovery.discover();
      setRecoveryDialogOpen(true);
    })();
  }

  function restoreRecoverySession(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      if (read.status !== "valid") {
        setStatus(
          read.status === "unsupported-schema"
            ? "Recovery uses a newer Project schema and cannot be restored; download it instead"
            : `Recovery is not readable: ${
                read.status === "missing" ? "no stored record" : read.message
              }`,
        );
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      await guardDirtyReplacement(
        `Restore recovered Project ${read.project.name}`,
        async () => {
          const recoveredDocument = replaceActiveProject(
            read.project,
            defaultViewBox,
            { source: "recovered", fileState: "dirty" },
          );
          setRecoveryDialogOpen(false);
          await recovery.discover();
          setStatus(`Restored recovery revision ${recoveredDocument.revision}`);
        },
      );
    })();
  }

  function downloadRecoveryBackup(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      const summary = recovery.sessions.find(
        (session) => session.workingCopyId === workingCopyId,
      );
      if (read.status === "valid" || read.status === "unsupported-schema") {
        const text =
          read.status === "valid" ? read.record.projectText : read.projectText;
        const name =
          summary?.projectName ??
          (read.status === "valid" ? read.record.projectName : "recovery");
        const fileName = `${projectFileBaseName(name)}-backup.icproj.json`;
        const outcome = downloadTextArtifact(text, fileName);
        setStatus(
          outcome.status === "download-requested"
            ? `Download requested: ${outcome.fileName}`
            : `Download failed: ${outcome.message}`,
        );
        return;
      }
      setStatus(
        `Backup not available: ${
          read.status === "missing" ? "no stored record" : read.message
        }`,
      );
    })();
  }

  function deleteRecoverySessionFromDialog(workingCopyId: string): void {
    void (async () => {
      const removed = await recovery.deleteSession(workingCopyId);
      await recovery.discover();
      setStatus(
        removed ? "Deleted recovery copy" : "Could not delete recovery copy",
      );
    })();
  }

  function refreshApp(): void {
    void (async () => {
      recovery.stage(project, { unsavedAtSnapshot: isDirtyWork() });
      await recovery.flushNow();
      window.sessionStorage.setItem(REFRESH_RESTORE_STORAGE_KEY, "true");
      window.location.reload();
    })();
  }

  async function openProjectFile(
    file: File | null,
    options: { allowExactCurrentReplacement?: boolean } = {},
  ): Promise<void> {
    if (!file) return;
    const staged = await stageProjectFile(file, (candidate) =>
      findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
    );
    if (staged.status === "rejected") {
      setStatus(
        `Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
      );
      return;
    }
    const performOpen = () => {
      replaceActiveProject(staged.project, defaultViewBox, {
        source: "opened-file",
        formalFileHint: { name: staged.fileName },
        formalBaseline: {
          project: structuredClone(staged.project),
          viewBox: { ...defaultViewBox },
        },
        fileState: staged.migrated ? "dirty" : "opened",
      });
      setStatus(
        staged.migrated
          ? `Opened and upgraded ${staged.fileName} from schema ${staged.sourceSchemaVersion} to schema ${staged.project.schemaVersion} — save the Project to keep the upgrade`
          : `Opened ${staged.fileName} at revision ${staged.topDocumentRevision}`,
      );
    };
    if (
      options.allowExactCurrentReplacement &&
      serializeProject(staged.project) === serializeProject(project)
    ) {
      performOpen();
      return;
    }
    await guardDirtyReplacement(`Open ${file.name}`, performOpen);
  }

  async function openShelvedCircuit(slot: WorkspaceSlot): Promise<void> {
    const fetched = await openWorkspaceSlot(slot.id);
    if (fetched.status !== "opened") {
      setStatus(
        fetched.status === "signed-out"
          ? "Sign in again to open your shelf"
          : fetched.status === "not-found"
            ? "That shelved circuit is no longer there"
            : `Could not reach your shelf (${fetched.message})`,
      );
      return;
    }
    await openProjectFile(
      {
        name: `${fetched.name}.icproj.json`,
        text: () => Promise.resolve(fetched.projectText),
      } as unknown as File,
      { allowExactCurrentReplacement: true },
    );
  }

  useEffect(() => {
    if (!restoreAfterRefresh || !recovery.ready) return;
    if (refreshRestoreAttemptedRef.current) return;
    refreshRestoreAttemptedRef.current = true;
    void (async () => {
      const read = await recovery.readSessionProject(
        recovery.workingCopyId,
        "latest",
      );
      if (read.status !== "valid") {
        setStatus("No restorable recovery was found for this refresh");
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      const restoredDocument = replaceActiveProject(
        read.project,
        defaultViewBox,
        {
          source: "recovered",
          keepWorkingCopy: true,
          rememberPrevious: false,
          fileState:
            read.record.unsavedAtSnapshot === false ? "opened" : "dirty",
        },
      );
      setStatus(`Restored recovery revision ${restoredDocument.revision}`);
    })();
    // The recovery coordinator methods are stable for one mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreAfterRefresh, recovery.ready, recovery.workingCopyId]);

  const currentProjectChangeToken = projectChangeToken(project);
  useEffect(() => {
    const baseline = fileStateBaselineRef.current;
    if (baseline === null || baseline.session !== projectSessionId) {
      fileStateBaselineRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      return;
    }
    if (baseline.token !== currentProjectChangeToken) {
      fileStateBaselineRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      setFileState("dirty");
    }
  }, [currentProjectChangeToken, projectSessionId]);

  const startupRecovery =
    !restoreAfterRefresh && !isDirtyWork()
      ? (recovery.sessions.find(
          (session) =>
            session.workingCopyId === recovery.workingCopyId &&
            session.latest?.review === "valid" &&
            session.latest.unsavedAtSnapshot === true &&
            session.latest.recordId !== dismissedStartupRecoveryRecordId,
        ) ?? null)
      : null;

  return {
    fileState,
    formalProjectBaseline,
    previousProject,
    replaceGuard,
    replaceGuardSaving,
    recoveryDialogOpen,
    startupRecovery,
    setRecoveryDialogOpen,
    isDirtyWork,
    replaceActiveProject,
    saveProjectFile,
    downloadCurrentProjectBackup,
    reportExport,
    guardDirtyReplacement,
    cancelReplaceGuard,
    confirmReplaceGuard,
    saveAndContinueReplaceGuard,
    dismissStartupRecovery: () =>
      setDismissedStartupRecoveryRecordId(
        startupRecovery?.latest?.recordId ?? null,
      ),
    createNewProject,
    restorePreviousProject,
    revertToFormalProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    downloadRecoveryBackup,
    deleteRecoverySessionFromDialog,
    refreshApp,
    openProjectFile,
    openShelvedCircuit,
  };
}
