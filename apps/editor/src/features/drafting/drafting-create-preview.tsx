import type { Point } from "@icm/model";
import type { SchematicStyleProfile } from "@icm/derived";

import {
  normalizedRect,
  serializePolylinePoints,
} from "../../canvas/canvas-geometry";
import type { EditorTool } from "../../interaction/interaction-state";

export interface DraftingCreatePreviewProps {
  tool: EditorTool;
  start: Point;
  waypoints: Point[];
  hover: Point;
  snap: Point | null;
  styleProfile: SchematicStyleProfile;
}

/** Transient Canvas overlay for two-phase drafting creation. */
export function DraftingCreatePreview({
  tool,
  start,
  waypoints,
  hover,
  snap,
  styleProfile,
}: DraftingCreatePreviewProps) {
  const path = [start, ...waypoints, hover];
  const dx = hover.x - start.x;
  const dy = hover.y - start.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rectangle = normalizedRect(start, hover);
  const isRectangle = tool === "rectangle";
  const isCircle = tool === "circle";
  const showHead = tool === "arrow" && length > 1;
  const head = styleProfile.annotations.arrowHeadLength;
  const halfHeadWidth = styleProfile.annotations.arrowHeadWidth / 2;
  const nx = length === 0 ? 0 : (-dy / length) * halfHeadWidth;
  const ny = length === 0 ? 0 : (dx / length) * halfHeadWidth;
  const baseX = length === 0 ? hover.x : hover.x - (dx / length) * head;
  const baseY = length === 0 ? hover.y : hover.y - (dy / length) * head;
  const labelX = start.x + dx / 2;
  const labelY = start.y + dy / 2 - 8;

  return (
    <g data-testid="drafting-create-preview" pointerEvents="none">
      {isRectangle ? (
        <rect className="drafting-create-preview" {...rectangle} fill="none" />
      ) : isCircle ? (
        <circle
          className="drafting-create-preview"
          cx={start.x}
          cy={start.y}
          r={length}
          fill="none"
        />
      ) : (
        <polyline
          className="drafting-create-preview"
          points={serializePolylinePoints(path)}
          fill="none"
        />
      )}
      <circle
        className="drafting-create-anchor"
        cx={start.x}
        cy={start.y}
        r="3"
      />
      <circle
        className="drafting-create-anchor draft-create-anchor-end"
        cx={hover.x}
        cy={hover.y}
        r="3"
      />
      {!isRectangle &&
        !isCircle &&
        waypoints.map((point, index) => (
          <circle
            key={`draft-preview-vx-${index}`}
            className="drafting-create-anchor draft-create-anchor-vx"
            cx={point.x}
            cy={point.y}
            r="2.5"
          />
        ))}
      {showHead ? (
        <polygon
          className="drafting-create-head"
          points={`${hover.x},${hover.y} ${baseX + nx},${baseY + ny} ${baseX - nx},${baseY - ny}`}
        />
      ) : null}
      {snap ? (
        <circle
          className="drafting-create-snap"
          cx={snap.x}
          cy={snap.y}
          r="6"
        />
      ) : null}
      <text
        className="drafting-create-readout"
        x={labelX}
        y={labelY}
        textAnchor="middle"
      >
        {isRectangle
          ? `${Math.round(rectangle.width)} × ${Math.round(rectangle.height)}`
          : isCircle
            ? `r ${Math.round(length)}`
            : `${Math.round(length)} · ${Math.round(angle)}°`}
      </text>
    </g>
  );
}
