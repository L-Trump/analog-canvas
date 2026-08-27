import { razaviProductSymbols } from "./razavi-catalog.js";
import type { SymbolDefinition } from "./schema.js";

/**
 * Optional devices that extend the Reference-calibrated Razavi core without
 * claiming Razavi visual authority.  These symbols follow the conventional
 * high-voltage DMOS drawing supplied for the Extended Devices library. DMOS
 * deliberately reuses the complete NMOS/PMOS artwork and differs only by one
 * additional line in the drain-side drift region.
 */

export const EXTENDED_DEVICE_CATEGORY = "Extended Devices";
export const HIGH_VOLTAGE_DEVICE_SUBCATEGORY = "High-voltage devices";

export interface ExpandedDeviceCatalogEntry {
  readonly symbolId: string;
  readonly category: typeof EXTENDED_DEVICE_CATEGORY;
  readonly subcategory: typeof HIGH_VOLTAGE_DEVICE_SUBCATEGORY;
}

function dmosSymbol(
  id: "ndmos" | "pdmos",
  name: "N-channel DMOS" | "P-channel DMOS",
  baseId: "nmos" | "pmos",
): SymbolDefinition {
  const base = razaviProductSymbols.find((symbol) => symbol.id === baseId);
  if (!base) throw new Error(`Missing Extended Devices base Symbol: ${baseId}`);
  const drainPin = base.pins.find((pin) => pin.name === "D");
  if (!drainPin) {
    throw new Error(`Missing drain pin for Expanded Device: ${baseId}`);
  }
  const drainBranch = base.primitives.find(
    (primitive) =>
      primitive.kind === "polyline" &&
      primitive.points.at(-1)?.x === drainPin.at.x &&
      primitive.points.at(-1)?.y === drainPin.at.y,
  );
  if (drainBranch?.kind !== "polyline") {
    throw new Error(`Missing drain branch for Expanded Device: ${baseId}`);
  }
  const branchStart = drainBranch.points[0];
  const branchEnd = drainBranch.points[1];
  if (!branchStart || !branchEnd) {
    throw new Error(`Invalid drain branch for Expanded Device: ${baseId}`);
  }
  const driftOffset = Math.sign(branchEnd.y - drainPin.at.y) * 4;

  return {
    ...base,
    id,
    name,
    primitives: [
      ...base.primitives,
      {
        kind: "polyline",
        points: [
          {
            x: branchStart.x,
            y: branchStart.y + driftOffset,
          },
          {
            x: branchEnd.x,
            y: branchEnd.y + driftOffset,
          },
          branchEnd,
        ],
        part: "drift-region",
        style: drainBranch.style,
      },
    ],
    variants: base.variants.map((variant) => ({
      ...variant,
      id:
        variant.id === base.defaultVariantId
          ? "standard-3terminal"
          : variant.id,
    })),
    defaultVariantId: "standard-3terminal",
  };
}

export const nChannelDmosSymbol = dmosSymbol("ndmos", "N-channel DMOS", "nmos");
export const pChannelDmosSymbol = dmosSymbol("pdmos", "P-channel DMOS", "pmos");

export const expandedDeviceSymbols: readonly SymbolDefinition[] = [
  nChannelDmosSymbol,
  pChannelDmosSymbol,
];

export const expandedDeviceCatalogEntries: readonly ExpandedDeviceCatalogEntry[] =
  expandedDeviceSymbols.map((symbol) => ({
    symbolId: symbol.id,
    category: EXTENDED_DEVICE_CATEGORY,
    subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
  }));

export function expandedDeviceCatalogEntry(
  symbolId: string,
): ExpandedDeviceCatalogEntry | undefined {
  return expandedDeviceCatalogEntries.find(
    (entry) => entry.symbolId === symbolId,
  );
}
