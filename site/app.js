(() => {
  const DATA_URL = "graph-data.json";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLOR_BUCKET_LIMIT = 18;
  const CMU_BUCKET = "CMU";
  const OTHER_BUCKET = "Other";
  const COLOR_MODES = new Set(["category", "university", "country"]);

  const categoryColors = {
    "cmu-faculty": "#b00",
    "alumni": "#ffffff",
    "unknown-lineage": "#3e8c69",
    "missing-advisor": "#c28a16",
    "follow-up": "#d45f16",
  };

  const nodePalette = {
    "cmu-faculty": { fill: "#b00", border: "#ffffff", text: "#ffffff" },
    "alumni": { fill: "#ffffff", border: "#cbd1d8", text: "#1c1f23" },
    "unknown-lineage": { fill: "#3e8c69", border: "#ffffff", text: "#ffffff" },
    "missing-advisor": { fill: "#f6d486", border: "#9b6810", text: "#1c1f23" },
    "follow-up": { fill: "#d45f16", border: "#ffffff", text: "#ffffff" },
  };

  const bucketPalette = [
    "#2f6f9f",
    "#3e8c69",
    "#8f5aa3",
    "#c28a16",
    "#d45f16",
    "#247d8f",
    "#7b6d4f",
    "#a14f76",
    "#5f7f3f",
    "#8d6b2f",
    "#4b7f52",
    "#b84f3e",
    "#607d9c",
    "#9b5f8d",
    "#2f8f7f",
    "#cc7a00",
    "#6d7a33",
    "#6574c4",
  ];

  const specialBucketColors = {
    [CMU_BUCKET]: "#bb0000",
    [OTHER_BUCKET]: "#dfe3e8",
  };

  const els = {
    appShell: document.getElementById("appShell"),
    cy: document.getElementById("cy"),
    loading: document.getElementById("loadingOverlay"),
    search: document.getElementById("searchInput"),
    peopleOptions: document.getElementById("peopleOptions"),
    searchResults: document.getElementById("searchResults"),
    colorModeInputs: [...document.querySelectorAll('input[name="colorMode"]')],
    chronologyToggle: document.getElementById("chronologyToggle"),
    fitButton: document.getElementById("fitButton"),
    focusButton: document.getElementById("focusButton"),
    pathButton: document.getElementById("pathButton"),
    shareButton: document.getElementById("shareButton"),
    visibleCount: document.getElementById("visibleCount"),
    modeLabel: document.getElementById("modeLabel"),
    nodeCount: document.getElementById("nodeCount"),
    edgeCount: document.getElementById("edgeCount"),
    facultyCount: document.getElementById("facultyCount"),
    miniMap: document.getElementById("miniMap"),
    legend: document.getElementById("legend"),
    emptyProfile: document.getElementById("emptyProfile"),
    profileContent: document.getElementById("profileContent"),
    profileAvatar: document.getElementById("profileAvatar"),
    profileName: document.getElementById("profileName"),
    profileMeta: document.getElementById("profileMeta"),
    profileTags: document.getElementById("profileTags"),
    advisorList: document.getElementById("advisorList"),
    studentList: document.getElementById("studentList"),
    traceButton: document.getElementById("traceButton"),
    focusBranchButton: document.getElementById("focusBranchButton"),
    relayoutLineageButton: document.getElementById("relayoutLineageButton"),
    pathDialog: document.getElementById("pathDialog"),
    pathFrom: document.getElementById("pathFrom"),
    pathTo: document.getElementById("pathTo"),
    runPathButton: document.getElementById("runPathButton"),
    pathStatus: document.getElementById("pathStatus"),
  };

  const state = {
    graph: null,
    cy: null,
    selectedId: "",
    query: "",
    focusId: "",
    colorMode: "category",
    chronology: false,
    lineageRelayoutId: "",
  };

  const model = {
    peopleById: new Map(),
    peopleByName: new Map(),
    incoming: new Map(),
    outgoing: new Map(),
    adjacency: new Map(),
    edgeByPair: new Map(),
    rootIds: [],
    miniTransform: null,
    chronologyRange: null,
    colorBuckets: { university: [], country: [] },
    colorBucketMaps: { university: new Map(), country: new Map() },
  };

  let filterTimer = 0;
  let miniFrame = 0;

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value || 0);
  }

  function numericChronologyYear(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const year = Number(value);
    return Number.isFinite(year) ? year : null;
  }

  function initials(name) {
    const parts = String(name || "").split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "ME";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function compactMeta(person) {
    return [person.role, person.yearLabel].filter(Boolean).join(" / ");
  }

  function searchableText(person) {
    return [
      person.name,
      person.title,
      person.university,
      person.universityLabel,
      person.countryLabel,
      person.role,
      person.era,
      person.categoryLabel,
      person.yearLabel,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function edgeKey(a, b) {
    return `${a}::${b}`;
  }

  function textColorForBackground(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!match) return "#1c1f23";
    const r = parseInt(match[1], 16);
    const g = parseInt(match[2], 16);
    const b = parseInt(match[3], 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.58 ? "#1c1f23" : "#ffffff";
  }

  function isCmuUniversity(label) {
    return /\bcmu\b|carnegie mellon/i.test(String(label || ""));
  }

  function universityBucketSource(person) {
    const label = person.universityLabel || "Unknown university";
    if (isCmuUniversity(label)) return CMU_BUCKET;
    if (label === "Unknown university") return OTHER_BUCKET;
    return label;
  }

  function countryBucketSource(person) {
    const label = person.countryLabel || "Unknown country";
    if (label === "Unknown country") return OTHER_BUCKET;
    return label;
  }

  function incrementCount(counts, label) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  function sortedCounts(counts) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function bucketColor(label, index) {
    return specialBucketColors[label] || bucketPalette[index % bucketPalette.length];
  }

  function buildBucketEntries(graph, sourceForPerson, { includeCmu = false } = {}) {
    const counts = new Map();
    graph.nodes.forEach((person) => incrementCount(counts, sourceForPerson(person)));

    const entries = [];
    let paletteIndex = 0;
    let covered = 0;

    if (includeCmu) {
      const cmuCount = counts.get(CMU_BUCKET) || 0;
      entries.push({ label: CMU_BUCKET, count: cmuCount, color: bucketColor(CMU_BUCKET, paletteIndex) });
      covered += cmuCount;
      counts.delete(CMU_BUCKET);
    }

    const otherKnownCount = counts.get(OTHER_BUCKET) || 0;
    counts.delete(OTHER_BUCKET);

    sortedCounts(counts).slice(0, COLOR_BUCKET_LIMIT).forEach(([label, count]) => {
      entries.push({ label, count, color: bucketColor(label, paletteIndex) });
      covered += count;
      paletteIndex += 1;
    });

    entries.push({
      label: OTHER_BUCKET,
      count: Math.max(0, graph.nodes.length - covered),
      color: bucketColor(OTHER_BUCKET, paletteIndex),
      includesUnknown: otherKnownCount > 0,
    });
    return entries;
  }

  function buildColorBuckets(graph) {
    model.colorBuckets.university = buildBucketEntries(graph, universityBucketSource, { includeCmu: true });
    model.colorBuckets.country = buildBucketEntries(graph, countryBucketSource);
    model.colorBucketMaps.university = new Map(model.colorBuckets.university.map((entry) => [entry.label, entry]));
    model.colorBucketMaps.country = new Map(model.colorBuckets.country.map((entry) => [entry.label, entry]));
  }

  function bucketEntry(mode, label) {
    const map = model.colorBucketMaps[mode];
    if (!map) return null;
    return map.get(label) || map.get(OTHER_BUCKET) || null;
  }

  function colorsForPerson(person) {
    if (state.colorMode === "university" || state.colorMode === "country") {
      const label = state.colorMode === "university" ? person.universityColorBucket : person.countryColorBucket;
      const entry = bucketEntry(state.colorMode, label);
      const fill = entry ? entry.color : specialBucketColors[OTHER_BUCKET];
      const isOther = !entry || entry.label === OTHER_BUCKET;
      return {
        fill,
        border: isOther ? "#aeb7c2" : "#ffffff",
        text: textColorForBackground(fill),
      };
    }
    return nodePalette[person.category] || nodePalette.alumni;
  }

  function resolvePersonId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (model.peopleById.has(raw)) return raw;
    return model.peopleByName.get(raw.toLowerCase()) || "";
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    state.selectedId = params.get("person") || "";
    state.query = params.get("q") || "";
    state.focusId = params.get("focus") || "";
    state.colorMode = COLOR_MODES.has(params.get("color")) ? params.get("color") : "category";
    state.chronology = params.get("chrono") === "1";
  }

  function writeUrlState() {
    const params = new URLSearchParams();
    if (state.selectedId) params.set("person", state.selectedId);
    if (state.query) params.set("q", state.query);
    if (state.focusId) params.set("focus", state.focusId);
    if (state.colorMode !== "category") params.set("color", state.colorMode);
    if (state.chronology) params.set("chrono", "1");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function validateGraph(graph) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new Error("Graph data is missing nodes or edges.");
    }
  }

  function buildModel(graph) {
    model.peopleById.clear();
    model.peopleByName.clear();
    model.incoming.clear();
    model.outgoing.clear();
    model.adjacency.clear();
    model.edgeByPair.clear();
    model.rootIds = Array.isArray(graph.roots) ? graph.roots : [];
    const chronologyYears = graph.nodes
      .map((person) => numericChronologyYear(person.chronologyYear))
      .filter((year) => year !== null);
    const minYear = Math.min(...chronologyYears);
    const maxYear = Math.max(...chronologyYears);
    model.chronologyRange = chronologyYears.length
      ? { min: minYear, max: maxYear, center: (minYear + maxYear) / 2, scale: 10 }
      : null;
    buildColorBuckets(graph);

    graph.nodes.forEach((person) => {
      const universityEntry = bucketEntry("university", universityBucketSource(person));
      const countryEntry = bucketEntry("country", countryBucketSource(person));
      person.universityColorBucket = universityEntry ? universityEntry.label : OTHER_BUCKET;
      person.countryColorBucket = countryEntry ? countryEntry.label : OTHER_BUCKET;
      person.searchText = searchableText(person);
      model.peopleById.set(person.id, person);
      model.peopleByName.set(person.name.toLowerCase(), person.id);
      model.incoming.set(person.id, []);
      model.outgoing.set(person.id, []);
      model.adjacency.set(person.id, new Set());
    });

    graph.edges.forEach((edge) => {
      if (!model.peopleById.has(edge.source) || !model.peopleById.has(edge.target)) return;
      model.outgoing.get(edge.source).push(edge);
      model.incoming.get(edge.target).push(edge);
      model.adjacency.get(edge.source).add(edge.target);
      model.adjacency.get(edge.target).add(edge.source);
      model.edgeByPair.set(edgeKey(edge.source, edge.target), edge.id);
      model.edgeByPair.set(edgeKey(edge.target, edge.source), edge.id);
    });
  }

  function cytoscapeElements(graph) {
    const nodes = graph.nodes.map((person) => {
      const degree = Number(person.degree || 0);
      const isFaculty = person.category === "cmu-faculty";
      const boxWidth = Math.max(isFaculty ? 148 : 132, Math.min(172, 124 + Math.sqrt(degree + 1) * 11));
      const boxHeight = isFaculty ? 58 : 52;
      const palette = colorsForPerson(person);
      const layout = person.layout || {};
      const x = Number(layout.x);
      const y = Number(layout.y);
      const position = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
      return {
        data: {
          ...person,
          label: `${person.name}\n${person.yearLabel || ""}`,
          boxWidth,
          boxHeight,
          labelMaxWidth: boxWidth - 18,
          fillColor: palette.fill,
          borderColor: palette.border,
          labelColor: palette.text,
        },
        position,
      };
    });

    const edges = graph.edges.map((edge) => ({
      data: {
        ...edge,
        label: "advisor",
      },
    }));

    return [...nodes, ...edges];
  }

  function createCy(graph) {
    state.cy = cytoscape({
      container: els.cy,
      elements: cytoscapeElements(graph),
      minZoom: 0.08,
      maxZoom: 3.2,
      selectionType: "single",
      boxSelectionEnabled: false,
      style: [
        {
          selector: "node",
          style: {
            shape: "round-rectangle",
            width: "data(boxWidth)",
            height: "data(boxHeight)",
            "background-color": "data(fillColor)",
            "border-width": 2.5,
            "border-color": "data(borderColor)",
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "data(labelMaxWidth)",
            "text-valign": "center",
            "text-halign": "center",
            color: "data(labelColor)",
            "font-family": "Inter, system-ui, sans-serif",
            "font-size": 10,
            "font-weight": "bold",
            "line-height": 1.15,
            "text-outline-width": 0,
            "min-zoomed-font-size": 7,
            "overlay-padding": 6,
            "transition-property": "background-color, border-color, opacity, width, height",
            "transition-duration": reducedMotion ? 0 : 160,
          },
        },
        {
          selector: 'node[category = "cmu-faculty"]',
          style: {
            "font-size": 10.5,
            "font-weight": "bold",
          },
        },
        {
          selector: 'node[category = "unknown-lineage"]',
          style: { "border-width": 2.5 },
        },
        {
          selector: 'node[category = "missing-advisor"]',
          style: { "border-width": 2.5 },
        },
        {
          selector: 'node[category = "follow-up"]',
          style: { "border-width": 2.5 },
        },
        {
          selector: "edge",
          style: {
            width: 1.25,
            "curve-style": "straight",
            "line-color": "#a6b1bd",
            "target-arrow-color": "#a6b1bd",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.7,
            opacity: 0.64,
            "transition-property": "line-color, opacity, width",
            "transition-duration": reducedMotion ? 0 : 160,
          },
        },
        {
          selector: ".is-hidden",
          style: { display: "none" },
        },
        {
          selector: ".selected",
          style: {
            "border-color": "#111318",
            "border-width": 4,
            "z-index": 30,
          },
        },
        {
          selector: ".lineage, .path-node",
          style: {
            "border-color": "#111318",
            "border-width": 3,
            "z-index": 20,
          },
        },
        {
          selector: "edge.lineage, edge.path-edge",
          style: {
            width: 3,
            "line-color": "#111318",
            "target-arrow-color": "#111318",
            opacity: 0.95,
            "z-index": 10,
          },
        },
        {
          selector: ".faded",
          style: {
            opacity: 0.12,
            "text-opacity": 0.08,
          },
        },
      ],
    });

    state.cy.on("tap", "node", (event) => {
      selectPerson(event.target.id(), { center: false });
    });

    state.cy.on("tap", (event) => {
      if (event.target === state.cy) {
        clearElementHighlights();
      }
    });

    state.cy.on("pan zoom layoutstop", scheduleMiniMap);
  }

  function collectionFromIds(ids) {
    return ids.reduce((collection, id) => collection.union(state.cy.$id(id)), state.cy.collection());
  }

  function visibleElements() {
    return state.cy.elements().not(".is-hidden");
  }

  function visibleNodes() {
    return state.cy.nodes().not(".is-hidden");
  }

  function visibleRootCollection() {
    const roots = model.rootIds
      .map((id) => state.cy.$id(id))
      .filter((node) => node.length && !node.hasClass("is-hidden"));
    if (roots.length === 0) return undefined;
    return roots.reduce((collection, node) => collection.union(node), state.cy.collection());
  }

  function nodeLayoutPosition(node) {
    const layout = node.data("layout") || {};
    const x = Number(layout.x);
    const y = Number(layout.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function chronologyLayoutPosition(node) {
    const base = nodeLayoutPosition(node) || node.position();
    const range = model.chronologyRange;
    const year = numericChronologyYear(node.data("chronologyYear"));
    if (!range || year === null) return base;
    return {
      x: base.x,
      y: (year - range.center) * range.scale,
    };
  }

  function activeLayoutPosition(node) {
    return state.chronology ? chronologyLayoutPosition(node) : nodeLayoutPosition(node);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function layoutPositionFromBase(node, basePositions) {
    return basePositions && basePositions.has(node.id())
      ? basePositions.get(node.id())
      : nodeLayoutPosition(node) || node.position();
  }

  function visibleConnections(nodes) {
    const nodeIds = new Set(nodes.map((node) => node.id()));
    const connections = new Map(nodes.map((node) => [node.id(), new Set()]));
    visibleElements().edges().forEach((edge) => {
      const source = edge.data("source");
      const target = edge.data("target");
      if (!nodeIds.has(source) || !nodeIds.has(target)) return;
      connections.get(source).add(target);
      connections.get(target).add(source);
    });
    return connections;
  }

  function resolveHorizontalPositions(items, minGap) {
    const ordered = [...items].sort((a, b) => a.target - b.target || a.name.localeCompare(b.name));
    const clusters = ordered.map((item) => ({ items: [item], targetSum: item.target }));

    function center(cluster) {
      return cluster.targetSum / cluster.items.length;
    }

    function bounds(cluster) {
      const halfWidth = minGap * (cluster.items.length - 1) / 2;
      const clusterCenter = center(cluster);
      return [clusterCenter - halfWidth, clusterCenter + halfWidth];
    }

    let index = 0;
    while (index < clusters.length - 1) {
      const left = clusters[index];
      const right = clusters[index + 1];
      const [, leftRight] = bounds(left);
      const [rightLeft] = bounds(right);
      if (leftRight + minGap > rightLeft) {
        left.items.push(...right.items);
        left.targetSum += right.targetSum;
        clusters.splice(index + 1, 1);
        index = Math.max(0, index - 1);
      } else {
        index += 1;
      }
    }

    const positions = new Map();
    clusters.forEach((cluster) => {
      const start = center(cluster) - minGap * (cluster.items.length - 1) / 2;
      cluster.items
        .sort((a, b) => a.target - b.target || a.name.localeCompare(b.name))
        .forEach((item, itemIndex) => {
          positions.set(item.id, start + itemIndex * minGap);
        });
    });
    return positions;
  }

  function chronologicalLayoutPositions(nodes, basePositions = null) {
    const withYears = nodes
      .map((node) => ({ node, year: numericChronologyYear(node.data("chronologyYear")) }))
      .filter((item) => item.year !== null);
    if (!withYears.length) {
      return basePositions || new Map(nodes.map((node) => [node.id(), nodeLayoutPosition(node) || node.position()]));
    }

    const years = withYears.map((item) => item.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const yearRange = Math.max(1, maxYear - minYear);
    const targetHeight = clamp(nodes.length * 15, 2200, 9000);
    const yScale = clamp(targetHeight / yearRange, 4.5, 12);
    const yearCenter = (minYear + maxYear) / 2;

    const baseById = new Map();
    nodes.forEach((node) => {
      baseById.set(node.id(), layoutPositionFromBase(node, basePositions));
    });

    const baseXs = [...baseById.values()].map((position) => position.x);
    const minBaseX = Math.min(...baseXs);
    const maxBaseX = Math.max(...baseXs);
    const baseCenterX = (minBaseX + maxBaseX) / 2;
    const baseWidth = Math.max(1, maxBaseX - minBaseX);
    const targetWidth = clamp(nodes.length * 20, nodes.length < 240 ? 1800 : 4200, nodes.length < 240 ? 5600 : 7600);
    const xScale = Math.min(1, targetWidth / baseWidth);
    const connections = visibleConnections(nodes);

    const positions = new Map();
    nodes.forEach((node) => {
      const base = baseById.get(node.id());
      const year = numericChronologyYear(node.data("chronologyYear"));
      positions.set(node.id(), {
        x: (base.x - baseCenterX) * xScale,
        y: year === null ? base.y : (year - yearCenter) * yScale,
      });
    });

    for (let pass = 0; pass < 3; pass += 1) {
      const nextX = new Map();
      nodes.forEach((node) => {
        const neighborXs = [...(connections.get(node.id()) || [])]
          .map((id) => positions.get(id))
          .filter(Boolean)
          .map((position) => position.x);
        const current = positions.get(node.id());
        if (!neighborXs.length) {
          nextX.set(node.id(), current.x);
          return;
        }
        const neighborAverage = neighborXs.reduce((sum, x) => sum + x, 0) / neighborXs.length;
        nextX.set(node.id(), current.x * 0.68 + neighborAverage * 0.32);
      });
      nextX.forEach((x, id) => {
        positions.get(id).x = x;
      });
    }

    const bands = new Map();
    nodes.forEach((node) => {
      const position = positions.get(node.id());
      const key = Math.round(position.y / 68);
      if (!bands.has(key)) bands.set(key, []);
      bands.get(key).push({
        id: node.id(),
        name: node.data("name") || node.id(),
        target: position.x,
      });
    });
    bands.forEach((items) => {
      const resolved = resolveHorizontalPositions(items, 150);
      resolved.forEach((x, id) => {
        positions.get(id).x = x;
      });
    });

    const placed = [];
    nodes
      .slice()
      .sort((a, b) => {
        const aPosition = positions.get(a.id());
        const bPosition = positions.get(b.id());
        return aPosition.y - bPosition.y || aPosition.x - bPosition.x || a.data("name").localeCompare(b.data("name"));
      })
      .forEach((node) => {
        const position = positions.get(node.id());
        const shiftStep = 165;
        const shifts = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5].map((slot) => slot * shiftStep);
        const shift = shifts.find((candidate) => (
          placed.every((other) => (
            Math.abs(other.y - position.y) >= 58 || Math.abs(other.x - (position.x + candidate)) >= 146
          ))
        )) || 0;
        position.x += shift;
        placed.push(position);
      });

    return positions;
  }

  function preparedLayoutPositions(nodes) {
    const nodeArray = nodes.toArray();
    const basePositions = state.lineageRelayoutId ? lineageLayoutPositions(nodeArray) : null;
    if (state.chronology) return chronologicalLayoutPositions(nodeArray, basePositions);
    return basePositions;
  }

  function hasPresetLayout(nodes) {
    return Boolean(
      state.graph &&
      state.graph.meta &&
      state.graph.meta.layout &&
      nodes.length > 0 &&
      nodes.toArray().every((node) => nodeLayoutPosition(node))
    );
  }

  function fitGraph(eles = visibleElements(), padding = 64) {
    if (!state.cy || eles.length === 0) return;
    if (reducedMotion) {
      state.cy.fit(eles, padding);
      scheduleMiniMap();
      return;
    }
    state.cy.animate({
      fit: { eles, padding },
      duration: 380,
      easing: "ease-out-cubic",
    });
  }

  function runLayout({ fit = true } = {}) {
    const nodes = visibleNodes();
    if (!state.cy || nodes.length === 0) return;
    const roots = visibleRootCollection();
    const presetPositions = preparedLayoutPositions(nodes);
    const options = hasPresetLayout(nodes)
      ? {
          name: "preset",
          positions: (node) => (
            presetPositions && presetPositions.has(node.id())
              ? presetPositions.get(node.id())
              : activeLayoutPosition(node) || node.position()
          ),
          fit: false,
          animate: !reducedMotion,
          animationDuration: 520,
          animationEasing: "ease-out-cubic",
        }
      : {
          name: "breadthfirst",
          directed: true,
          roots,
          spacingFactor: 1.16,
          avoidOverlap: true,
          nodeDimensionsIncludeLabels: true,
          padding: 72,
          fit: false,
          animate: !reducedMotion,
          animationDuration: 560,
          animationEasing: "ease-out-cubic",
        };

    state.cy.once("layoutstop", () => {
      if (fit) fitGraph(visibleElements(), 68);
      updateVisibleCount();
      scheduleMiniMap();
    });
    visibleElements().layout(options).run();
  }

  function lineageIds(id) {
    const node = state.cy.$id(id);
    if (!node.length) return new Set();
    const lineage = node.predecessors().union(node.successors()).union(node);
    return new Set(lineage.nodes().map((n) => n.id()));
  }

  function queryContextIds(query) {
    if (!query) return null;
    const matches = new Set();
    const context = new Set();
    state.graph.nodes.forEach((person) => {
      if (person.searchText.includes(query)) {
        matches.add(person.id);
        context.add(person.id);
        model.incoming.get(person.id).forEach((edge) => context.add(edge.source));
        model.outgoing.get(person.id).forEach((edge) => context.add(edge.target));
      }
    });
    return { matches, context };
  }

  function nodePassesFilters(person, queryContext, focusSet) {
    if (focusSet && !focusSet.has(person.id)) return false;
    if (queryContext && !queryContext.context.has(person.id)) return false;
    return true;
  }

  function applyFilters({ relayout = true } = {}) {
    if (!state.cy || !state.graph) return;

    state.query = els.search.value.trim();

    const query = normalizeText(state.query);
    const queryContext = query.length >= 2 ? queryContextIds(query) : null;
    const focusSet = state.focusId ? lineageIds(state.focusId) : null;
    const visibleIds = new Set();

    state.cy.batch(() => {
      state.cy.nodes().forEach((node) => {
        const person = model.peopleById.get(node.id());
        const visible = nodePassesFilters(person, queryContext, focusSet);
        node.toggleClass("is-hidden", !visible);
        if (visible) visibleIds.add(node.id());
      });

      state.cy.edges().forEach((edge) => {
        const sourceVisible = visibleIds.has(edge.data("source"));
        const targetVisible = visibleIds.has(edge.data("target"));
        edge.toggleClass("is-hidden", !(sourceVisible && targetVisible));
      });
    });

    if (state.selectedId && !visibleIds.has(state.selectedId)) {
      state.cy.$id(state.selectedId).removeClass("selected");
    } else if (state.selectedId) {
      state.cy.$id(state.selectedId).addClass("selected");
    }

    renderSearchResults(query);
    updateVisibleCount();
    updateModeLabel();
    renderLegend(state.graph);
    writeUrlState();

    if (relayout) {
      runLayout({ fit: true });
    } else {
      scheduleMiniMap();
    }
  }

  function updateVisibleCount() {
    const visible = visibleNodes().length;
    const total = state.graph ? state.graph.nodes.length : 0;
    els.visibleCount.textContent = `${formatNumber(visible)} of ${formatNumber(total)} visible`;
  }

  function updateModeLabel(text) {
    if (text) {
      els.modeLabel.textContent = text;
      return;
    }
    if (state.lineageRelayoutId) {
      els.modeLabel.textContent = state.chronology ? "Relayout lineage + chronology" : "Relayout lineage";
      return;
    }
    if (state.focusId) {
      const person = model.peopleById.get(state.focusId);
      els.modeLabel.textContent = person ? `Focused: ${person.name}` : "Focused branch";
      return;
    }
    if (state.chronology) {
      els.modeLabel.textContent = "Chronological y-axis";
      return;
    }
    const active = [state.query].filter(Boolean).length;
    els.modeLabel.textContent = active ? `${active} filter${active === 1 ? "" : "s"}` : "Explore";
  }

  function populateControls(graph) {
    els.nodeCount.textContent = formatNumber(graph.meta.nodeCount);
    els.edgeCount.textContent = formatNumber(graph.meta.edgeCount);
    els.facultyCount.textContent = formatNumber(graph.meta.facultyCount);

    graph.nodes.forEach((person) => {
      const option = document.createElement("option");
      option.value = person.name;
      els.peopleOptions.append(option);
    });

    renderLegend(graph);

    els.search.value = state.query;
    els.colorModeInputs.forEach((input) => {
      input.checked = input.value === state.colorMode;
    });
    els.chronologyToggle.checked = state.chronology;
  }

  function renderLegend(graph) {
    els.legend.replaceChildren();

    if (state.colorMode === "university" || state.colorMode === "country") {
      model.colorBuckets[state.colorMode].forEach((entry) => {
        const item = document.createElement("span");
        item.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = entry.color;
        if (entry.label === OTHER_BUCKET) swatch.style.borderColor = "#aeb7c2";
        const text = document.createElement("span");
        text.textContent = `${entry.label} (${formatNumber(entry.count)})`;
        item.append(swatch, text);
        els.legend.append(item);
      });
      return;
    }

    graph.filters.categories.filter((category) => category.id !== "alumni").forEach((category) => {
      const item = document.createElement("span");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = categoryColors[category.id] || "#68707a";
      const label = document.createElement("span");
      label.textContent = category.label;
      item.append(swatch, label);
      els.legend.append(item);
    });
  }

  function applyColorMode() {
    if (!state.cy) return;
    state.cy.batch(() => {
      state.cy.nodes().forEach((node) => {
        const palette = colorsForPerson(node.data());
        node.data({
          fillColor: palette.fill,
          borderColor: palette.border,
          labelColor: palette.text,
        });
      });
    });
    renderLegend(state.graph);
    scheduleMiniMap();
    writeUrlState();
  }

  function setColorMode(mode) {
    state.colorMode = COLOR_MODES.has(mode) ? mode : "category";
    els.colorModeInputs.forEach((input) => {
      input.checked = input.value === state.colorMode;
    });
    applyColorMode();
  }

  function setChronologyMode(enabled) {
    state.chronology = Boolean(enabled);
    if (state.chronology) {
      state.query = "";
      els.search.value = "";
      els.searchResults.replaceChildren();
      clearElementHighlights();
      applyFilters({ relayout: false });
    }
    runLayout({ fit: true });
    updateModeLabel();
    writeUrlState();
  }

  function renderSearchResults(query) {
    els.searchResults.replaceChildren();
    if (!query || query.length < 2) return;

    const results = state.graph.nodes
      .filter((person) => person.searchText.includes(query))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      })
      .slice(0, 7);

    results.forEach((person) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-button";
      const name = document.createElement("strong");
      name.textContent = person.name;
      const meta = document.createElement("span");
      meta.textContent = compactMeta(person);
      button.append(name, meta);
      button.addEventListener("click", () => {
        els.search.value = person.name;
        applyFilters({ relayout: true });
        selectPerson(person.id, { center: true });
      });
      els.searchResults.append(button);
    });
  }

  function selectPerson(id, { center = true } = {}) {
    const person = model.peopleById.get(id);
    if (!person || !state.cy) return;
    state.selectedId = id;
    els.appShell.classList.remove("no-selection");
    state.cy.resize();
    state.cy.nodes().removeClass("selected");
    state.cy.$id(id).addClass("selected");
    renderProfile(person);
    writeUrlState();

    if (center) {
      const target = state.cy.$id(id).closedNeighborhood().not(".is-hidden");
      fitGraph(target.length ? target : state.cy.$id(id), 120);
    }
  }

  function renderProfile(person) {
    els.emptyProfile.hidden = true;
    els.profileContent.hidden = false;

    els.profileAvatar.textContent = initials(person.name);
    els.profileAvatar.style.background = categoryColors[person.category] || "#30353b";
    els.profileName.textContent = person.name;
    els.profileMeta.textContent = compactMeta(person);

    els.profileTags.replaceChildren();
    [
      person.category === "alumni" ? "" : person.categoryLabel,
      person.era,
      person.universityLabel && person.universityLabel !== "Unknown university" ? person.universityLabel : "",
      person.countryLabel && person.countryLabel !== "Unknown country" ? person.countryLabel : "",
      person.title && person.title !== person.role ? person.title : "",
    ].filter(Boolean).forEach((value) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = value;
      els.profileTags.append(tag);
    });

    renderRelations(els.advisorList, model.incoming.get(person.id).map((edge) => edge.source));
    renderRelations(els.studentList, model.outgoing.get(person.id).map((edge) => edge.target));
  }

  function renderRelations(container, ids) {
    container.replaceChildren();
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.className = "relation-empty";
      empty.textContent = "None listed";
      container.append(empty);
      return;
    }

    ids
      .map((id) => model.peopleById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((person) => {
        const button = document.createElement("button");
        button.type = "button";
        const name = document.createElement("strong");
        name.textContent = person.name;
        const meta = document.createElement("span");
        meta.textContent = compactMeta(person);
        button.append(name, meta);
        button.addEventListener("click", () => {
          selectPerson(person.id, { center: true });
        });
        container.append(button);
      });
  }

  function clearElementHighlights() {
    if (!state.cy) return;
    state.cy.elements().removeClass("faded lineage path-node path-edge");
    updateModeLabel();
  }

  function traceLineage(id = state.selectedId) {
    if (!id || !state.cy) return;
    state.lineageRelayoutId = "";
    clearElementHighlights();
    const node = state.cy.$id(id);
    const lineage = node.predecessors().union(node.successors()).union(node);
    state.cy.elements().addClass("faded");
    lineage.removeClass("faded").addClass("lineage");
    node.removeClass("lineage").addClass("selected");
    fitGraph(lineage.not(".is-hidden"), 94);
    updateModeLabel("Lineage trace");
  }

  function lineageLayoutPositions(nodes) {
    const rows = new Map();
    const nodeIds = new Set(nodes.map((node) => node.id()));
    const connections = new Map(nodes.map((node) => [node.id(), new Set()]));
    nodes.forEach((node) => {
      const layout = node.data("layout") || {};
      const generation = Number(layout.generation);
      const fallback = Number(layout.rank);
      const rowKey = Number.isFinite(generation) ? generation : fallback;
      const key = Number.isFinite(rowKey) ? rowKey : 0;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(node);
    });

    visibleElements().edges().forEach((edge) => {
      const source = edge.data("source");
      const target = edge.data("target");
      if (!nodeIds.has(source) || !nodeIds.has(target)) return;
      connections.get(source).add(target);
      connections.get(target).add(source);
    });

    const sortedRows = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([key, row]) => ({ key, row }));
    const rowGap = 190;
    const xGap = 250;
    const yOffset = (sortedRows.length - 1) * rowGap / 2;
    const positions = new Map();
    const fallbackOrder = new Map();

    sortedRows.forEach(({ row }) => {
      row.sort((a, b) => {
        const aLayout = a.data("layout") || {};
        const bLayout = b.data("layout") || {};
        const aAnchor = Number(aLayout.branchAnchor);
        const bAnchor = Number(bLayout.branchAnchor);
        const anchorDelta = (Number.isFinite(aAnchor) ? aAnchor : 0) - (Number.isFinite(bAnchor) ? bAnchor : 0);
        if (anchorDelta !== 0) return anchorDelta;
        const rowDelta = Number(aLayout.rowOrder || 0) - Number(bLayout.rowOrder || 0);
        if (rowDelta !== 0) return rowDelta;
        return a.data("name").localeCompare(b.data("name"));
      });
      row.forEach((node, index) => fallbackOrder.set(node.id(), index));
    });

    function neighborAverage(id, neighborOrder) {
      const indexes = [...(connections.get(id) || [])]
        .map((neighborId) => neighborOrder.get(neighborId))
        .filter((index) => Number.isFinite(index));
      if (!indexes.length) return null;
      return indexes.reduce((sum, index) => sum + index, 0) / indexes.length;
    }

    function reorderAgainst(rowIndex, neighborIndex) {
      const row = sortedRows[rowIndex].row;
      const neighborOrder = new Map(sortedRows[neighborIndex].row.map((node, index) => [node.id(), index]));
      row.sort((a, b) => {
        const aAverage = neighborAverage(a.id(), neighborOrder);
        const bAverage = neighborAverage(b.id(), neighborOrder);
        if (aAverage !== null && bAverage !== null && Math.abs(aAverage - bAverage) > 0.001) {
          return aAverage - bAverage;
        }
        if (aAverage !== null && bAverage === null) return -1;
        if (aAverage === null && bAverage !== null) return 1;
        return (fallbackOrder.get(a.id()) || 0) - (fallbackOrder.get(b.id()) || 0);
      });
    }

    for (let pass = 0; pass < 4; pass += 1) {
      for (let rowIndex = 1; rowIndex < sortedRows.length; rowIndex += 1) {
        reorderAgainst(rowIndex, rowIndex - 1);
      }
      for (let rowIndex = sortedRows.length - 2; rowIndex >= 0; rowIndex -= 1) {
        reorderAgainst(rowIndex, rowIndex + 1);
      }
    }

    sortedRows.forEach(({ row }, rowIndex) => {
      const xOffset = (row.length - 1) * xGap / 2;
      row.forEach((node, nodeIndex) => {
        positions.set(node.id(), {
          x: nodeIndex * xGap - xOffset,
          y: rowIndex * rowGap - yOffset,
        });
      });
    });

    return positions;
  }

  function relayoutLineage(id = state.selectedId) {
    if (!id || !state.cy) return;
    state.focusId = id;
    state.lineageRelayoutId = id;
    state.query = "";
    els.search.value = "";
    els.searchResults.replaceChildren();

    clearElementHighlights();
    applyFilters({ relayout: false });

    const lineage = visibleElements();
    const nodes = visibleNodes().toArray();
    const basePositions = lineageLayoutPositions(nodes);
    const positions = state.chronology ? chronologicalLayoutPositions(nodes, basePositions) : basePositions;
    state.cy.elements().removeClass("faded lineage path-node path-edge");
    lineage.addClass("lineage");
    state.cy.$id(id).removeClass("lineage").addClass("selected");

    state.cy.once("layoutstop", () => {
      fitGraph(lineage, 96);
      updateVisibleCount();
      scheduleMiniMap();
    });
    lineage.layout({
      name: "preset",
      positions: (node) => positions.get(node.id()) || node.position(),
      fit: false,
      animate: !reducedMotion,
      animationDuration: 520,
      animationEasing: "ease-out-cubic",
    }).run();
    updateModeLabel(state.chronology ? "Relayout lineage + chronology" : "Relayout lineage");
    writeUrlState();
  }

  function focusBranch(id = state.selectedId) {
    if (!id) return;
    state.lineageRelayoutId = "";
    state.focusId = state.focusId === id ? "" : id;
    if (state.focusId) {
      state.query = "";
      els.search.value = "";
      els.searchResults.replaceChildren();
    }
    clearElementHighlights();
    applyFilters({ relayout: true });
    if (state.selectedId) selectPerson(state.selectedId, { center: false });
  }

  function clearAll() {
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.query = "";
    els.search.value = "";
    els.searchResults.replaceChildren();
    clearElementHighlights();
    applyFilters({ relayout: true });
  }

  function findShortestPath(sourceId, targetId) {
    if (!sourceId || !targetId) return [];
    if (sourceId === targetId) return [sourceId];

    const queue = [[sourceId]];
    const seen = new Set([sourceId]);

    while (queue.length) {
      const path = queue.shift();
      const last = path[path.length - 1];
      for (const next of model.adjacency.get(last) || []) {
        if (seen.has(next)) continue;
        const candidate = [...path, next];
        if (next === targetId) return candidate;
        seen.add(next);
        queue.push(candidate);
      }
    }

    return [];
  }

  function highlightPath(pathIds) {
    state.lineageRelayoutId = "";
    clearAllFiltersWithoutLayout();
    clearElementHighlights();
    const pathSet = new Set(pathIds);
    state.cy.elements().addClass("faded");
    pathIds.forEach((id) => state.cy.$id(id).removeClass("faded").addClass("path-node"));

    const edgeIds = [];
    for (let i = 0; i < pathIds.length - 1; i += 1) {
      const edgeId = model.edgeByPair.get(edgeKey(pathIds[i], pathIds[i + 1]));
      if (edgeId) edgeIds.push(edgeId);
    }

    edgeIds.forEach((id) => state.cy.$id(id).removeClass("faded").addClass("path-edge"));
    const pathEles = collectionFromIds([...pathSet, ...edgeIds]);
    fitGraph(pathEles, 118);
    updateModeLabel(`Path: ${pathIds.length} people`);
  }

  function clearAllFiltersWithoutLayout() {
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.query = "";
    els.search.value = "";
    state.cy.elements().removeClass("is-hidden");
    updateVisibleCount();
    writeUrlState();
  }

  function runPathSearch() {
    const sourceId = resolvePersonId(els.pathFrom.value);
    const targetId = resolvePersonId(els.pathTo.value);
    if (!sourceId || !targetId) {
      els.pathStatus.textContent = "Choose two listed people.";
      return;
    }

    const pathIds = findShortestPath(sourceId, targetId);
    if (!pathIds.length) {
      els.pathStatus.textContent = "No connected path found.";
      return;
    }

    highlightPath(pathIds);
    selectPerson(targetId, { center: false });
    const source = model.peopleById.get(sourceId);
    const target = model.peopleById.get(targetId);
    els.pathStatus.textContent = `${source.name} to ${target.name}: ${pathIds.length - 1} link${pathIds.length === 2 ? "" : "s"}.`;
    if (typeof els.pathDialog.close === "function") {
      els.pathDialog.close();
    } else {
      els.pathDialog.removeAttribute("open");
    }
  }

  function scheduleFilterApply() {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => applyFilters({ relayout: true }), 120);
  }

  function scheduleMiniMap() {
    if (miniFrame) return;
    miniFrame = window.requestAnimationFrame(() => {
      miniFrame = 0;
      updateMiniMap();
    });
  }

  function updateMiniMap() {
    if (!state.cy) return;

    const width = 220;
    const height = 132;
    const pad = 10;
    const nodes = visibleNodes();
    els.miniMap.replaceChildren();
    if (!nodes.length) return;

    const bb = nodes.boundingBox({ includeLabels: false });
    const scale = Math.min((width - pad * 2) / Math.max(bb.w, 1), (height - pad * 2) / Math.max(bb.h, 1));
    const offsetX = pad + (width - pad * 2 - bb.w * scale) / 2;
    const offsetY = pad + (height - pad * 2 - bb.h * scale) / 2;
    model.miniTransform = { bb, scale, offsetX, offsetY };

    const ns = "http://www.w3.org/2000/svg";
    const group = document.createElementNS(ns, "g");
    nodes.forEach((node) => {
      const position = node.position();
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", offsetX + (position.x - bb.x1) * scale);
      circle.setAttribute("cy", offsetY + (position.y - bb.y1) * scale);
      circle.setAttribute("r", node.hasClass("selected") ? "3.1" : "2.1");
      const fill = node.data("fillColor") || categoryColors[node.data("category")] || "#68707a";
      circle.setAttribute("fill", fill);
      if (fill === "#ffffff") {
        circle.setAttribute("stroke", "#9aa3ad");
        circle.setAttribute("stroke-width", "0.8");
      }
      circle.setAttribute("opacity", node.hasClass("faded") ? "0.28" : "0.78");
      group.append(circle);
    });
    els.miniMap.append(group);

    const extent = state.cy.extent();
    const view = document.createElementNS(ns, "rect");
    const x = offsetX + (extent.x1 - bb.x1) * scale;
    const y = offsetY + (extent.y1 - bb.y1) * scale;
    const w = (extent.x2 - extent.x1) * scale;
    const h = (extent.y2 - extent.y1) * scale;
    view.setAttribute("x", Math.max(1, Math.min(width - 2, x)));
    view.setAttribute("y", Math.max(1, Math.min(height - 2, y)));
    view.setAttribute("width", Math.max(4, Math.min(width - 2, w)));
    view.setAttribute("height", Math.max(4, Math.min(height - 2, h)));
    view.setAttribute("fill", "none");
    view.setAttribute("stroke", "#111318");
    view.setAttribute("stroke-width", "1.4");
    view.setAttribute("rx", "3");
    els.miniMap.append(view);
  }

  function panFromMiniMap(event) {
    if (!model.miniTransform || !state.cy) return;
    const rect = els.miniMap.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 220;
    const y = ((event.clientY - rect.top) / rect.height) * 132;
    const { bb, scale, offsetX, offsetY } = model.miniTransform;
    const modelX = (x - offsetX) / scale + bb.x1;
    const modelY = (y - offsetY) / scale + bb.y1;
    const zoom = state.cy.zoom();
    const pan = {
      x: state.cy.width() / 2 - modelX * zoom,
      y: state.cy.height() / 2 - modelY * zoom,
    };
    if (reducedMotion) {
      state.cy.pan(pan);
    } else {
      state.cy.animate({ pan, duration: 220, easing: "ease-out-cubic" });
    }
  }

  async function copyShareLink() {
    writeUrlState();
    const label = els.shareButton.querySelector("span");
    const previous = label ? label.textContent : "";
    try {
      await navigator.clipboard.writeText(window.location.href);
      if (label) label.textContent = "Copied";
    } catch {
      if (label) label.textContent = "Ready";
    }
    window.setTimeout(() => {
      if (label) label.textContent = previous || "Share";
    }, 1300);
  }

  function attachEvents() {
    els.search.addEventListener("input", scheduleFilterApply);
    els.colorModeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) setColorMode(input.value);
      });
    });
    els.chronologyToggle.addEventListener("change", () => setChronologyMode(els.chronologyToggle.checked));
    els.fitButton.addEventListener("click", () => fitGraph(visibleElements(), 68));
    els.focusButton.addEventListener("click", () => focusBranch());
    els.traceButton.addEventListener("click", () => traceLineage());
    els.focusBranchButton.addEventListener("click", () => focusBranch());
    els.relayoutLineageButton.addEventListener("click", () => relayoutLineage());
    els.shareButton.addEventListener("click", copyShareLink);
    els.miniMap.addEventListener("click", panFromMiniMap);

    els.pathButton.addEventListener("click", () => {
      if (state.selectedId) {
        els.pathFrom.value = model.peopleById.get(state.selectedId).name;
      }
      els.pathStatus.textContent = "";
      if (typeof els.pathDialog.showModal === "function") {
        els.pathDialog.showModal();
      } else {
        els.pathDialog.setAttribute("open", "");
      }
    });

    els.runPathButton.addEventListener("click", runPathSearch);

    window.addEventListener("resize", () => {
      if (!state.cy) return;
      state.cy.resize();
      scheduleMiniMap();
    });
  }

  function showError(error) {
    els.loading.innerHTML = "";
    const message = document.createElement("span");
    message.textContent = error.message || "Unable to load family tree.";
    els.loading.append(message);
  }

  async function init() {
    readUrlState();

    if (!window.cytoscape) {
      showError(new Error("Cytoscape failed to load."));
      return;
    }

    try {
      const response = await fetch(DATA_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Unable to load ${DATA_URL}.`);
      const graph = await response.json();
      validateGraph(graph);
      state.graph = graph;
      buildModel(graph);
      populateControls(graph);
      createCy(graph);
      attachEvents();
      applyFilters({ relayout: false });
      runLayout({ fit: true });

      if (state.selectedId && model.peopleById.has(state.selectedId)) {
        selectPerson(state.selectedId, { center: true });
      }

      if (state.focusId && model.peopleById.has(state.focusId)) {
        applyFilters({ relayout: true });
      }

      els.loading.hidden = true;
    } catch (error) {
      showError(error);
      console.error(error);
    }
  }

  init();
})();
