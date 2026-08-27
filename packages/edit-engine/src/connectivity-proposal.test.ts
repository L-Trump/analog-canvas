import { createEmptyDocument, createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  createConnectivityProposal,
  gateConnectivityProposal,
} from "./connectivity-proposal.js";

describe("ConnectivityProposal", () => {
  it("derives logical and geometry evidence from one specialist edit plan", () => {
    const document = createEmptyDocument("main", "Main");
    const proposal = createConnectivityProposal(document, {
      intent: "draw_wire",
      diagnostics: [],
      edits: [
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: "M1", pinName: "D" },
          to: { kind: "junction", junctionId: "J1" },
          newNetId: "net-1",
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "route-1",
            netId: "net-1",
            start: { kind: "terminal", instanceId: "M1", pinName: "D" },
            end: { kind: "junction", junctionId: "J1" },
            bends: [],
            modes: ["manual"],
          }),
        },
      ],
    });

    expect(proposal.logical).toEqual({
      netIds: ["net-1"],
      endpointKeys: ["junction:J1", "terminal:M1:D"],
    });
    expect(proposal.geometry.routeIds).toEqual(["route-1"]);
    expect(proposal.affectedObjectIds).toEqual([]);
    expect(gateConnectivityProposal(document, proposal)).toMatchObject({
      ok: true,
    });
  });

  it("rejects stale or cross-Cell commit attempts", () => {
    const document = createEmptyDocument("main", "Main");
    const proposal = createConnectivityProposal(document, {
      intent: "add_or_remove_no_connect",
      diagnostics: [],
      edits: [
        {
          kind: "add_no_connect",
          noConnect: {
            id: "nc-1",
            endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
          },
        },
      ],
    });
    expect(proposal.logical.endpointKeys).toEqual(["terminal:M1:D"]);
    expect(proposal.affectedObjectIds).toEqual(["nc-1"]);
    expect(
      gateConnectivityProposal({ ...document, revision: 1 }, proposal),
    ).toEqual({ ok: false, message: "Connectivity proposal is stale" });
    expect(
      gateConnectivityProposal({ ...document, id: "child" }, proposal),
    ).toEqual({
      ok: false,
      message: "Connectivity proposal targets another Cell",
    });
  });
});
