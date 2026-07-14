const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  exportFileName,
  pdfPageDimensions,
  rasterDimensions,
} = require("../site/export-helpers");

test("export filenames include a stable date and requested extension", () => {
  const date = new Date("2026-07-14T12:00:00Z");
  assert.equal(exportFileName("SVG", date), "cmu-meche-family-tree-2026-07-14.svg");
  assert.equal(exportFileName("png", date), "cmu-meche-family-tree-2026-07-14.png");
});

test("small PNG exports render at four times source resolution", () => {
  assert.deepEqual(rasterDimensions(1200, 800), {
    scale: 4,
    width: 4800,
    height: 3200,
  });
});

test("large PNG exports stay inside dimension and pixel budgets", () => {
  const dimensions = rasterDimensions(14000, 9000);
  assert.ok(dimensions.width <= 16384);
  assert.ok(dimensions.height <= 16384);
  assert.ok(dimensions.width * dimensions.height <= 48_000_000);
  assert.ok(dimensions.scale < 1);
});

test("PDF pages retain aspect ratio inside the vector page limit", () => {
  const dimensions = pdfPageDimensions(20000, 5000);
  assert.equal(dimensions.width, 10000);
  assert.equal(dimensions.height, 2500);
  assert.equal(dimensions.orientation, "landscape");
});

test("site markup exposes SVG, PNG, and PDF export controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "site", "index.html"), "utf8");
  for (const format of ["svg", "png", "pdf"]) {
    assert.match(html, new RegExp(`data-export-format=["']${format}["']`));
  }
});
