import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { requireRazaviCatalogSymbol } from "@icm/symbols";

import { ComponentPlacementPreview } from "./component-placement-preview";
import { SymbolArtwork } from "./symbol-artwork";

function expectDffPinNames(markup: string): void {
  expect(markup).toContain('data-pin-name="D"');
  expect(markup).toContain('data-pin-name="CK"');
  expect(markup).toContain('data-pin-name="Q"');
  expect(markup).toContain('data-pin-name="QBAR"');
  expect(markup).toContain("font-style:italic;font-weight:700");
  expect(markup).not.toContain(">QBAR</");
}

describe("SymbolArtwork pin-name previews", () => {
  const dff = requireRazaviCatalogSymbol("d-flip-flop");

  it("renders DFF pin names in the Library and Insert artwork", () => {
    const markup = renderToStaticMarkup(
      <SymbolArtwork symbol={dff} className="test-artwork" />,
    );

    expectDffPinNames(markup);
  });

  it("keeps visible pin names in a rotated placement preview", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <ComponentPlacementPreview
          styleProfileId="razavi-textbook-v1"
          symbolId={dff.id}
          symbol={dff}
          position={{ x: 100, y: 80 }}
          rotation={90}
        />
      </svg>,
    );

    expectDffPinNames(markup);
    expect(markup).toContain('transform="translate(100 80)"');
  });
});
