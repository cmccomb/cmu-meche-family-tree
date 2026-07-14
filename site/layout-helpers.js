(function attachFamilyTreeLayout(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FamilyTreeLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULTS = {
    pixelsPerNode: 24,
    minTimeSpan: 3600,
    maxTimeSpan: 14000,
    minYearGap: 7.5,
    maxYearGap: 20,
    lanePaddingX: 34,
    lanePaddingY: 18,
    minLaneScale: 0.82,
    maxLaneScale: 1,
    compactTargetWidth: 6200,
    fullTargetWidth: 12000,
    compactGraphLimit: 240,
    orientation: "vertical",
    horizontalTimeScale: 1.18,
    horizontalLaneScale: 0.86,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function finiteNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeNode(node, index) {
    return {
      id: String(node.id),
      name: String(node.name || node.id || ""),
      year: finiteNumber(node.year),
      x: finiteNumber(node.x, index * 180),
      y: finiteNumber(node.y, 0),
      width: Math.max(1, finiteNumber(node.width, 150)),
      height: Math.max(1, finiteNumber(node.height, 56)),
    };
  }

  function temporalConflict(left, right, config) {
    const horizontal = config.orientation === "horizontal";
    const timeScale = horizontal ? config.horizontalTimeScale : 1;
    const timeSize = horizontal
      ? (left.width + right.width) / 2 + config.lanePaddingX
      : (left.height + right.height) / 2 + config.lanePaddingY;
    return Math.abs(left.y - right.y) * timeScale < timeSize;
  }

  function laneGap(left, right, config) {
    const horizontal = config.orientation === "horizontal";
    const laneScale = horizontal ? config.horizontalLaneScale : 1;
    const laneSize = horizontal
      ? (left.height + right.height) / 2 + config.lanePaddingY
      : (left.width + right.width) / 2 + config.lanePaddingX;
    return laneSize / laneScale;
  }

  /**
   * Build a collision-free chronological layout while retaining the ordering
   * of the graph's regular layered layout. Years map linearly to the temporal
   * axis; only the cross-axis moves to open stable branch lanes.
   */
  function createTemporalLayout(rawNodes, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const nodes = rawNodes.map(normalizeNode);
    if (!nodes.length) return new Map();

    const nodesWithYears = nodes.filter((node) => node.year !== null);
    if (!nodesWithYears.length) {
      return new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    }

    const years = nodesWithYears.map((node) => node.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const yearRange = Math.max(1, maxYear - minYear);
    const targetHeight = clamp(
      nodes.length * config.pixelsPerNode,
      config.minTimeSpan,
      config.maxTimeSpan
    );
    const yearScale = clamp(
      targetHeight / yearRange,
      config.minYearGap,
      config.maxYearGap
    );
    const yearCenter = (minYear + maxYear) / 2;

    const minBaseX = Math.min(...nodes.map((node) => node.x));
    const maxBaseX = Math.max(...nodes.map((node) => node.x));
    const baseCenterX = (minBaseX + maxBaseX) / 2;
    const baseWidth = Math.max(1, maxBaseX - minBaseX);
    const targetWidth = nodes.length < config.compactGraphLimit
      ? config.compactTargetWidth
      : config.fullTargetWidth;
    const laneScale = clamp(
      targetWidth / baseWidth,
      config.minLaneScale,
      config.maxLaneScale
    );

    const ordered = nodes
      .map((node) => ({
        ...node,
        targetX: (node.x - baseCenterX) * laneScale,
        y: node.year === null ? node.y : (node.year - yearCenter) * yearScale,
      }))
      .sort((left, right) => (
        left.targetX - right.targetX
        || left.name.localeCompare(right.name)
        || left.id.localeCompare(right.id)
      ));

    // Project the regular-layout order onto collision-free temporal lanes.
    // Comparing every vertically-conflicting predecessor guarantees that
    // crowded adjacent years are separated without swapping branch order.
    ordered.forEach((node, index) => {
      let resolvedX = node.targetX;
      for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
        const previous = ordered[previousIndex];
        if (!temporalConflict(previous, node, config)) continue;
        resolvedX = Math.max(
          resolvedX,
          previous.resolvedX + laneGap(previous, node, config)
        );
      }
      node.resolvedX = resolvedX;
    });

    // Translation does not affect the spacing constraints. Centering on the
    // regular targets minimizes the overall cross-axis displacement.
    const meanDisplacement = ordered.reduce(
      (sum, node) => sum + node.resolvedX - node.targetX,
      0
    ) / ordered.length;

    return new Map(ordered.map((node) => [node.id, {
      x: node.resolvedX - meanDisplacement,
      y: node.y,
    }]));
  }

  function countNodeOverlaps(rawNodes, positions, options = {}) {
    const paddingX = finiteNumber(options.paddingX, 0);
    const paddingY = finiteNumber(options.paddingY, 0);
    const nodes = rawNodes.map(normalizeNode);
    let overlaps = 0;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      const leftPosition = positions.get(left.id);
      if (!leftPosition) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        const rightPosition = positions.get(right.id);
        if (!rightPosition) continue;
        const overlapsX = Math.abs(leftPosition.x - rightPosition.x)
          < (left.width + right.width) / 2 + paddingX;
        const overlapsY = Math.abs(leftPosition.y - rightPosition.y)
          < (left.height + right.height) / 2 + paddingY;
        if (overlapsX && overlapsY) overlaps += 1;
      }
    }
    return overlaps;
  }

  function orientation(a, b, c) {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 1e-9) return 0;
    return cross > 0 ? 1 : -1;
  }

  function segmentsCross(a, b, c, d) {
    return orientation(a, b, c) * orientation(a, b, d) < 0
      && orientation(c, d, a) * orientation(c, d, b) < 0;
  }

  function countEdgeCrossings(edges, positions) {
    let crossings = 0;
    for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
      const left = edges[leftIndex];
      const leftSource = positions.get(String(left.source));
      const leftTarget = positions.get(String(left.target));
      if (!leftSource || !leftTarget) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
        const right = edges[rightIndex];
        if (
          left.source === right.source
          || left.source === right.target
          || left.target === right.source
          || left.target === right.target
        ) continue;
        const rightSource = positions.get(String(right.source));
        const rightTarget = positions.get(String(right.target));
        if (!rightSource || !rightTarget) continue;
        if (segmentsCross(leftSource, leftTarget, rightSource, rightTarget)) crossings += 1;
      }
    }
    return crossings;
  }

  return {
    DEFAULTS,
    clamp,
    countEdgeCrossings,
    countNodeOverlaps,
    createTemporalLayout,
  };
});
