const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  countEdgeCrossings,
  countNodeOverlaps,
  createTemporalLayout,
} = require("../site/layout-helpers");

function crowdedNodes(count = 18) {
  return Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`,
    name: `Person ${String(index).padStart(2, "0")}`,
    year: 2000 + (index % 3),
    x: index * 38,
    y: index * 120,
    width: 150,
    height: 56,
  }));
}

test("temporal layout keeps a linear chronological axis", () => {
  const nodes = [
    { id: "older", name: "Older", year: 1900, x: -100, y: 0, width: 140, height: 52 },
    { id: "middle", name: "Middle", year: 1950, x: 0, y: 100, width: 140, height: 52 },
    { id: "newer", name: "Newer", year: 2000, x: 100, y: 200, width: 140, height: 52 },
  ];

  const positions = createTemporalLayout(nodes);
  const firstGap = positions.get("middle").y - positions.get("older").y;
  const secondGap = positions.get("newer").y - positions.get("middle").y;

  assert.ok(firstGap > 0);
  assert.equal(firstGap, secondGap);
});

test("crowded adjacent years are separated without node overlap", () => {
  const nodes = crowdedNodes();
  const positions = createTemporalLayout(nodes);

  assert.equal(countNodeOverlaps(nodes, positions), 0);
});

test("horizontal temporal lanes account for unrotated card dimensions", () => {
  const nodes = crowdedNodes();
  const positions = createTemporalLayout(nodes, { orientation: "horizontal" });
  const horizontalPositions = new Map([...positions.entries()].map(([id, position]) => [id, {
    x: position.y * 1.18,
    y: position.x * 0.86,
  }]));

  assert.equal(countNodeOverlaps(nodes, horizontalPositions), 0);
});

test("temporal lanes preserve regular-layout cross-axis order", () => {
  const nodes = crowdedNodes();
  const positions = createTemporalLayout(nodes);
  const regularOrder = [...nodes].sort((left, right) => left.x - right.x).map((node) => node.id);
  const temporalOrder = [...nodes]
    .sort((left, right) => positions.get(left.id).x - positions.get(right.id).x)
    .map((node) => node.id);

  assert.deepEqual(temporalOrder, regularOrder);
});

test("edge crossing metric ignores shared endpoints and counts strict crossings", () => {
  const positions = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 100, y: 100 }],
    ["c", { x: 100, y: 0 }],
    ["d", { x: 0, y: 100 }],
    ["e", { x: 200, y: 100 }],
  ]);
  const edges = [
    { source: "a", target: "b" },
    { source: "c", target: "d" },
    { source: "b", target: "e" },
  ];

  assert.equal(countEdgeCrossings(edges, positions), 1);
});

test("the checked-in full graph has a collision-free temporal layout", () => {
  const dataPath = path.join(__dirname, "fixtures", "temporal-layout-833.json");
  const graph = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const nodes = graph.nodes;
  const positions = createTemporalLayout(nodes);
  const horizontalBase = createTemporalLayout(nodes, { orientation: "horizontal" });
  const horizontalPositions = new Map([...horizontalBase.entries()].map(([id, position]) => [id, {
    x: position.y * 1.18,
    y: position.x * 0.86,
  }]));

  assert.equal(countNodeOverlaps(nodes, positions), 0);
  assert.equal(countNodeOverlaps(nodes, horizontalPositions), 0);
  assert.ok(countEdgeCrossings(graph.edges, positions) <= 700);
  assert.ok(countEdgeCrossings(graph.edges, horizontalPositions) <= 700);
});
