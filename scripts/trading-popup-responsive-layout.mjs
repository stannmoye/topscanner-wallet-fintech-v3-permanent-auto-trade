import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const stylesheet = readFileSync(
  new URL("../client/src/trading-experience.css", import.meta.url),
  "utf8"
);
const popupMarkup = `
  <div class="customer-portal">
    <section class="center-opportunity-toast opportunity-reference-popup eligible">
      <div class="reference-popup-ticker">USD LIVE</div>
      <header class="reference-popup-head">
        <div class="reference-popup-live">LIVE ARBITRAGE ALERT</div>
        <div class="reference-popup-head-actions"><button class="reference-popup-close">X</button></div>
      </header>
      <div class="reference-popup-asset">
        <div class="reference-popup-asset-icon">M</div>
        <div class="reference-popup-asset-copy">
          <strong>Meta Platforms</strong>
          <div><span class="reference-popup-symbol">META</span><span>Verified market asset</span><span>Cboe BZX Exchange</span><span>USD</span></div>
        </div>
      </div>
      <div class="reference-popup-metrics">
        <div><span>Required to invest</span><strong>$100.00</strong></div>
        <div><span>Amount to gain</span><strong>+$2.67</strong></div>
        <div><span>Profit</span><strong>2.67%</strong></div>
      </div>
      <div class="reference-popup-details">
        <div><span>Assigned package</span><strong>Assigned package</strong></div>
        <div><span>Package limits</span><strong>100</strong></div>
        <div><span>Platform fee</span><strong>15%</strong></div>
        <div><span>Amount deducted by platform</span><strong>$15</strong></div>
      </div>
      <div class="reference-popup-net"><div><span>Amount earned after deduction</span><small>Net profit credited after settlement</small></div><strong>$2.27</strong></div>
      <div class="reference-popup-route">
        <div class="reference-popup-provider-card">
          <span class="reference-popup-provider-flag" aria-label="United States flag">🇺🇸</span>
          <svg width="28" height="28"><circle cx="14" cy="14" r="12"/></svg>
          <div><span>Exchange provider · United States</span><strong>Cboe BZX Exchange</strong></div>
        </div>
        <div><svg width="26" height="26"><circle cx="13" cy="13" r="11"/></svg><div><span>Exchange route</span><strong>Informational → Cboe BZX</strong></div></div>
      </div>
      <div class="reference-popup-flow">
        <div>BUY Unavailable</div><div class="reference-popup-arrows">› › ›</div><div>SELL Unavailable</div>
        <div class="reference-popup-window"><span>Opportunity window</span><span>01:23</span></div><div class="reference-popup-drain"><i/></div>
      </div>
      <div class="reference-popup-wallet">
        <div><span>Combined available</span><strong>$33.30</strong></div>
        <div><span>Auto-locked capital</span><strong>$100.00</strong></div>
        <div><span>Auto-credit at settlement</span><strong>$102.67</strong></div>
      </div>
      <div class="reference-popup-warning">Insufficient available balance</div>
      <div class="reference-popup-actions">
        <button class="reference-popup-execute">Qualifying</button><button class="reference-popup-dismiss">Dismiss alert</button><button>View details</button>
      </div>
      <div class="reference-popup-disclaimer">Automatic trade lifecycle · Audit logged · Market snapshot.</div>
    </section>
  </div>`;

const viewportCases = [
  [320, 568, "small phone"],
  [360, 800, "phone"],
  [390, 844, "phone"],
  [414, 896, "large phone"],
  [420, 900, "phone breakpoint"],
  [421, 900, "mobile desktop"],
  [560, 900, "wide phone"],
  [561, 900, "tablet breakpoint"],
  [768, 1024, "tablet portrait"],
  [1024, 768, "tablet landscape"],
  [1280, 800, "laptop"],
  [1366, 768, "wide laptop"],
  [1440, 900, "desktop"],
  [1920, 1080, "wide desktop"],
  [844, 390, "phone landscape"],
  [1024, 600, "short desktop"],
  [390, 844, "Android phone emulation", 3, true],
  [800, 1280, "Android tablet emulation", 2, true],
];

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const [
    width,
    height,
    label,
    deviceScaleFactor = 1,
    isMobile = false,
  ] of viewportCases) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor,
      isMobile,
      hasTouch: isMobile,
      reducedMotion: "reduce",
    });
    try {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>html,body{margin:0;min-height:100%;background:#081322}*{box-sizing:border-box}</style><style>${stylesheet}</style></head><body>${popupMarkup}</body></html>`
      );
      const layout = await page.evaluate(() => {
        const popup = document.querySelector(".opportunity-reference-popup");
        const route = document.querySelector(".reference-popup-route");
        const flag = document.querySelector(".reference-popup-provider-flag");
        const actions = document.querySelector(".reference-popup-actions");
        const popupRect = popup.getBoundingClientRect();
        const flagRect = flag.getBoundingClientRect();
        const popupStyle = getComputedStyle(popup);
        const vhProbe = document.createElement("div");
        vhProbe.style.height = "100vh";
        const dvhProbe = document.createElement("div");
        dvhProbe.style.height = "100dvh";
        document.body.append(vhProbe, dvhProbe);
        const viewportUnits = {
          vh: vhProbe.getBoundingClientRect().height,
          dvh: dvhProbe.getBoundingClientRect().height,
        };
        vhProbe.remove();
        dvhProbe.remove();
        const glyphRange = document.createRange();
        glyphRange.selectNodeContents(flag);
        const glyphRect = glyphRange.getBoundingClientRect();
        return {
          popup: {
            left: popupRect.left,
            right: popupRect.right,
            top: popupRect.top,
            bottom: popupRect.bottom,
            scrollHeight: popup.scrollHeight,
            clientHeight: popup.clientHeight,
          },
          routeColumns:
            getComputedStyle(route).gridTemplateColumns.split(" ").length,
          flag: {
            left: flagRect.left,
            right: flagRect.right,
            top: flagRect.top,
            bottom: flagRect.bottom,
            width: flagRect.width,
            height: flagRect.height,
          },
          glyph: {
            left: glyphRect.left,
            right: glyphRect.right,
            top: glyphRect.top,
            bottom: glyphRect.bottom,
          },
          documentWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          clientHeight: document.documentElement.clientHeight,
          viewportUnits,
          maxHeight: popupStyle.maxHeight,
          actionsHeight: actions.getBoundingClientRect().height,
        };
      });

      assert.ok(
        layout.popup.left >= -0.5 && layout.popup.right <= width + 0.5,
        `${label}: popup exceeds horizontal viewport bounds: ${JSON.stringify(layout)}`
      );
      assert.ok(
        layout.popup.top >= -0.5 && layout.popup.bottom <= height + 0.5,
        `${label}: popup exceeds vertical viewport bounds: ${JSON.stringify(layout)}`
      );
      assert.ok(
        layout.documentWidth <= width,
        `${label}: page has horizontal overflow`
      );
      assert.ok(
        layout.glyph.left >= layout.flag.left &&
          layout.glyph.right <= layout.flag.right,
        `${label}: flag glyph exceeds its badge: ${JSON.stringify(layout)}`
      );
      assert.ok(
        layout.glyph.top >= layout.flag.top - 2 &&
          layout.glyph.bottom <= layout.flag.bottom + 2,
        `${label}: flag glyph exceeds its badge vertically: ${JSON.stringify(layout)}`
      );
      assert.equal(
        layout.routeColumns,
        width <= 420 ? 1 : 2,
        `${label}: unexpected route-card column count`
      );
      assert.ok(
        layout.actionsHeight > 0,
        `${label}: popup actions are missing`
      );

      if (
        height <= 600 &&
        layout.popup.scrollHeight > layout.popup.clientHeight
      ) {
        await page.locator(".opportunity-reference-popup").evaluate(element => {
          element.scrollTop = element.scrollHeight;
        });
        const actions = await page
          .locator(".reference-popup-actions")
          .boundingBox();
        assert.ok(
          actions.y + actions.height <= height + 1,
          `${label}: popup actions are not reachable by scrolling`
        );
      }

      console.log(
        `${width}x${height} ${label}: ok (${layout.routeColumns} route column${layout.routeColumns === 1 ? "" : "s"}, ${layout.flag.width}px flag badge)`
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
