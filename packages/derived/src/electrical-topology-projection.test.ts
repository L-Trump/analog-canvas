import { createEmptyDocument, createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { deriveElectricalTopologyProjection } from "./electrical-topology-projection.js";

describe("electrical topology projection", () => {
  it("derives Net, physical component, naming, Route and Junction facts", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-a", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-a", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-a", position: { x: 100, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "route-a",
        netId: "net-a",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.connectivityEvidence.push({
      id: "claim-a",
      kind: "name-claim",
      netId: "net-a",
      name: "VOUT",
      owner: { kind: "net-label", annotationId: "label-a" },
      scope: "local",
    });

    const projection = deriveElectricalTopologyProjection(document);
    expect(projection.endpointToBaseNet).toEqual(
      new Map([
        ["junction:J1", "net-a"],
        ["junction:J2", "net-a"],
      ]),
    );
    expect(projection.endpointToPhysicalComponent.get("junction:J1")).toBe(
      projection.endpointToPhysicalComponent.get("junction:J2"),
    );
    expect(projection.routeIncidence.get("route-a")).toEqual([
      "junction:J1",
      "junction:J2",
    ]);
    expect(projection.junctionIncidence.get("J1")).toEqual(["route-a"]);
    expect(projection.nameClaimsByOwner.get("net-label:label-a")).toMatchObject(
      { netId: "net-a", name: "VOUT", scope: "local" },
    );
  });
});
