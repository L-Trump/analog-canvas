import type { SchematicEdit } from "@icm/edit-engine";
import { mosBulkKind } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";

/**
 * An explicit supply placement chooses a cell default only once.  The caller
 * supplies the just-authored Net ID; this helper never discovers a supply by
 * name or power role, so AVDD-first and VDD-first remain equally deliberate.
 */
export function planInitialMosBulkDefault(
  document: SchematicDocument,
  domain: "ground" | "vdd",
  netId: string,
): readonly SchematicEdit[] {
  if (domain === "ground") {
    return document.mosBulkDefaults?.nmosNetId
      ? []
      : [
          { kind: "set_mos_bulk_defaults", nmosNetId: netId },
          { kind: "reconcile_mos_bulk" },
        ];
  }
  return document.mosBulkDefaults?.pmosNetId
    ? []
    : [
        { kind: "set_mos_bulk_defaults", pmosNetId: netId },
        { kind: "reconcile_mos_bulk" },
      ];
}

/**
 * Reconfigure only bodies that were materialized from the previous cell
 * default. Explicit B wiring and No Connect remain untouched.
 */
export function planMosBulkDefaultUpdate(
  document: SchematicDocument,
  kind: "nmos" | "pmos",
  netId: string | null,
): readonly SchematicEdit[] {
  const clearEdits: SchematicEdit[] = document.instances.flatMap((instance) =>
    mosBulkKind(instance) === kind &&
    instance.mosBulkBinding?.origin === "cell-default"
      ? [{ kind: "clear_mos_bulk_default", instanceId: instance.id }]
      : [],
  );
  const setDefault: SchematicEdit =
    kind === "nmos"
      ? { kind: "set_mos_bulk_defaults", nmosNetId: netId }
      : { kind: "set_mos_bulk_defaults", pmosNetId: netId };
  return [
    ...clearEdits,
    setDefault,
    ...(netId ? [{ kind: "reconcile_mos_bulk" } as const] : []),
  ];
}
