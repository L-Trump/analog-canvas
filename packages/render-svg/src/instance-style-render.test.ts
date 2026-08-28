import { describe, expect, it } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { renderDocumentSvg, buildSvgScene } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("instance style override rendering", () => {
  it("renders an instance with foreground override", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
      styleOverride: { foreground: "#FF0000" },
    });
    const svg = renderDocumentSvg(doc, resolver);
    expect(svg).toContain('stroke="#FF0000"');
    // The instance group should have the override
    expect(svg).toContain('data-object-id="inst-1"');
  });

  it("renders an instance with background override as a rect", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
      styleOverride: { background: "#EEEEEE" },
    });
    const svg = renderDocumentSvg(doc, resolver);
    expect(svg).toContain('data-role="instance-background"');
    expect(svg).toContain('fill="#EEEEEE"');
    // Strokes should still use the profile foreground, not be hidden
    expect(svg).toContain('stroke="#000"');
  });

  it("renders both foreground and background overrides", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
      styleOverride: { foreground: "#FF0000", background: "#EEEEEE" },
    });
    const svg = renderDocumentSvg(doc, resolver);
    expect(svg).toContain('data-role="instance-background"');
    expect(svg).toContain('fill="#EEEEEE"');
    expect(svg).toContain('stroke="#FF0000"');
  });

  it("renders without override using profile defaults (backward compatible)", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
    });
    const svg = renderDocumentSvg(doc, resolver);
    expect(svg).not.toContain('data-role="instance-background"');
    expect(svg).not.toContain('data-role="instance-symbol"');
    // Should use profile foreground (#000 for razavi)
    expect(svg).toContain('stroke="#000"');
  });

  it("applies foreground override to visible pin-name text", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "d-flip-flop",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "U1", parameters: {} },
      styleOverride: { foreground: "#FF0000" },
    });
    const svg = renderDocumentSvg(doc, resolver);
    expect(svg).toContain('data-pin-name="D"');
    expect(svg).toContain('style="fill:#FF0000"');
    expect(svg).toContain('stroke="#FF0000"');
  });

  it("does not apply an instance foreground override to wires", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        styleOverride: { foreground: "#FF0000" },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push({
      id: "net-1",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    doc.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const svg = renderDocumentSvg(doc, resolver);
    expect(svg).toContain('data-object-id="route-1"');
    expect(svg).toMatch(/data-object-id="route-1"[^>]*stroke="#000"/u);
    expect(svg).toContain('data-role="instance-symbol"');
    expect(svg).toContain('stroke="#FF0000"');
  });

  it("applies foreground override to symbol primitive fills (circles/polygons)", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "V1", parameters: {} },
      styleOverride: { foreground: "#FF0000" },
    });
    const svg = renderDocumentSvg(doc, resolver);
    // Any polygon or circle fill that references "foreground" should use the override
    expect(svg).toContain('fill="#FF0000"');
  });

  it("renders background rect before symbol strokes (z-order)", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
      styleOverride: { foreground: "#FF0000", background: "#EEEEEE" },
    });
    const scene = buildSvgScene(doc, resolver);
    const body = scene.formalBody;
    const bgIndex = body.indexOf('data-role="instance-background"');
    const strokeIndex = body.indexOf('stroke="#FF0000"');
    expect(bgIndex).toBeGreaterThan(-1);
    expect(strokeIndex).toBeGreaterThan(-1);
    // Background must come before strokes in document order
    expect(bgIndex).toBeLessThan(strokeIndex);
  });

  it("renders background rect inside the instance transform group", () => {
    const doc = createEmptyDocument("doc-1", "Test");
    doc.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
      styleOverride: { foreground: "#FF0000", background: "#EEEEEE" },
    });
    const scene = buildSvgScene(doc, resolver);
    const body = scene.formalBody;
    // The background rect must be inside the <g transform="..."> group,
    // not a sibling before it.
    const transformIndex = body.indexOf('data-object-id="inst-1"');
    const bgIndex = body.indexOf('data-role="instance-background"');
    // Find the transform group inside the instance group
    const instanceStart = body.indexOf("<g ", transformIndex);
    const transformGroupStart = body.indexOf(
      '<g transform="translate(100 100) rotate(0)">',
      instanceStart,
    );
    expect(transformGroupStart).toBeGreaterThan(-1);
    expect(bgIndex).toBeGreaterThan(transformGroupStart);
    // The background should be between the transform <g> and the symbol <g>
    const symbolGroupStart = body.indexOf(
      '<g data-role="instance-symbol"',
      transformGroupStart,
    );
    expect(symbolGroupStart).toBeGreaterThan(-1);
    expect(bgIndex).toBeLessThan(symbolGroupStart);
  });

  it("produces identical stroke markup with and without background-only override", () => {
    const makeDoc = (styleOverride?: { background: string }) => {
      const doc = createEmptyDocument("doc-1", "Test");
      doc.instances.push({
        id: "inst-1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { reference: "R1", parameters: {} },
        ...(styleOverride ? { styleOverride } : {}),
      });
      return doc;
    };
    const withoutOverride = buildSvgScene(makeDoc(), resolver).formalBody;
    const withBackgroundOnly = buildSvgScene(
      makeDoc({ background: "#FFFFFF" }),
      resolver,
    ).formalBody;
    // A styled instance adds only the stable role marker plus the background;
    // its primitive stroke markup otherwise remains byte-for-byte compatible.
    const withoutStyleMarkers = withBackgroundOnly
      .replace(/<rect data-role="instance-background"[^>]*>/g, "")
      .replace(' data-role="instance-symbol"', "");
    expect(withoutStyleMarkers).toBe(withoutOverride);
  });
});
