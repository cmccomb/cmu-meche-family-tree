(function attachFamilyTreeExport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FamilyTreeExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MAX_RASTER_SCALE = 4;
  const MAX_RASTER_DIMENSION = 16384;
  const MAX_RASTER_PIXELS = 48_000_000;
  const MAX_PDF_SIDE = 10_000;

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function exportFileName(format, date = new Date()) {
    const extension = String(format || "svg").toLowerCase();
    const stamp = date.toISOString().slice(0, 10);
    return `cmu-meche-family-tree-${stamp}.${extension}`;
  }

  function rasterDimensions(width, height, options = {}) {
    const sourceWidth = positiveNumber(width, 1);
    const sourceHeight = positiveNumber(height, 1);
    const maxScale = positiveNumber(options.maxScale, MAX_RASTER_SCALE);
    const maxDimension = positiveNumber(options.maxDimension, MAX_RASTER_DIMENSION);
    const maxPixels = positiveNumber(options.maxPixels, MAX_RASTER_PIXELS);
    const scale = Math.min(
      maxScale,
      maxDimension / sourceWidth,
      maxDimension / sourceHeight,
      Math.sqrt(maxPixels / (sourceWidth * sourceHeight))
    );
    return {
      scale,
      width: Math.max(1, Math.floor(sourceWidth * scale)),
      height: Math.max(1, Math.floor(sourceHeight * scale)),
    };
  }

  function pdfPageDimensions(width, height, options = {}) {
    const sourceWidth = positiveNumber(width, 1);
    const sourceHeight = positiveNumber(height, 1);
    const maxSide = positiveNumber(options.maxSide, MAX_PDF_SIDE);
    const scale = Math.min(1, maxSide / sourceWidth, maxSide / sourceHeight);
    return {
      scale,
      width: Math.max(1, sourceWidth * scale),
      height: Math.max(1, sourceHeight * scale),
      orientation: sourceWidth >= sourceHeight ? "landscape" : "portrait",
    };
  }

  return {
    MAX_PDF_SIDE,
    MAX_RASTER_DIMENSION,
    MAX_RASTER_PIXELS,
    MAX_RASTER_SCALE,
    exportFileName,
    pdfPageDimensions,
    rasterDimensions,
  };
});
