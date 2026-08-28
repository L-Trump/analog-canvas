import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { SchematicDocument } from "@icm/model";

const COLOR_PRESETS = [
  { label: "Black", value: "#000000" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#d97706" },
  { label: "Yellow", value: "#facc15" },
  { label: "Green", value: "#059669" },
  { label: "Blue", value: "#2563eb" },
  { label: "Violet", value: "#7c3aed" },
  { label: "White", value: "#ffffff" },
] as const;

/**
 * How long the choice has to settle before it reaches the document. Long
 * enough to cover a drag across the picker or a typed channel, short enough
 * that the canvas keeps up with the hand.
 */
const COLOR_SETTLE_MS = 250;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

type Instance = SchematicDocument["instances"][number];
type InstanceStyleOverride = NonNullable<Instance["styleOverride"]>;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexToRgb(value: string): RgbColor {
  const normalized = value.replace(/^#/u, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function ColorOverrideControl({
  label,
  value,
  fallback,
  transparentDefault,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  transparentDefault?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const effective = value ?? fallback;
  /**
   * One colour is chosen over many events: a drag across the picker fires an
   * input event per step, and a typed channel fires one per keystroke.
   * Committing each of them made a single choice cost nineteen undo steps,
   * and with history bounded at 64 a few colour picks pushed real editing
   * out of reach. The choice is held here and reaches the document once,
   * when the interaction ends.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The settle timer fires after the render that armed it, so it must reach
  // the caller's current handler rather than the one it closed over.
  const latestRef = useRef({ value, onChange });
  latestRef.current = { value, onChange };
  const shown = draft ?? effective;
  const rgb = hexToRgb(shown);

  const cancelSettle = (): void => {
    if (settleRef.current === null) return;
    clearTimeout(settleRef.current);
    settleRef.current = null;
  };
  const commitNow = (next: string | undefined): void => {
    cancelSettle();
    draftRef.current = null;
    setDraft(null);
    const latest = latestRef.current;
    if (next !== latest.value) latest.onChange(next);
  };
  const commitPending = (): void => {
    const pending = draftRef.current;
    if (pending === null) return;
    commitNow(pending);
  };
  /**
   * Each step of the choice updates what is shown and restarts the clock; the
   * document hears about it once the hand stops. Leaving the field, pressing
   * Enter, or picking a preset ends it immediately.
   */
  const setPending = (next: string): void => {
    draftRef.current = next;
    setDraft(next);
    cancelSettle();
    settleRef.current = setTimeout(commitPending, COLOR_SETTLE_MS);
  };

  // A control that unmounts mid-choice must not leave a timer behind.
  useEffect(() => cancelSettle, []);

  const updateChannel = (channel: keyof RgbColor, raw: string): void => {
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    setPending(rgbToHex({ ...rgb, [channel]: clampChannel(parsed) }));
  };

  return (
    <fieldset className="component-color-control">
      <legend>{label}</legend>
      <div className="component-color-primary-row">
        <input
          aria-label={`${label} color picker`}
          type="color"
          value={shown}
          onChange={(event) => setPending(event.currentTarget.value)}
          onBlur={commitPending}
        />
        <output aria-label={`${label} hex value`}>
          {draft ?? value ?? (transparentDefault ? "Transparent" : "Automatic")}
        </output>
        <button
          type="button"
          disabled={!value}
          aria-label={`Reset ${label.toLowerCase()}`}
          title={
            transparentDefault
              ? "Remove the component background"
              : "Use the document ink color"
          }
          onClick={() => commitNow(undefined)}
        >
          Auto
        </button>
      </div>
      <div className="component-color-presets" aria-label={`${label} presets`}>
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="component-color-swatch"
            style={
              {
                "--component-swatch-color": preset.value,
              } as CSSProperties
            }
            aria-label={`Use ${preset.label} for ${label.toLowerCase()}`}
            aria-pressed={shown.toLowerCase() === preset.value}
            title={`${preset.label} · ${preset.value}`}
            onClick={() => commitNow(preset.value)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="component-rgb-inputs" aria-label={`${label} custom RGB`}>
        {(["r", "g", "b"] as const).map((channel) => (
          <label key={channel}>
            {channel.toUpperCase()}
            <input
              aria-label={`${label} ${
                channel === "r" ? "red" : channel === "g" ? "green" : "blue"
              }`}
              type="number"
              min="0"
              max="255"
              step="1"
              value={rgb[channel]}
              onChange={(event) =>
                updateChannel(channel, event.currentTarget.value)
              }
              onBlur={commitPending}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPending();
              }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ComponentStyleProperties({
  instance,
  onChange,
}: {
  instance: Instance;
  onChange: (styleOverride: InstanceStyleOverride | null) => void;
}) {
  const update = (
    key: keyof InstanceStyleOverride,
    value: string | undefined,
  ): void => {
    const next = { ...instance.styleOverride, [key]: value };
    if (value === undefined) delete next[key];
    onChange(Object.keys(next).length === 0 ? null : next);
  };

  return (
    <div className="property-card component-appearance-card">
      <div className="property-section-heading">Appearance</div>
      <small>
        Colors apply only to this component. Wires and document defaults stay
        unchanged.
      </small>
      <ColorOverrideControl
        label="Line / foreground"
        value={instance.styleOverride?.foreground}
        fallback="#000000"
        onChange={(value) => update("foreground", value)}
      />
      <ColorOverrideControl
        label="Background / fill"
        value={instance.styleOverride?.background}
        fallback="#ffffff"
        transparentDefault
        onChange={(value) => update("background", value)}
      />
    </div>
  );
}
