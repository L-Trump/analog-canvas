import type { DeviceDescriptor } from "../contract.js";
import { pmosDevice } from "./pmos.js";

/** High-voltage P-channel DMOS with ordinary four-terminal MOS semantics. */
export const pdmosDevice = {
  ...pmosDevice,
  id: "pdmos",
  symbolId: "pdmos",
} satisfies DeviceDescriptor;
