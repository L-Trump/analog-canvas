# ADR 0049: Deterministic digital timing simulation is a separate layer

Status: `accepted`

Date: `2026-08-28`

Owners: `packages/simulation`, `apps/editor`, `packages/devices`, `packages/netlist`

## Context

The editor can already author sequential logic symbols, but schematic editing,
analog netlist export, and browser presentation do not provide a clocked
digital execution model. Treating waveform pixels as simulation data would
couple electrical behavior to a textbook image and would make results hard to
test. Persisting every run in Project JSON would also turn derived, stale data
into authored circuit state.

## Decision

`@icm/simulation` is a separate deterministic event layer over the current
`SchematicDocument`. It extracts logical Nets through the derived connectivity
model and supports four-state values, driven-net resolution, combinational
delta-cycle settling, two-terminal Pulse Sources, and rising-edge D flip-flop
capture. Time is represented as integer picoseconds.

The first supported block is deliberately small: Pulse Source, inverter,
Buffer, two-input logic gates, and a D flip-flop. Unsupported components emit a
diagnostic instead of acquiring guessed behavior. A Pulse Source's negative
terminal must connect to Ground; its positive terminal drives the logical Net.

Saved nodes are observation selections, not electrical probes. The browser
keeps the selections and run result in the active panel session. Changing the
Document marks an existing run stale. SVG and PNG export serialize the current
temporary result. “Place on Canvas” is the explicit persistence boundary: it
converts the run to ordinary editable vector drafting objects and does not
store an executable result cache in Project JSON.

Razavi Figure 20.54 governs presentation only: stacked square traces, signal
labels, dashed timing guides, and a horizontal time axis. It cannot establish
logic values, event ordering, or clock semantics.

## Consequences

- Identical Document/profile inputs produce identical traces.
- The simulation layer can grow without making the editor or netlist exporter
  its execution engine.
- A placed waveform is a static drawing and does not silently refresh after
  circuit edits.
- Gate delay, setup/hold timing, metastability, hierarchy, and analog threshold
  conversion remain out of scope for this first block.

## Validation

- Unit tests cover four-state logic, Pulse-to-gate propagation, DFF division,
  logical-Net equivalence, waveform SVG generation, and vector placement.
- Device and netlist tests cover the two-terminal Pulse Source defaults and
  SPICE/Spectre `PULSE` output.
- Browser validation covers panel layout, collapse behavior, catalog exposure,
  and console cleanliness.
