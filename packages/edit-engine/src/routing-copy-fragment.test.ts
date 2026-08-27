import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { captureRoutingCopyFragment } from "./routing-copy-fragment.js";

describe("routing copy fragment", () => {
  it("disconnects ordinary boundary terminals but retains selected named owners", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      { id: "R2", symbolId: "resistor", placement: null },
      { id: "V1", symbolId: "vdd-port", placement: null },
    );
    document.nets.push(
      {
        id: "signal",
        terminals: [
          { instanceId: "R1", pinName: "1" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
      {
        id: "vdd",
        terminals: [
          { instanceId: "V1", pinName: "P" },
          { instanceId: "R2", pinName: "2" },
        ],
      },
    );
    document.connectivityEvidence.push({
      id: "claim",
      kind: "name-claim",
      netId: "vdd",
      name: "VDD",
      scope: "global",
      owner: { kind: "power-marker", objectId: "V1" },
      powerDomain: "vdd",
    });

    const capture = captureRoutingCopyFragment(document, {
      instanceIds: ["R1", "V1"],
      routeIds: [],
      junctionIds: [],
    });
    expect(capture.clonedNetIds).toEqual(["vdd"]);
    expect(capture.boundaryTerminalKeys).toEqual(["terminal:R1:1"]);
  });
});
