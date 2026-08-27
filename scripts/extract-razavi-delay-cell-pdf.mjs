import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { cropRaster, decodePng, encodePng } from "./lib/png-io.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const expectedSourceSha256 =
  "8a5c1bb42a5e32a84cd6af53e2f43db79ea8f511552c913ec65d2caa1d90a028";
const pdfPage = 349;
const printedPage = 331;
const figure = "16.2(c)";
const outputJsonPath = resolve(referenceRoot, "delay-cell-vector-source.json");
const outputPngPath = resolve(referenceRoot, "delay-cell-reference.png");
const pdfPath = process.argv[process.argv.indexOf("--pdf") + 1];

if (!pdfPath || process.argv.indexOf("--pdf") < 0) {
  throw new Error(
    "Usage: node scripts/extract-razavi-delay-cell-pdf.mjs --pdf <data-converters.pdf>",
  );
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceBytes = await readFile(resolve(pdfPath));
const sourceSha256 = sha256(sourceBytes);
if (sourceSha256 !== expectedSourceSha256) {
  throw new Error(
    `Unexpected PDF SHA-256 ${sourceSha256}; expected ${expectedSourceSha256}`,
  );
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), "razavi-delay-cell-"));
try {
  const svgPath = resolve(temporaryRoot, "page.svg");
  const pngPrefix = resolve(temporaryRoot, "page");
  execFileSync(
    "pdftocairo",
    ["-f", `${pdfPage}`, "-l", `${pdfPage}`, "-svg", pdfPath, svgPath],
    { stdio: "inherit" },
  );
  const pageSvg = await readFile(svgPath, "utf8");

  // These signatures are the native PDF objects in printed-page 331,
  // Figure 16.2(c). They intentionally keep PDF extraction separate from the
  // screenshot-fidelity harness and make a source-edition change fail loudly.
  const signatures = [
    "2699.507325 3907.491789 L 3009.266983 3907.491789 L 3009.266983 4062.371618 L 2699.507325 4062.371618",
    'xlink:href="#glyph-13-1" x="281.793116" y="325.400273"',
    'xlink:href="#glyph-9-5" x="286.969738" y="324.635031"',
  ];
  for (const signature of signatures) {
    if (!pageSvg.includes(signature)) {
      throw new Error(
        `Missing expected page-331 vector signature: ${signature}`,
      );
    }
  }

  const source = {
    schemaVersion: 1,
    id: "razavi-textbook-delay-cell",
    kind: "pdf-vector-extract",
    source: {
      title: "Analysis and Design of Data Converters",
      sha256: sourceSha256,
      pdfPage,
      printedPage,
      figure,
    },
    selection: {
      method: "direct-delay-block-vector-normalization",
      scope:
        "Figure 16.2(c) delay-stage rectangle, horizontal lead segments, and Delta-T glyph outlines",
      nativeObjectCount: 5,
      nativeObjects: [
        {
          objectType: "rect",
          x0: 269.95,
          top: 313.7617,
          x1: 300.9262,
          bottom: 329.25,
          linewidth: 1.2907,
          fill: false,
          stroke: true,
        },
        {
          objectType: "line-segment",
          from: { x: 259.624, top: 321.506007 },
          to: { x: 269.95, top: 321.506007 },
          linewidth: 0.6453,
          sourcePathContinuesOutsideSelection: true,
        },
        {
          objectType: "line-segment",
          from: { x: 300.925989, top: 321.505995 },
          to: { x: 311.251989, top: 321.505995 },
          linewidth: 0.6453,
          sourcePathContinuesOutsideSelection: true,
        },
        {
          objectType: "glyph-outline",
          glyph: "Delta",
          font: "Symbol",
          use: { x: 281.793116, y: 325.400273 },
          path: "M 3.03125 -6.390625 L 0.0625 0 L 5.640625 0 Z M 2.6875 -4.796875 L 4.484375 -0.453125 L 0.671875 -0.453125 Z M 2.6875 -4.796875",
        },
        {
          objectType: "glyph-outline",
          glyph: "T",
          font: "Arial Bold Italic",
          use: { x: 286.969738, y: 324.635031 },
          path: "M 2.734375 0 L 1.59375 0 L 2.546875 -4.609375 L 0.921875 -4.609375 L 1.125 -5.53125 L 5.484375 -5.53125 L 5.296875 -4.609375 L 3.6875 -4.609375 Z M 2.734375 0",
        },
      ],
    },
    normalization: {
      sourceOriginPdf: { x: 285.4381, y: 321.50585 },
      logicalUnitsPerPdfPoint: 1.162156,
      pinAnchorsLogical: [
        { name: "A", x: -30, y: 0 },
        { name: "Y", x: 30, y: 0 },
      ],
      strokeMapping: {
        normal: { sourcePdfPt: 0.6453, targetRole: "normal" },
        body: { sourcePdfPt: 1.2907, targetRole: "emphasis" },
      },
      symbolDefinition: {
        schemaVersion: 1,
        id: "delay-cell",
        name: "Delay Cell",
        viewBox: { x: -34, y: -14, width: 68, height: 28 },
        pins: [
          {
            name: "A",
            role: "input",
            at: { x: -30, y: 0 },
            direction: "west",
            presentation: { visibility: "visible", leadLength: 12 },
          },
          {
            name: "Y",
            role: "output",
            at: { x: 30, y: 0 },
            direction: "east",
            presentation: { visibility: "visible", leadLength: 12 },
          },
        ],
        primitives: [
          {
            kind: "line",
            from: { x: -30, y: 0 },
            to: { x: -18, y: 0 },
            style: {
              strokeRole: "normal",
              lineCap: "butt",
              lineJoin: "miter",
            },
          },
          {
            kind: "path",
            data: "M -18 -9 L 18 -9 L 18 9 L -18 9 Z",
            style: {
              strokeRole: "emphasis",
              lineCap: "butt",
              lineJoin: "miter",
              miterLimit: 4,
            },
          },
          {
            kind: "line",
            from: { x: 18, y: 0 },
            to: { x: 30, y: 0 },
            style: {
              strokeRole: "normal",
              lineCap: "butt",
              lineJoin: "miter",
            },
          },
          {
            kind: "polygon",
            points: [
              { x: -0.713254, y: -2.900975 },
              { x: -1.112745, y: -1.04879 },
              { x: -3.455215, y: 3.999324 },
              { x: -4.163404, y: 4.525925 },
            ],
            fill: "foreground",
            stroke: "none",
          },
          {
            kind: "polygon",
            points: [
              { x: -0.713254, y: -2.900975 },
              { x: 2.319245, y: 4.525925 },
              { x: 0.975503, y: 3.999324 },
              { x: -1.112745, y: -1.04879 },
            ],
            fill: "foreground",
            stroke: "none",
          },
          {
            kind: "polygon",
            points: [
              { x: -4.163404, y: 4.525925 },
              { x: -3.455215, y: 3.999324 },
              { x: 0.975503, y: 3.999324 },
              { x: 2.319245, y: 4.525925 },
            ],
            fill: "foreground",
            stroke: "none",
          },
          {
            kind: "polygon",
            points: [
              { x: 4.957771, y: 3.636595 },
              { x: 3.632187, y: 3.636595 },
              { x: 4.739867, y: -1.720216 },
              { x: 2.851364, y: -1.720216 },
              { x: 3.087427, y: -2.791578 },
              { x: 8.153699, y: -2.791578 },
              { x: 7.935794, y: -1.720216 },
              { x: 6.06545, y: -1.720216 },
            ],
            fill: "foreground",
            stroke: "none",
          },
        ],
        variants: [],
      },
    },
    derivation: {
      pinExtension:
        "the two native horizontal lead segments are extended collinearly to x=+/-30 electrical anchors",
      semantics:
        "A/Y pin identity is reconstructed explicitly; timing and netlist behavior remain intentionally unspecified",
      internalMark:
        "Delta-T is stored as the two source-PDF glyph outlines, not as a runtime font dependency or annotation",
    },
    rasterWitness: {
      kind: "source-pdf-crop",
      sourcePdfPage: pdfPage,
      dpi: 200.820546,
      pixels: { width: 164, height: 66 },
      pixelsPerLogical: 2.4,
      originPx: { x: 82.136598, y: 38.735838 },
      window: {
        width: 68.333333,
        height: 27.5,
        minX: -34.223583,
        minY: -16.139933,
      },
      rotation: 0,
      sourceCropPx: { x: 714, y: 858 },
      assetPath: "delay-cell-reference.png",
      threshold: 160,
    },
  };

  const jsonSource = `${await format(JSON.stringify(source, null, 2), {
    parser: "json",
  })}`;
  await writeFile(outputJsonPath, jsonSource, "utf8");

  execFileSync(
    "pdftocairo",
    [
      "-f",
      `${pdfPage}`,
      "-l",
      `${pdfPage}`,
      "-singlefile",
      "-png",
      "-r",
      `${source.rasterWitness.dpi}`,
      pdfPath,
      pngPrefix,
    ],
    { stdio: "inherit" },
  );
  const page = await decodePng(await readFile(`${pngPrefix}.png`));
  const { x, y } = source.rasterWitness.sourceCropPx;
  const { width, height } = source.rasterWitness.pixels;
  const crop = cropRaster(page, x, y, width, height);
  // Source PDF pages are opaque; keep the witness explicitly opaque as well.
  for (let index = 3; index < crop.data.length; index += 4) {
    crop.data[index] = 255;
  }
  await writeFile(outputPngPath, await encodePng(crop));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "Extracted page-331 Razavi delay-cell vector evidence and raster witness",
);
