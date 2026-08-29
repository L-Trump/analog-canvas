import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import {
  builtInSymbols,
  InMemorySymbolResolver,
  type ResolvedSymbol,
} from "@icm/symbols";

import {
  instanceVisibleHitBox,
  visibleSymbolLocalBounds,
} from "./instance-geometry";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const adaptiveDefinition = {
  schemaVersion: 1 as const,
  id: "formula-block",
  name: "Formula block",
  viewBox: { x: -40, y: -20, width: 80, height: 40 },
  pins: [
    {
      name: "A",
      role: "input",
      at: { x: -40, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
    {
      name: "Y",
      role: "output",
      at: { x: 40, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
  ],
  primitives: [],
  variants: [],
  formulaPresentation: {
    defaultFormula: "z^-1/(1-z^-1)",
    supportsCoefficient: true as const,
    center: { x: 0, y: 0 },
    fontSize: 12,
    adaptiveFrame: {
      minBodyWidth: 40,
      minBodyHeight: 30,
      horizontalPadding: 8,
      verticalPadding: 1.5,
      leadLength: 20,
    },
  },
};

describe("selection geometry", () => {
  it("keeps ordinary painted geometry and pins inside the Symbol viewBox", () => {
    const resolved = resolver.resolve("opamp");
    expect(resolved).toBeDefined();
    const bounds = visibleSymbolLocalBounds(resolved!);
    expect(bounds.x).toBeGreaterThanOrEqual(resolved!.definition.viewBox.x);
    expect(bounds.width).toBeLessThanOrEqual(
      resolved!.definition.viewBox.width,
    );
    expect(bounds.height).toBeLessThanOrEqual(
      resolved!.definition.viewBox.height,
    );
  });

  it("transforms an ordinary tight envelope with instance placement", () => {
    const resolved = resolver.resolve("opamp");
    expect(resolved).toBeDefined();
    const localBounds = visibleSymbolLocalBounds(resolved!);
    const bounds = instanceVisibleHitBox(
      {
        id: "U1",
        symbolId: "opamp",
        placement: {
          position: { x: 100, y: 200 },
          rotation: 90,
          mirror: "none",
        },
      },
      resolved!,
    );
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(localBounds.height);
    expect(bounds!.height).toBeCloseTo(localBounds.width);
  });

  it("uses the reviewed DFF artwork envelope instead of source-crop whitespace", () => {
    const resolved = resolver.resolve("d-flip-flop");
    expect(resolved).toBeDefined();
    expect(visibleSymbolLocalBounds(resolved!)).toEqual({
      x: -42,
      y: -27,
      width: 84,
      height: 54,
    });
  });

  it("uses adaptive formula dimensions for local and transformed hit bounds", () => {
    const resolved = new InMemorySymbolResolver([adaptiveDefinition]).resolve(
      "formula-block",
    ) as ResolvedSymbol;
    const parameters = {
      formula: "very_long_custom_transfer_function",
      bodyWidth: 140,
      bodyHeight: 90,
    };
    const local = visibleSymbolLocalBounds(resolved, parameters);
    expect(local.width).toBeGreaterThan(140);
    expect(local.height).toBe(90);

    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "B1",
      symbolId: "formula-block",
      placement: { position: { x: 100, y: 100 }, rotation: 90, mirror: "none" },
      signalFlowParameters: parameters,
    });
    const hit = instanceVisibleHitBox(document.instances[0]!, resolved);
    expect(hit).not.toBeNull();
    expect(hit!.width).toBeCloseTo(local.height);
    expect(hit!.height).toBeCloseTo(local.width);
  });
});
