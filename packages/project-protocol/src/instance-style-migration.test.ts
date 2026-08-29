import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "./save.js";

import { parseProject, tryParseProjectWithMetadata } from "./index.js";
import {
  upgradeSchema28To29,
  upgradeSchema28To29WithReport,
} from "./transforms/annotation-grid.js";
import {
  upgradeSchema29To30,
  upgradeSchema29To30WithReport,
} from "./transforms/formula-rich-text.js";
import {
  upgradeSchema30To31,
  upgradeSchema30To31WithReport,
} from "./transforms/signal-flow-parameters.js";

describe("schema migrations through Signal Flow parameters", () => {
  it("keeps each retained historical transform independently usable", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v29 = upgradeSchema28To29({ ...current, schemaVersion: 28 });
    const v30 = upgradeSchema29To30(v29);
    const v31 = upgradeSchema30To31(v30);

    expect(v29.schemaVersion).toBe(29);
    expect(v30.schemaVersion).toBe(30);
    expect(v31.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(v31.schemaVersion).toBe(31);
  });

  it("reports additive 28→29, 29→30, and 30→31 upgrades as unchanged", () => {
    expect(
      upgradeSchema28To29WithReport({ schemaVersion: 28 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema29To30WithReport({ schemaVersion: 29 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema30To31WithReport({ schemaVersion: 30 }).report.changed,
    ).toBe(false);
  });

  it("migrates schema 30 to 31 at the rolling project boundary", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v30 = JSON.stringify({ ...current, schemaVersion: 30 });
    const result = tryParseProjectWithMetadata(v30);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSchemaVersion).toBe(30);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(31);
  });

  it("does not keep schema 29 in the rolling read window", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v29 = JSON.stringify({ ...current, schemaVersion: 29 });
    expect(tryParseProjectWithMetadata(v29)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "UNSUPPORTED_SCHEMA_VERSION" }],
    });
  });

  it("round-trips style and Signal Flow presentation independently from netlist data", () => {
    const project = createEmptyProject("test", "Test");
    project.documents[0]!.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: { value: "10k" } },
      styleOverride: {
        foreground: "#DC2626",
        background: "#2563EB",
      },
      signalFlowParameters: {
        formula: "1 - z^-1",
        coefficient: "c0",
        bodyWidth: 100,
        bodyHeight: 50,
      },
    });

    const serialized = serializeProject(project);
    const parsed = parseProject(serialized);
    expect(parsed.documents[0]!.instances[0]).toMatchObject({
      netlist: { reference: "R1", parameters: { value: "10k" } },
      styleOverride: {
        foreground: "#DC2626",
        background: "#2563EB",
      },
      signalFlowParameters: {
        formula: "1 - z^-1",
        coefficient: "c0",
        bodyWidth: 100,
        bodyHeight: 50,
      },
    });
    expect(serializeProject(parsed)).toBe(serialized);
  });
});
