#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const ELK = require("elkjs");

const DEFAULT_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "SPLINES",
  "elk.spacing.nodeNode": "52",
  "elk.layered.spacing.nodeNodeBetweenLayers": "96",
  "elk.layered.spacing.edgeNodeBetweenLayers": "28",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
  "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.thoroughness": "30",
  "elk.layered.cycleBreaking.strategy": "GREEDY",
};

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function graphFromRequest(request) {
  const children = request.nodes.map((node) => {
    return {
      id: node.id,
      width: Number(node.width),
      height: Number(node.height),
      layoutOptions: {},
    };
  });

  const edges = request.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  return {
    id: "root",
    layoutOptions: { ...DEFAULT_LAYOUT_OPTIONS, ...(request.layoutOptions || {}) },
    children,
    edges,
  };
}

function centeredNodes(layout) {
  const nodes = layout.children || [];
  const centers = nodes.map((node) => ({
    id: node.id,
    x: Number(node.x || 0) + Number(node.width || 0) / 2,
    y: Number(node.y || 0) + Number(node.height || 0) / 2,
    width: Number(node.width || 0),
    height: Number(node.height || 0),
  }));
  if (!centers.length) return centers;

  const minX = Math.min(...centers.map((node) => node.x - node.width / 2));
  const maxX = Math.max(...centers.map((node) => node.x + node.width / 2));
  const minY = Math.min(...centers.map((node) => node.y - node.height / 2));
  const maxY = Math.max(...centers.map((node) => node.y + node.height / 2));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return centers.map((node) => ({
    ...node,
    x: node.x - centerX,
    y: node.y - centerY,
  }));
}

async function main() {
  const request = JSON.parse(readStdin());
  if (!Array.isArray(request.nodes) || !Array.isArray(request.edges)) {
    throw new Error("ELK layout request must include nodes and edges arrays.");
  }

  const elk = new ELK();
  const layout = await elk.layout(graphFromRequest(request));
  const nodes = centeredNodes(layout);
  const width = Number(layout.width || 0);
  const height = Number(layout.height || 0);
  process.stdout.write(JSON.stringify({ width, height, nodes }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
