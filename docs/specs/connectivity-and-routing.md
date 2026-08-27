# Connectivity and Routing

Status: `accepted`

Primary owners: `packages/model`, `packages/edit-engine`, `packages/derived`

`Net.terminals` is logical connectivity. A terminal is an Instance pin; both
`port` and `port-filled` participate through their ordinary pin `P`. Routes use
the same terminal endpoint for those Instances and every other component.

A Route belongs to one Net and connects terminal or Junction endpoints. Its
canonical path is one `start` endpoint followed by ordered legs. Non-final
legs end at stable, dot-free bends; the final leg ends at the other endpoint.
Each leg owns its mode and stable `legId`, so geometry and behavior cannot
drift as parallel arrays. Junctions are explicit branch/route anchors.
Geometric crossing or overlap does not create electrical contact.

Route centerlines are one geometry protocol. Normal interactive Routes may use
horizontal, vertical, or ±45-degree segments; orthogonal is the default
authoring constraint, not a second persisted Route shape. `power-rail` is the
single exception: it is one straight, non-zero horizontal or vertical segment.
A future arbitrary-angle policy must use the same segment-geometry kernel and
Route transaction.

## Authoring rules

- Starting and ending a wire on terminals or explicit Junctions creates or
  joins real Net membership through one atomic Edit Engine transaction.
- Every terminal resolves through one `EndpointConnection`. Exact artwork
  contact and outward escape are derived presentation geometry; the Wire
  compiler persists only grid landings and ordinary grid bends. An offset
  MOS B anchor therefore uses the same Route transaction as every other pin;
  `bulk-dashed` changes only presentation.
- Exact visible endpoint coincidence is a zero-length physical contact. After
  placement or geometry edits reach their final coordinates, the Edit Engine
  deterministically creates or merges the participating Base Net; incompatible
  power domains or Net-name contracts reject the whole transaction. An
  explicit `disconnect_endpoint` in the same transaction suppresses this
  normalization so deletion cannot immediately reconnect itself.
- If a move, rotation, or mirror separates a confirmed direct contact, the
  transaction materializes one ordinary manual Route after all transforms have
  reached their final positions. Jointly transformed endpoints remain a
  route-free direct contact, and an existing alternate physical path prevents
  duplicate Route creation.
- A Route-segment tap splits geometry at an explicit Junction. A Junction that
  lands on another ordinary Route joins and splits that conductor as well; a
  mere route-interior crossing remains disconnected. Pin-to-route attachment
  remains a snapped typed intent because it changes the selected Route's
  identity and geometry.
- Moving a connected Instance stretches the attached Route while preserving
  endpoint identity.
- `remove_route_geometry` removes presentation geometry only. The ordinary
  Wire Delete command uses `cut_connection`: it always recomputes physical
  Base-Net components and never lets imported, global, or name Evidence hide a
  real disconnection.
- A Route-anchored label or marker is part of the Route deletion closure and is
  removed through its typed annotation edit before the Route is cut.
- `NoConnect` and Net membership are mutually exclusive.
- Snap, selection, highlight, clipboard, undo, Agent Snapshot, and formal render
  consume the same resolved endpoint geometry.

Routes may present as `wire`, `bulk-dashed`, or `power-rail`; presentation does
not alter Net identity. `bulk-dashed` is used for explicit MOS B routing.
Manual MOS instances without explicit B membership first use a configured
cell-default Net; without one, bulk remains unresolved. Starting a
`bulk-dashed` route from B treats a configured default membership as unowned;
committing clears the binding before connecting the explicit Net. Deleting the
explicit route may reconcile only an explicitly configured cell default.
Source-bound/imported MOS instances remain governed by their fourth-node
evidence and are never guessed. Legacy persisted `supply-default` bindings are
readable compatibility data, not a current authoring policy.

A `power-rail` Route is valid only on an explicit named Net whose persisted
`powerDomain` is `vdd`. Rail authoring creates or reuses that name in the
current Document, preserves an existing explicit scope, and otherwise creates
a local Net. It adds two route-anchor Junctions, the rail Route, and one
net-name-bound RichText power label. It creates no VDD Instance. Branch wires
on the same Net use ordinary wire presentation and explicit contact evidence.
The two rail endpoints remain directly resizable along the rail axis; moving
the rail translates its full connected component, including tap Junctions,
without splitting the rail into independent pieces.

A named global Net is itself an explicit semantic bridge. Separate Ground or
VDD markers on that Net do not require a drawn trunk or matching label and do
not produce a flightline. Named local Nets still require route, contact, or
label evidence for their visible connectivity.

## Imported routing guidance

SPICE import creates electrical membership before drawing and persists one
`spice-source` provenance record per imported Base Net. Source provenance is
not an electrical equivalence rule. When a cut partitions that Base Net, every
surviving component retains the same source identity while remaining a
separate electrical Base Net. `deriveRoutingGuidance` is a pure,
device-neutral minimum-spanning tree over current visible components grouped
by source identity: it does not read MOS/Bulk semantics, labels, or editor
state. Symbol pin visibility, implicit terminals, and named-global-Net
exemptions are adapter policy before this calculation.

A guide is transient presentation, never a Route, Junction, or electrical
contact. A guide click starts the ordinary Wire interaction. Label, geometry,
or transform edits cannot dismiss guidance; the current graph simply yields a
new result. `remove_route_geometry` retains Net membership and therefore
re-exposes unresolved imported components. A normal connection cut splits all
physical components, including imported and global Base Nets; only the primary
component retains non-source electrical Evidence such as explicit equivalence,
while owner-addressed markers follow their surviving component and source
provenance is copied to every component. The editor may show
focused, all, or hidden imported guides; each guide carries the actual Base
Net at both endpoints, so clicking it uses the ordinary Wire merge path. Net
highlight suppresses guides incident to the highlighted Net. Unplaced
endpoints remain in the Placement Tray and do not receive invented page
coordinates.

## Derived read models

`ProjectConnectivityIndex` is the shared logical/routed connectivity view.
`ResolvedRouteGeometry` is the shared geometry for render, hit testing, drag,
marker attachment, diagnostics, export, and Agent Snapshot. It publishes the
same resolved endpoint connections consumed by those readers; consumers do not
reconstruct terminal contacts from Symbol coordinates.
`deriveDocumentContactEvidence` is the sole read model for confirmed same-Net
coincident contacts; consumers do not infer contact independently from pixels
or bounds. The transaction connectivity normalizer is the corresponding write
boundary: it derives gained endpoint and explicit Junction-on-route contacts
from exact resolved geometry and commits them through the ordinary Base-Net and
Route mutations.

Route queries (tap, nearest segment, crossings) and attachment placement are
read-only derived modules. Route normalization, constraint-aware authoring, segment
movement, stretch, and the `RouteEditPlan` preview/commit boundary belong to
`@icm/edit-engine`; no compatibility `RoutePolyline` protocol exists.

For explicit same-Net endpoints at the same page coordinate, contact evidence
records terminals/Junctions, independently authored Route arms, and incident
directions. Route bends are not implicit contacts. A visible dot represents
authored branch topology, not line intersection: Route arms and terminal stems
count by distinct visible direction, so collinear incidents paint as one
conductor and do not justify a dot. Three distinct visible directions require a
dot; three or more coincident terminals also require one even when some stems
overlap.

## Transaction invariants

- Every terminal and Junction reference exists.
- Every Route endpoint agrees with the Route Net.
- A terminal belongs to at most one Net.
- Route normalization removes duplicate and collinear interior points without
  changing endpoint identity.
- A failed multi-edit transaction changes nothing; a successful one advances
  revision once.
- GUI and Agent use the same planners, transaction engine, derived geometry,
  and diagnostics.
