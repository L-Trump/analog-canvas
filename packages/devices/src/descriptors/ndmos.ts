import type { DeviceDescriptor } from "../contract.js";
import { nmosDevice } from "./nmos.js";

/** High-voltage N-channel DMOS with ordinary four-terminal MOS semantics. */
export const ndmosDevice = {
  ...nmosDevice,
  id: "ndmos",
  symbolId: "ndmos",
} satisfies DeviceDescriptor;
