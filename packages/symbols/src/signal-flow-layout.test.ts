import { describe, expect, it } from "vitest";

import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveSignalFlowFormulaLayout,
  resolveSignalFlowPinAt,
} from "./signal-flow-layout.js";

const definition = {
  formulaPresentation: {
    defaultFormula: "z^-1/(1-z^-1)",
    supportsCoefficient: true,
    center: { x: 0, y: 0 },
    fontSize: 12,
    adaptiveFrame: {
      minBodyWidth: 120,
      minBodyHeight: 60,
      horizontalPadding: 16,
      verticalPadding: 12,
      leadLength: 20,
    },
  },
} as const;

const baseParameters = { formula: "1/s", coefficient: "K" } as const;

describe("signal-flow layout", () => {
  it("keeps 1/s, z^-1, and z^-1/(1-z^-1) at fontSize 12 and grows fractions vertically", () => {
    const inline = resolveSignalFlowFormulaLayout(
      definition.formulaPresentation,
      {
        formula: "1/s",
      },
    );
    const unitDelay = resolveSignalFlowFormulaLayout(
      definition.formulaPresentation,
      { formula: "z^-1" },
    );
    const fraction = resolveSignalFlowFormulaLayout(
      definition.formulaPresentation,
      { formula: "z^-1/(1-z^-1)" },
    );

    expect(inline?.fontSize).toBe(12);
    expect(unitDelay?.fontSize).toBe(12);
    expect(fraction?.fontSize).toBe(12);
    expect(fraction?.bounds.height).toBeGreaterThanOrEqual(
      inline!.bounds.height,
    );
    expect(fraction?.contentHeight).toBeGreaterThanOrEqual(
      inline!.contentHeight,
    );
    expect(fraction?.formulaWidth).toBeGreaterThanOrEqual(43.2);
    expect(
      fraction!.denominatorBaseline - fraction!.fractionBarY,
    ).toBeGreaterThanOrEqual(fraction!.fontSize * 1.25);
    expect(
      fraction!.fractionBarY - fraction!.numeratorBaseline,
    ).toBeGreaterThanOrEqual(fraction!.fontSize * 0.4);
  });

  it("snaps adaptive body and pinSpan to 10-grid and only expands min bounds", () => {
    const layout = resolveAdaptiveSignalFlowBlockLayout(definition, {
      ...baseParameters,
      bodyWidth: 121,
      bodyHeight: 61,
    });
    expect(layout?.body.width).toBe(130);
    expect(layout?.body.height).toBe(70);
    expect(layout?.pinSpan).toBe(90);
    expect(layout?.bounds.width).toBe(180);
    expect(layout?.bounds.height).toBe(70);

    const larger = resolveAdaptiveSignalFlowBlockLayout(definition, {
      formula: "very_long_custom_transfer_function",
      bodyWidth: 160,
      bodyHeight: 90,
    });
    expect(larger).toBeDefined();
    expect(larger!.body.width).toBeGreaterThanOrEqual(160);
    expect(larger!.body.height).toBeGreaterThanOrEqual(90);
    expect(larger!.body.width % 10).toBe(0);
    expect(larger!.body.height % 10).toBe(0);
    expect(larger!.body.width).toBeGreaterThanOrEqual(layout!.body.width);
  });

  it("keeps adaptive body, pinSpan, and pin coordinates aligned around the same center", () => {
    const layout = resolveAdaptiveSignalFlowBlockLayout(definition, {
      formula: "z^-1/(1-z^-1)",
      coefficient: "A",
    });
    const west = resolveSignalFlowPinAt(
      definition,
      { at: { x: -40, y: 0 }, direction: "west" },
      { formula: "z^-1/(1-z^-1)" },
    );
    const east = resolveSignalFlowPinAt(
      definition,
      { at: { x: 40, y: 0 }, direction: "east" },
      { formula: "z^-1/(1-z^-1)" },
    );

    expect(layout?.body.x).toBe(-layout!.body.width / 2);
    expect(layout?.body.y).toBe(-layout!.body.height / 2);
    expect(west.x).toBe(-layout!.pinSpan);
    expect(east.x).toBe(layout!.pinSpan);
    expect(west.y).toBe(0);
    expect(east.y).toBe(0);
  });
});
