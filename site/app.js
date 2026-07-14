(() => {
  const DATA_URL = "graph-data.json";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLOR_BUCKET_LIMIT = 18;
  const OTHER_BUCKET = "Other";
  const NULL_BUCKET = "Unknown / none";
  const COLOR_MODES = new Set(["category", "university", "country", "continent"]);
  const ORIENTATIONS = new Set(["vertical", "horizontal"]);
  const DEFAULT_ORIENTATION = "vertical";
  const MINI_PANEL_STORAGE_KEY = "cmu-meche-family-tree-mini-panel";
  const MINI_PANEL_MARGIN = 12;
  const layoutHelpers = window.FamilyTreeLayout;
  const exportHelpers = window.FamilyTreeExport;
  const EXPORT_PADDING = 84;
  const EXPORT_BACKGROUND = "#25282c";
  const PATH_TEMPORAL_SIDE_SPAN_MIN = 300;
  const PATH_TEMPORAL_SIDE_SPAN_MAX = 560;
  const PATH_TEMPORAL_SIDE_SPAN_PER_NODE = 18;
  const PATH_TEMPORAL_APEX_SHOULDER = 110;
  const PATH_TEMPORAL_RANK_GAP = 132;
  const PATH_TEMPORAL_PIXELS_PER_NODE = 118;
  const PATH_TEMPORAL_MIN_TIME_SPAN = 2200;
  const PATH_TEMPORAL_MAX_TIME_SPAN = 5600;
  const PATH_TEMPORAL_MIN_YEAR_GAP = 8;
  const PATH_TEMPORAL_MAX_YEAR_GAP = 18;
  const TIMELINE_CENTURY_STEP = 100;
  const TIMELINE_DECADE_STEP = 10;
  const TIMELINE_DECADE_MIN_SCREEN_GAP = 46;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ELK_RELAYOUT_OPTIONS = {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.edgeRouting": "SPLINES",
    "elk.spacing.nodeNode": "54",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
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

  const categoryColors = {
    "cmu-faculty": "#b00",
    "alumni": "#ffffff",
    "unknown-lineage": "#3e8c69",
    "missing-advisor": "#c28a16",
    "follow-up": "#d45f16",
  };

  const nodePalette = {
    "cmu-faculty": { fill: "#b00", border: "#ffffff", text: "#ffffff" },
    "alumni": { fill: "#ffffff", border: "#6f7b8a", text: "#1c1f23" },
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
    "#9f6b00",
    "#4466aa",
    "#7a8750",
    "#b35c8a",
    "#3d8a8f",
    "#a65f2f",
    "#6f5aa8",
    "#4c8a73",
    "#a34b4b",
    "#587aa0",
    "#9a7b36",
    "#7c6f9c",
    "#b26a6a",
    "#2f756d",
    "#855c33",
    "#5d83b3",
    "#b36b2c",
    "#6b8e23",
    "#8a4f64",
    "#46707d",
    "#a06f9f",
    "#5a6b2f",
    "#b05530",
    "#356f44",
  ];

  const specialBucketColors = {
    [OTHER_BUCKET]: "#dfe3e8",
    [NULL_BUCKET]: "#9aa3ad",
  };

  const continentPalette = {
    "Africa": "#8f5aa3",
    "Asia": "#d45f16",
    "Europe": "#2f6f9f",
    "North America": "#3e8c69",
    "Oceania": "#c28a16",
    "South America": "#a14f76",
    "Antarctica": "#607d9c",
    [OTHER_BUCKET]: specialBucketColors[OTHER_BUCKET],
    [NULL_BUCKET]: specialBucketColors[NULL_BUCKET],
  };

  const continentOrder = [
    "Africa",
    "Asia",
    "Europe",
    "North America",
    "Oceania",
    "South America",
    "Antarctica",
    OTHER_BUCKET,
    NULL_BUCKET,
  ];

  const els = {
    appShell: document.getElementById("appShell"),
    topbar: document.querySelector(".topbar"),
    graphStage: document.querySelector(".graph-stage"),
    cy: document.getElementById("cy"),
    loading: document.getElementById("loadingOverlay"),
    search: document.getElementById("searchInput"),
    searchButton: document.getElementById("searchButton"),
    searchStatus: document.getElementById("searchStatus"),
    peopleOptions: document.getElementById("peopleOptions"),
    searchResults: document.getElementById("searchResults"),
    colorModeInputs: [...document.querySelectorAll('input[name="colorMode"]')],
    layoutOrientationInputs: [...document.querySelectorAll('input[name="layoutOrientation"]')],
    chronologyToggle: document.getElementById("chronologyToggle"),
    fitButton: document.getElementById("fitButton"),
    focusButton: document.getElementById("focusButton"),
    pathButton: document.getElementById("pathButton"),
    resetViewButton: document.getElementById("resetViewButton"),
    shareButton: document.getElementById("shareButton"),
    exportMenu: document.getElementById("exportMenu"),
    exportButton: document.getElementById("exportButton"),
    exportPopover: document.getElementById("exportPopover"),
    exportOptions: [...document.querySelectorAll("[data-export-format]")],
    exportStatus: document.getElementById("exportStatus"),
    relayoutPathButton: document.getElementById("relayoutPathButton"),
    visibleCount: document.getElementById("visibleCount"),
    modeLabel: document.getElementById("modeLabel"),
    viewBanner: document.getElementById("viewBanner"),
    viewTitle: document.getElementById("viewTitle"),
    viewDetail: document.getElementById("viewDetail"),
    clearViewButton: document.getElementById("clearViewButton"),
    timelinePanel: document.getElementById("timelinePanel"),
    timelineAxis: document.getElementById("timelineAxis"),
    nodeCount: document.getElementById("nodeCount"),
    edgeCount: document.getElementById("edgeCount"),
    facultyCount: document.getElementById("facultyCount"),
    miniPanel: document.getElementById("miniPanel"),
    miniPanelHandle: document.getElementById("miniPanelHandle"),
    miniMap: document.getElementById("miniMap"),
    legend: document.getElementById("legend"),
    emptyProfile: document.getElementById("emptyProfile"),
    profileContent: document.getElementById("profileContent"),
    profileAvatar: document.getElementById("profileAvatar"),
    profileName: document.getElementById("profileName"),
    profileMeta: document.getElementById("profileMeta"),
    profileTags: document.getElementById("profileTags"),
    sourceBlock: document.getElementById("sourceBlock"),
    sourceList: document.getElementById("sourceList"),
    profileCloseButton: document.getElementById("profileCloseButton"),
    pathContent: document.getElementById("pathContent"),
    pathSummary: document.getElementById("pathSummary"),
    pathEndpointList: document.getElementById("pathEndpointList"),
    pathPanelCloseButton: document.getElementById("pathPanelCloseButton"),
    pathPanelRelayoutButton: document.getElementById("pathPanelRelayoutButton"),
    pathPanelClearButton: document.getElementById("pathPanelClearButton"),
    advisorList: document.getElementById("advisorList"),
    studentList: document.getElementById("studentList"),
    traceButton: document.getElementById("traceButton"),
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
    layoutOrientation: DEFAULT_ORIENTATION,
    chronology: false,
    lineageRelayoutId: "",
    traceId: "",
    pathSourceId: "",
    pathTargetId: "",
    pathRelayoutRequested: false,
    currentPathIds: [],
    currentPathEdgeIds: [],
    pathRelayoutActive: false,
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
    colorBuckets: { university: [], country: [], continent: [] },
    colorBucketMaps: { university: new Map(), country: new Map(), continent: new Map() },
  };

  let searchTimer = 0;
  let miniFrame = 0;
  let timelineFrame = 0;
  let elkEngine = null;
  let relayoutRun = 0;

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
    return [displayRole(person.role), person.yearLabel].filter(Boolean).join(" / ");
  }

  function isUnlistedRole(value) {
    return normalizeText(value) === "unlisted role";
  }

  function isHiddenRole(value) {
    const role = normalizeText(value);
    return role === "unlisted role" || role === "ms alumni";
  }

  function isHiddenTitleTag(value) {
    const title = normalizeText(value).replace(/[^a-z0-9]+/g, "");
    return title === "ms" || title === "msc" || title === "mse" || title === "master" || title === "masters";
  }

  function displayRole(value) {
    return isHiddenRole(value) ? "" : value;
  }

  function hostnameForUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function sourceLabel(source) {
    const label = String(source.label || "").trim();
    if (label && label !== "Source") return label;
    return hostnameForUrl(source.url) || "Source";
  }

  function searchableText(person) {
    return [
      person.name,
      person.title,
      person.university,
      person.universityLabel,
      person.countryLabel,
      person.continentLabel,
      displayRole(person.role),
      person.era,
      person.categoryLabel,
      person.yearLabel,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function personTagValues(person) {
    return [
      person.category === "alumni" ? "" : person.categoryLabel,
      person.universityLabel && person.universityLabel !== "Unknown university" ? person.universityLabel : "",
      person.countryLabel && person.countryLabel !== "Unknown country" ? person.countryLabel : "",
      person.continentLabel && ![OTHER_BUCKET, NULL_BUCKET].includes(person.continentLabel) ? person.continentLabel : "",
      person.title && !isHiddenRole(person.title) && !isHiddenTitleTag(person.title) && person.title !== person.role ? person.title : "",
    ].filter(Boolean);
  }

  function setSearchStatus(message = "") {
    if (els.searchStatus) els.searchStatus.textContent = message;
  }

  function clearSearchUi({ clearValue = true } = {}) {
    window.clearTimeout(searchTimer);
    if (clearValue) els.search.value = "";
    els.searchResults.replaceChildren();
    setSearchStatus("");
  }

  function matchingSearchPeople(query) {
    const normalized = normalizeText(query);
    if (!state.graph || normalized.length < 2) return [];
    return state.graph.nodes
      .filter((person) => person.searchText.includes(normalized))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(normalized) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(normalized) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      });
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

  function universityBucketSource(person) {
    const label = person.universityLabel || "Unknown university";
    if (label === "Unknown university") return NULL_BUCKET;
    if (/\bcmu\b|carnegie mellon/i.test(label)) return "Carnegie Mellon University";
    return label;
  }

  function countryBucketSource(person) {
    const label = person.countryLabel || "Unknown country";
    if (label === "Unknown country") return NULL_BUCKET;
    return label;
  }

  function continentBucketSource(person) {
    const label = person.continentLabel || NULL_BUCKET;
    return label === "Unknown continent" ? NULL_BUCKET : label;
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

  function buildBucketEntries(graph, sourceForPerson, { pinnedLabels = [] } = {}) {
    const counts = new Map();
    graph.nodes.forEach((person) => incrementCount(counts, sourceForPerson(person)));

    const entries = [];
    let paletteIndex = 0;
    let covered = 0;
    const pinned = new Set(pinnedLabels.filter((label) => label && label !== OTHER_BUCKET && label !== NULL_BUCKET));

    const nullCount = counts.get(NULL_BUCKET) || 0;
    counts.delete(NULL_BUCKET);
    counts.delete(OTHER_BUCKET);

    const rankedCounts = sortedCounts(counts);
    const selectedLabels = new Set(rankedCounts.slice(0, COLOR_BUCKET_LIMIT).map(([label]) => label));
    rankedCounts.forEach(([label]) => {
      if (pinned.has(label)) selectedLabels.add(label);
    });

    rankedCounts.filter(([label]) => selectedLabels.has(label)).forEach(([label, count]) => {
      entries.push({ label, count, color: bucketColor(label, paletteIndex) });
      covered += count;
      paletteIndex += 1;
    });

    const otherCount = Math.max(0, graph.nodes.length - covered - nullCount);
    if (otherCount > 0) {
      entries.push({
        label: OTHER_BUCKET,
        count: otherCount,
        color: bucketColor(OTHER_BUCKET, paletteIndex),
      });
    }
    if (nullCount > 0) {
      entries.push({
        label: NULL_BUCKET,
        count: nullCount,
        color: bucketColor(NULL_BUCKET, paletteIndex),
      });
    }
    return entries;
  }

  function buildContinentEntries(graph) {
    const counts = new Map();
    graph.nodes.forEach((person) => incrementCount(counts, continentBucketSource(person)));
    return continentOrder
      .map((label) => ({
        label,
        count: counts.get(label) || 0,
        color: continentPalette[label] || specialBucketColors[OTHER_BUCKET],
      }))
      .filter((entry) => entry.count > 0);
  }

  function currentFacultyUniversityBuckets(graph) {
    return graph.nodes
      .filter((person) => person.category === "cmu-faculty")
      .map((person) => universityBucketSource(person))
      .filter((label) => label !== OTHER_BUCKET && label !== NULL_BUCKET);
  }

  function buildColorBuckets(graph) {
    model.colorBuckets.university = buildBucketEntries(
      graph,
      universityBucketSource,
      { pinnedLabels: currentFacultyUniversityBuckets(graph) }
    );
    model.colorBuckets.country = buildBucketEntries(graph, countryBucketSource);
    model.colorBuckets.continent = buildContinentEntries(graph);
    model.colorBucketMaps.university = new Map(model.colorBuckets.university.map((entry) => [entry.label, entry]));
    model.colorBucketMaps.country = new Map(model.colorBuckets.country.map((entry) => [entry.label, entry]));
    model.colorBucketMaps.continent = new Map(model.colorBuckets.continent.map((entry) => [entry.label, entry]));
  }

  function bucketEntry(mode, label) {
    const map = model.colorBucketMaps[mode];
    if (!map) return null;
    return map.get(label) || map.get(OTHER_BUCKET) || map.get(NULL_BUCKET) || null;
  }

  function colorsForPerson(person) {
    if (state.colorMode === "university" || state.colorMode === "country" || state.colorMode === "continent") {
      const labelByMode = {
        university: person.universityColorBucket,
        country: person.countryColorBucket,
        continent: person.continentColorBucket,
      };
      const label = labelByMode[state.colorMode];
      const entry = bucketEntry(state.colorMode, label);
      const fill = entry ? entry.color : specialBucketColors[OTHER_BUCKET];
      const isSpecialFallback = !entry || entry.label === OTHER_BUCKET || entry.label === NULL_BUCKET;
      return {
        fill,
        border: isSpecialFallback ? "#aeb7c2" : "#ffffff",
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
    state.lineageRelayoutId = params.get("lineage") || "";
    state.traceId = params.get("trace") || "";
    state.pathSourceId = params.get("pathFrom") || "";
    state.pathTargetId = params.get("pathTo") || "";
    state.pathRelayoutRequested = params.get("pathLayout") === "1";
    state.colorMode = COLOR_MODES.has(params.get("color")) ? params.get("color") : "category";
    state.layoutOrientation = ORIENTATIONS.has(params.get("layout")) ? params.get("layout") : DEFAULT_ORIENTATION;
    state.chronology = params.get("chrono") === "1";
    if (state.lineageRelayoutId && !state.focusId) state.focusId = state.lineageRelayoutId;
  }

  function writeUrlState() {
    const params = new URLSearchParams();
    if (state.selectedId) params.set("person", state.selectedId);
    if (state.query) params.set("q", state.query);
    if (state.focusId) params.set("focus", state.focusId);
    if (state.lineageRelayoutId) params.set("lineage", state.lineageRelayoutId);
    if (state.traceId) params.set("trace", state.traceId);
    const pathFrom = state.currentPathIds.length >= 2 ? state.currentPathIds[0] : state.pathSourceId;
    const pathTo = state.currentPathIds.length >= 2
      ? state.currentPathIds[state.currentPathIds.length - 1]
      : state.pathTargetId;
    if (pathFrom && pathTo) {
      params.set("pathFrom", pathFrom);
      params.set("pathTo", pathTo);
      if (state.pathRelayoutActive || state.pathRelayoutRequested) params.set("pathLayout", "1");
    }
    if (state.colorMode !== "category") params.set("color", state.colorMode);
    if (state.layoutOrientation !== DEFAULT_ORIENTATION) params.set("layout", state.layoutOrientation);
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
      const continentEntry = bucketEntry("continent", continentBucketSource(person));
      person.universityColorBucket = universityEntry ? universityEntry.label : OTHER_BUCKET;
      person.countryColorBucket = countryEntry ? countryEntry.label : OTHER_BUCKET;
      person.continentColorBucket = continentEntry ? continentEntry.label : OTHER_BUCKET;
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
            "line-color": "#96a3b3",
            "target-arrow-color": "#96a3b3",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.7,
            opacity: 0.72,
            "transition-property": "line-color, opacity, width",
            "transition-duration": reducedMotion ? 0 : 160,
          },
        },
        {
          selector: "edge.temporal-edge",
          style: {
            width: 1,
            opacity: 0.38,
            "arrow-scale": 0.58,
            "line-color": "#8390a0",
            "target-arrow-color": "#8390a0",
          },
        },
        {
          selector: ".is-hidden",
          style: { display: "none" },
        },
        {
          selector: ".selected",
          style: {
            "border-color": "#ffd166",
            "border-width": 4,
            "z-index": 30,
          },
        },
        {
          selector: ".lineage, .path-node",
          style: {
            "border-color": "#ffd166",
            "border-width": 3,
            "z-index": 20,
          },
        },
        {
          selector: ".path-node",
          style: {
            "font-size": 11,
            "min-zoomed-font-size": 3,
          },
        },
        {
          selector: "edge.lineage, edge.path-edge",
          style: {
            width: 3,
            "line-color": "#ffd166",
            "target-arrow-color": "#ffd166",
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
      selectPerson(event.target.id(), { center: false, revealProfile: true });
    });

    state.cy.on("tap", (event) => {
      if (event.target === state.cy) {
        if (hasActiveViewState()) {
          resetToFullTree();
          return;
        }
        clearElementHighlights();
        writeUrlState();
      }
    });

    state.cy.on("pan zoom layoutstop", scheduleMiniMap);
    state.cy.on("pan zoom", scheduleTimeline);
    state.cy.on("layoutstop", scheduleTimeline);
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

  function isHorizontalLayout() {
    return state.layoutOrientation === "horizontal";
  }

  function isStackedLayout() {
    return window.matchMedia("(max-width: 920px)").matches;
  }

  function revealElementOnMobile(element, margin = 10) {
    if (!element || !isStackedLayout()) return;
    window.requestAnimationFrame(() => {
      const topbarHeight = els.topbar ? els.topbar.getBoundingClientRect().height : 0;
      const targetTop = window.scrollY + element.getBoundingClientRect().top - topbarHeight - margin;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: reducedMotion ? "auto" : "smooth",
      });
    });
  }

  function revealProfileOnMobile() {
    const target = !els.pathContent.hidden
      ? els.pathContent
      : (els.profileContent.hidden ? els.emptyProfile : els.profileContent);
    revealElementOnMobile(target);
  }

  function revealGraphOnMobile() {
    revealElementOnMobile(els.graphStage);
  }

  function orientPosition(position) {
    if (!position || !isHorizontalLayout()) return position;
    return {
      x: position.y * 1.18,
      y: position.x * 0.86,
    };
  }

  function orientPositions(positions) {
    if (!positions || !isHorizontalLayout()) return positions;
    return new Map([...positions.entries()].map(([id, position]) => [id, orientPosition(position)]));
  }

  function compactStackedPathPositions(positions) {
    if (!positions || !isStackedLayout() || !state.chronology || isHorizontalLayout()) return positions;
    const ys = [...positions.values()].map((position) => position.y).filter(Number.isFinite);
    if (ys.length < 2) return positions;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    const maxSpan = 320;
    if (!Number.isFinite(span) || span <= maxSpan) return positions;
    const center = (minY + maxY) / 2;
    const scale = maxSpan / span;
    return new Map([...positions.entries()].map(([id, position]) => [id, {
      ...position,
      y: center + (position.y - center) * scale,
    }]));
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
    const position = state.chronology ? chronologyLayoutPosition(node) : nodeLayoutPosition(node);
    return orientPosition(position);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function layoutPositionFromBase(node, basePositions) {
    return basePositions && basePositions.has(node.id())
      ? basePositions.get(node.id())
      : nodeLayoutPosition(node) || node.position();
  }

  function nodeSizeForLayout(node) {
    const dataWidth = Number(node.data("boxWidth"));
    const dataHeight = Number(node.data("boxHeight"));
    const renderedWidth = Number(node.width && node.width());
    const renderedHeight = Number(node.height && node.height());
    return {
      width: Number.isFinite(dataWidth) ? dataWidth : (Number.isFinite(renderedWidth) ? renderedWidth : 150),
      height: Number.isFinite(dataHeight) ? dataHeight : (Number.isFinite(renderedHeight) ? renderedHeight : 56),
    };
  }

  function centeredPositionsFromLayout(children = []) {
    const positioned = children.map((child) => {
      const width = Number(child.width || 0);
      const height = Number(child.height || 0);
      return {
        id: child.id,
        x: Number(child.x || 0) + width / 2,
        y: Number(child.y || 0) + height / 2,
        width,
        height,
      };
    });
    if (!positioned.length) return null;

    const minX = Math.min(...positioned.map((node) => node.x - node.width / 2));
    const maxX = Math.max(...positioned.map((node) => node.x + node.width / 2));
    const minY = Math.min(...positioned.map((node) => node.y - node.height / 2));
    const maxY = Math.max(...positioned.map((node) => node.y + node.height / 2));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return new Map(positioned.map((node) => [node.id, {
      x: node.x - centerX,
      y: node.y - centerY,
    }]));
  }

  function visibleEdgeRecordsForNodes(nodes) {
    const nodeIds = new Set(nodes.map((node) => node.id()));
    return visibleElements().edges().toArray()
      .map((edge) => ({
        id: edge.id(),
        source: edge.data("source"),
        target: edge.data("target"),
      }))
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  }

  function pathEdgeRecords(pathIds) {
    return pathIds.slice(0, -1).map((source, index) => ({
      id: `path-relayout-${index}`,
      source,
      target: pathIds[index + 1],
    }));
  }

  function elkRelayoutEngine() {
    if (!window.ELK) return null;
    if (!elkEngine) elkEngine = new window.ELK();
    return elkEngine;
  }

  async function elkLayoutPositions(nodes, edges) {
    const engine = elkRelayoutEngine();
    if (!engine || !nodes.length) return null;

    const nodeIds = new Set(nodes.map((node) => node.id()));
    const children = nodes.map((node) => {
      const { width, height } = nodeSizeForLayout(node);
      return {
        id: node.id(),
        width,
        height,
      };
    });
    const elkEdges = edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }));

    try {
      const layout = await engine.layout({
        id: "relayout",
        layoutOptions: ELK_RELAYOUT_OPTIONS,
        children,
        edges: elkEdges,
      });
      return centeredPositionsFromLayout(layout.children || []);
    } catch {
      return null;
    }
  }

  function chronologicalLayoutPositions(nodes, basePositions = null) {
    if (!layoutHelpers) {
      return basePositions || new Map(nodes.map((node) => [node.id(), nodeLayoutPosition(node) || node.position()]));
    }
    const layoutNodes = nodes.map((node) => {
      const base = layoutPositionFromBase(node, basePositions);
      const size = nodeSizeForLayout(node);
      return {
        id: node.id(),
        name: node.data("name") || node.id(),
        year: numericChronologyYear(node.data("chronologyYear")),
        x: base.x,
        y: base.y,
        width: size.width,
        height: size.height,
      };
    });
    return layoutHelpers.createTemporalLayout(layoutNodes, {
      orientation: state.layoutOrientation,
    });
  }

  function preparedLayoutPositions(nodes) {
    const nodeArray = nodes.toArray();
    const basePositions = state.lineageRelayoutId ? lineageLayoutPositions(nodeArray) : null;
    const positions = state.chronology
      ? chronologicalLayoutPositions(nodeArray, basePositions)
      : basePositions;
    return orientPositions(positions);
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

  function capGraphZoom(maxZoom) {
    if (maxZoom === null || maxZoom === undefined) return;
    const limit = Number(maxZoom);
    if (!state.cy || !Number.isFinite(limit) || state.cy.zoom() <= limit) return;
    state.cy.zoom({
      level: limit,
      renderedPosition: {
        x: state.cy.width() / 2,
        y: state.cy.height() / 2,
      },
    });
  }

  function fitGraph(eles = visibleElements(), padding = 64, { maxZoom = null } = {}) {
    if (!state.cy || eles.length === 0) return;
    if (reducedMotion) {
      state.cy.fit(eles, padding);
      capGraphZoom(maxZoom);
      scheduleMiniMap();
      scheduleTimeline();
      return;
    }
    state.cy.animate({
      fit: { eles, padding },
      duration: 380,
      easing: "ease-out-cubic",
    });
    if (maxZoom !== null) {
      window.setTimeout(() => {
        capGraphZoom(maxZoom);
        scheduleMiniMap();
        scheduleTimeline();
      }, 410);
    }
    window.setTimeout(scheduleTimeline, reducedMotion ? 0 : 420);
  }

  function runLayout({ fit = true } = {}) {
    relayoutRun += 1;
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
          transform: (node, position) => orientPosition(position),
          fit: false,
          animate: !reducedMotion,
          animationDuration: 560,
          animationEasing: "ease-out-cubic",
        };

    state.cy.once("layoutstop", () => {
      if (fit) fitGraph(visibleElements(), 68);
      updateVisibleCount();
      scheduleMiniMap();
      scheduleTimeline();
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
      scheduleTimeline();
    }
  }

  function updateVisibleCount() {
    const visible = visibleNodes().length;
    const total = state.graph ? state.graph.nodes.length : 0;
    els.visibleCount.textContent = `${formatNumber(visible)} of ${formatNumber(total)} visible`;
  }

  function personLabel(id, fallback = "Selected person") {
    const person = model.peopleById.get(id);
    return person ? person.name : fallback;
  }

  function activeViewDescriptor() {
    if (state.currentPathIds.length) {
      const first = personLabel(state.currentPathIds[0], "Start");
      const last = personLabel(state.currentPathIds[state.currentPathIds.length - 1], "End");
      const title = state.pathRelayoutActive ? "Relayout path" : "Path";
      return {
        title,
        detail: `${first} to ${last} / ${state.currentPathIds.length} people`,
      };
    }
    if (state.lineageRelayoutId) {
      return {
        title: "Relayout lineage",
        detail: personLabel(state.lineageRelayoutId),
      };
    }
    if (state.traceId) {
      return {
        title: "Lineage trace",
        detail: personLabel(state.traceId),
      };
    }
    if (state.focusId) {
      return {
        title: "Focused branch",
        detail: personLabel(state.focusId),
      };
    }
    if (state.query) {
      return {
        title: "Search results",
        detail: state.query,
      };
    }
    if (state.chronology) {
      return {
        title: isHorizontalLayout() ? "Chronological x-axis" : "Chronological y-axis",
        detail: "Full tree",
      };
    }
    if (isHorizontalLayout()) {
      return {
        title: "Horizontal layout",
        detail: "Full tree",
      };
    }
    return null;
  }

  function hasActiveViewState() {
    return Boolean(activeViewDescriptor());
  }

  function syncViewNavigation() {
    const descriptor = activeViewDescriptor();
    const active = Boolean(descriptor);
    els.resetViewButton.hidden = !active;
    els.viewBanner.hidden = !active;
    if (els.graphStage) {
      els.graphStage.classList.toggle("is-path-relayout", state.pathRelayoutActive);
    }
    if (!active) return;
    els.viewTitle.textContent = descriptor.title;
    els.viewDetail.textContent = descriptor.detail || "";
    els.viewDetail.hidden = !descriptor.detail;
  }

  function updateModeLabel(text) {
    if (text) {
      els.modeLabel.textContent = text;
      syncViewNavigation();
      return;
    }
    if (state.currentPathIds.length) {
      const parts = [state.pathRelayoutActive ? "Relayout path" : "Path"];
      parts.push(`${state.currentPathIds.length} people`);
      if (state.chronology) {
        parts.push(isHorizontalLayout() ? "chronological x-axis" : "chronology");
      } else if (state.pathRelayoutActive) {
        parts.push(isHorizontalLayout() ? "temporal order + horizontal" : "temporal order");
      }
      els.modeLabel.textContent = parts.join(" / ");
      syncViewNavigation();
      return;
    }
    if (state.lineageRelayoutId) {
      const parts = ["Relayout lineage"];
      if (state.chronology) parts.push(isHorizontalLayout() ? "chronological x-axis" : "chronology");
      if (isHorizontalLayout() && !state.chronology) parts.push("horizontal");
      els.modeLabel.textContent = parts.join(" + ");
      syncViewNavigation();
      return;
    }
    if (state.traceId) {
      const person = model.peopleById.get(state.traceId);
      els.modeLabel.textContent = person ? `Lineage: ${person.name}` : "Lineage trace";
      syncViewNavigation();
      return;
    }
    if (state.focusId) {
      const person = model.peopleById.get(state.focusId);
      const label = person ? `Focused: ${person.name}` : "Focused branch";
      els.modeLabel.textContent = isHorizontalLayout() ? `${label} + horizontal` : label;
      syncViewNavigation();
      return;
    }
    if (state.chronology) {
      els.modeLabel.textContent = isHorizontalLayout() ? "Chronological x-axis" : "Chronological y-axis";
      syncViewNavigation();
      return;
    }
    if (isHorizontalLayout()) {
      els.modeLabel.textContent = "Horizontal layout";
      syncViewNavigation();
      return;
    }
    const active = [state.query].filter(Boolean).length;
    els.modeLabel.textContent = active ? `${active} filter${active === 1 ? "" : "s"}` : "Explore";
    syncViewNavigation();
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
    els.layoutOrientationInputs.forEach((input) => {
      input.checked = input.value === state.layoutOrientation;
    });
    els.chronologyToggle.checked = state.chronology;
  }

  function renderLegend(graph) {
    els.legend.replaceChildren();
    const people = legendPeople(graph);

    if (state.colorMode === "university" || state.colorMode === "country" || state.colorMode === "continent") {
      legendBucketEntries(state.colorMode, people).forEach((entry) => {
        const item = document.createElement("span");
        item.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = entry.color;
        if (entry.label === OTHER_BUCKET || entry.label === NULL_BUCKET) swatch.style.borderColor = "#aeb7c2";
        const text = document.createElement("span");
        text.textContent = `${entry.label} (${formatNumber(entry.count)})`;
        item.append(swatch, text);
        els.legend.append(item);
      });
      return;
    }

    const categoryCounts = new Map();
    people.forEach((person) => incrementCount(categoryCounts, person.category));
    graph.filters.categories.filter((category) => (
      category.id !== "alumni" && (categoryCounts.get(category.id) || 0) > 0
    )).forEach((category) => {
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

  function legendPeople(graph) {
    if (!state.cy) return graph.nodes;
    return visibleNodes().map((node) => node.data());
  }

  function legendBucketEntries(mode, people) {
    const counts = new Map();
    people.forEach((person) => {
      const labelByMode = {
        university: person.universityColorBucket,
        country: person.countryColorBucket,
        continent: person.continentColorBucket,
      };
      const entry = bucketEntry(mode, labelByMode[mode]);
      if (entry) incrementCount(counts, entry.label);
    });

    return model.colorBuckets[mode]
      .map((entry) => ({ ...entry, count: counts.get(entry.label) || 0 }))
      .filter((entry) => entry.count > 0);
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
    scheduleTimeline();
    writeUrlState();
  }

  function setColorMode(mode) {
    state.colorMode = COLOR_MODES.has(mode) ? mode : "category";
    els.colorModeInputs.forEach((input) => {
      input.checked = input.value === state.colorMode;
    });
    applyColorMode();
  }

  function syncTemporalEdgeStyle() {
    if (!state.cy) return;
    state.cy.edges().toggleClass("temporal-edge", state.chronology);
  }

  function setChronologyMode(enabled) {
    state.chronology = Boolean(enabled);
    syncTemporalEdgeStyle();
    const hadPath = state.currentPathIds.length > 0;
    if (state.chronology) {
      state.query = "";
      clearSearchUi();
      if (!hadPath) clearElementHighlights();
      applyFilters({ relayout: false });
    }
    if (state.pathRelayoutActive) {
      relayoutCurrentPath();
    } else if (state.lineageRelayoutId) {
      relayoutLineage(state.lineageRelayoutId);
    } else {
      runLayout({ fit: true });
    }
    updateModeLabel();
    scheduleTimeline();
    writeUrlState();
    if (hasActiveViewState()) revealGraphOnMobile();
  }

  function setLayoutOrientation(orientation) {
    const nextOrientation = ORIENTATIONS.has(orientation) ? orientation : DEFAULT_ORIENTATION;
    if (state.layoutOrientation === nextOrientation) return;
    state.layoutOrientation = nextOrientation;
    els.layoutOrientationInputs.forEach((input) => {
      input.checked = input.value === state.layoutOrientation;
    });
    if (state.pathRelayoutActive) {
      relayoutCurrentPath();
    } else if (state.lineageRelayoutId) {
      relayoutLineage(state.lineageRelayoutId);
    } else {
      runLayout({ fit: true });
    }
    updateModeLabel();
    scheduleTimeline();
    writeUrlState();
    if (hasActiveViewState()) revealGraphOnMobile();
  }

  function renderSearchResults(query) {
    els.searchResults.replaceChildren();
    const results = matchingSearchPeople(query).slice(0, 7);

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
        runPersonSearch(person.id);
      });
      els.searchResults.append(button);
    });
  }

  function resetViewForPersonSearch() {
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.traceId = "";
    state.query = "";
    clearPathState();
    state.cy.elements().removeClass("faded lineage path-node path-edge is-hidden");
    updateVisibleCount();
    updateModeLabel();
    renderLegend(state.graph);
    renderTimeline();
  }

  function runPersonSearch(preselectedId = "") {
    const rawValue = preselectedId || els.search.value;
    let personId = resolvePersonId(rawValue);
    const matches = matchingSearchPeople(rawValue);

    if (!personId && matches.length === 1) personId = matches[0].id;
    if (!personId) {
      renderSearchResults(rawValue);
      setSearchStatus(matches.length ? "" : "No listed person found.");
      return;
    }

    const person = model.peopleById.get(personId);
    els.search.value = person.name;
    clearSearchUi({ clearValue: false });
    resetViewForPersonSearch();
    selectPerson(personId, { center: true, revealProfile: true });
  }

  function scheduleSearchResults() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      setSearchStatus("");
      renderSearchResults(els.search.value);
    }, 80);
  }

  function selectPerson(id, { center = true, revealProfile = false } = {}) {
    const person = model.peopleById.get(id);
    if (!person || !state.cy) return;
    state.selectedId = id;
    state.cy.nodes().removeClass("selected");
    state.cy.$id(id).addClass("selected");
    renderProfile(person);
    syncSidePanel();
    writeUrlState();

    if (center) {
      const target = state.cy.$id(id).closedNeighborhood().not(".is-hidden");
      fitGraph(target.length ? target : state.cy.$id(id), 120);
    } else {
      scheduleTimeline();
    }
    if (revealProfile) revealProfileOnMobile();
  }

  function closeProfilePanel() {
    if (!state.cy) return;
    state.selectedId = "";
    state.cy.nodes().removeClass("selected");
    syncSidePanel();
    scheduleMiniMap();
    scheduleTimeline();
    writeUrlState();
  }

  function endpointCard(person, label) {
    const card = document.createElement("section");
    card.className = "path-endpoint-card";

    const labelElement = document.createElement("span");
    labelElement.className = "endpoint-label";
    labelElement.textContent = label;

    const header = document.createElement("div");
    header.className = "endpoint-card-header";
    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    avatar.textContent = initials(person.name);
    avatar.style.background = categoryColors[person.category] || "#30353b";
    const copy = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = person.name;
    const meta = document.createElement("p");
    meta.textContent = compactMeta(person);
    copy.append(name, meta);
    header.append(avatar, copy);

    const tags = document.createElement("div");
    tags.className = "tag-list";
    personTagValues(person).slice(0, 3).forEach((value) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = value;
      tags.append(tag);
    });

    card.append(labelElement, header);
    if (tags.childElementCount) card.append(tags);
    return card;
  }

  function renderPathPanel() {
    if (!state.currentPathIds.length) return;
    const source = model.peopleById.get(state.currentPathIds[0]);
    const target = model.peopleById.get(state.currentPathIds[state.currentPathIds.length - 1]);
    if (!source || !target) return;

    const links = Math.max(0, state.currentPathIds.length - 1);
    els.pathSummary.textContent = `${state.currentPathIds.length} people / ${links} link${links === 1 ? "" : "s"}`;
    els.pathEndpointList.replaceChildren(
      endpointCard(source, "From"),
      endpointCard(target, "To")
    );
    els.pathPanelRelayoutButton.hidden = state.currentPathIds.length < 2 || state.pathRelayoutActive;
  }

  function syncSidePanel({ resize = true } = {}) {
    const showPath = state.currentPathIds.length >= 2;
    const showProfile = !showPath && Boolean(state.selectedId && model.peopleById.has(state.selectedId));

    if (showPath) renderPathPanel();
    els.pathContent.hidden = !showPath;
    els.profileContent.hidden = !showProfile;
    els.emptyProfile.hidden = showPath || showProfile;
    els.appShell.classList.toggle("no-selection", !showPath && !showProfile);

    if (state.cy && resize) state.cy.resize();
  }

  function renderProfile(person) {
    els.emptyProfile.hidden = true;
    els.profileContent.hidden = false;
    els.pathContent.hidden = true;

    els.profileAvatar.textContent = initials(person.name);
    els.profileAvatar.style.background = categoryColors[person.category] || "#30353b";
    els.profileName.textContent = person.name;
    els.profileMeta.textContent = compactMeta(person);

    els.profileTags.replaceChildren();
    personTagValues(person).forEach((value) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = value;
      els.profileTags.append(tag);
    });

    renderSources(person.sources || []);
    renderRelations(els.advisorList, model.incoming.get(person.id).map((edge) => edge.source));
    renderRelations(els.studentList, model.outgoing.get(person.id).map((edge) => edge.target));
  }

  function renderSources(sources) {
    els.sourceList.replaceChildren();
    const sourceLinks = Array.isArray(sources)
      ? sources.filter((source) => source && source.url)
      : [];
    els.sourceBlock.hidden = sourceLinks.length === 0;
    if (!sourceLinks.length) return;

    sourceLinks.forEach((source) => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const labelText = sourceLabel(source);
      const hostText = hostnameForUrl(source.url);
      link.setAttribute("aria-label", hostText && hostText !== labelText ? `${labelText} source, ${hostText}` : `${labelText} source`);
      const label = document.createElement("strong");
      label.textContent = labelText;
      const host = document.createElement("span");
      host.textContent = hostText && hostText !== labelText ? ` ${hostText}` : "";
      link.append(label);
      if (host.textContent) link.append(host);
      els.sourceList.append(link);
    });
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
          selectPerson(person.id, { center: true, revealProfile: true });
        });
        container.append(button);
      });
  }

  function setPathActionVisible() {
    els.relayoutPathButton.hidden = state.currentPathIds.length < 2 || state.pathRelayoutActive;
    if (els.pathPanelRelayoutButton) {
      els.pathPanelRelayoutButton.hidden = state.currentPathIds.length < 2 || state.pathRelayoutActive;
    }
  }

  function clearPathState() {
    state.currentPathIds = [];
    state.currentPathEdgeIds = [];
    state.pathSourceId = "";
    state.pathTargetId = "";
    state.pathRelayoutRequested = false;
    state.pathRelayoutActive = false;
    setPathActionVisible();
    syncSidePanel({ resize: false });
  }

  function clearElementHighlights({ preservePathState = false } = {}) {
    if (!state.cy) return;
    state.cy.elements().removeClass("faded lineage path-node path-edge");
    if (!preservePathState) {
      state.traceId = "";
      clearPathState();
    }
    updateModeLabel();
  }

  function traceLineage(id = state.selectedId) {
    if (!id || !state.cy) return;
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.query = "";
    clearSearchUi();
    clearElementHighlights();
    applyFilters({ relayout: false });
    state.traceId = id;
    const node = state.cy.$id(id);
    const lineage = node.predecessors().union(node.successors()).union(node);
    state.cy.elements().addClass("faded");
    lineage.removeClass("faded").addClass("lineage");
    node.removeClass("lineage").addClass("selected");
    fitGraph(lineage.not(".is-hidden"), 94);
    updateModeLabel();
    writeUrlState();
    revealGraphOnMobile();
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

  async function relayoutLineage(id = state.selectedId) {
    if (!id || !state.cy) return;
    const runId = ++relayoutRun;
    state.focusId = id;
    state.lineageRelayoutId = id;
    state.traceId = "";
    state.query = "";
    clearSearchUi();

    clearElementHighlights();
    applyFilters({ relayout: false });

    const lineage = visibleElements();
    const nodes = visibleNodes().toArray();
    const edgeRecords = visibleEdgeRecordsForNodes(nodes);
    const elkPositions = await elkLayoutPositions(nodes, edgeRecords);
    if (runId !== relayoutRun || state.lineageRelayoutId !== id) return;
    const basePositions = elkPositions || lineageLayoutPositions(nodes);
    const rawPositions = state.chronology
      ? chronologicalLayoutPositions(nodes, basePositions)
      : basePositions;
    const positions = orientPositions(rawPositions);
    state.cy.elements().removeClass("faded lineage path-node path-edge");
    lineage.addClass("lineage");
    state.cy.$id(id).removeClass("lineage").addClass("selected");

    state.cy.once("layoutstop", () => {
      fitGraph(lineage, 96);
      updateVisibleCount();
      renderLegend(state.graph);
      scheduleMiniMap();
      scheduleTimeline();
    });
    lineage.layout({
      name: "preset",
      positions: (node) => positions.get(node.id()) || node.position(),
      fit: false,
      animate: !reducedMotion,
      animationDuration: 520,
      animationEasing: "ease-out-cubic",
    }).run();
    updateModeLabel();
    writeUrlState();
    revealGraphOnMobile();
  }

  function focusBranch(id = state.selectedId) {
    if (!id) return;
    state.lineageRelayoutId = "";
    state.traceId = "";
    state.focusId = state.focusId === id ? "" : id;
    if (state.focusId) {
      state.query = "";
      clearSearchUi();
    }
    clearElementHighlights();
    applyFilters({ relayout: true });
    if (state.selectedId) selectPerson(state.selectedId, { center: false });
    revealGraphOnMobile();
  }

  function clearAll() {
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.traceId = "";
    state.query = "";
    clearSearchUi();
    clearElementHighlights();
    applyFilters({ relayout: true });
  }

  function resetToFullTree() {
    if (!state.cy) return;
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.traceId = "";
    state.query = "";
    state.layoutOrientation = DEFAULT_ORIENTATION;
    state.chronology = false;
    syncTemporalEdgeStyle();
    renderTimeline();
    clearSearchUi();
    els.layoutOrientationInputs.forEach((input) => {
      input.checked = input.value === state.layoutOrientation;
    });
    els.chronologyToggle.checked = false;
    clearPathState();
    state.cy.elements().removeClass("faded lineage path-node path-edge is-hidden");
    if (state.selectedId) state.cy.$id(state.selectedId).addClass("selected");
    applyFilters({ relayout: true });
    revealGraphOnMobile();
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
    state.traceId = "";
    clearAllFiltersWithoutLayout();
    clearElementHighlights();
    state.selectedId = "";
    state.cy.nodes().removeClass("selected");
    const pathSet = new Set(pathIds);
    state.cy.elements().addClass("faded");
    pathIds.forEach((id) => state.cy.$id(id).removeClass("faded").addClass("path-node"));

    const edgeIds = [];
    for (let i = 0; i < pathIds.length - 1; i += 1) {
      const edgeId = model.edgeByPair.get(edgeKey(pathIds[i], pathIds[i + 1]));
      if (edgeId) edgeIds.push(edgeId);
    }

    edgeIds.forEach((id) => state.cy.$id(id).removeClass("faded").addClass("path-edge"));
    state.currentPathIds = pathIds;
    state.currentPathEdgeIds = edgeIds;
    state.pathSourceId = pathIds[0] || "";
    state.pathTargetId = pathIds[pathIds.length - 1] || "";
    state.pathRelayoutRequested = false;
    state.pathRelayoutActive = false;
    setPathActionVisible();
    syncSidePanel();
    const pathEles = collectionFromIds([...pathSet, ...edgeIds]);
    fitGraph(pathEles, isStackedLayout() ? 80 : 150, { maxZoom: isStackedLayout() ? 2.2 : 1.6 });
    updateModeLabel(`Path: ${pathIds.length} people`);
    writeUrlState();
    revealGraphOnMobile();
  }

  function pathLayoutPositions(pathIds) {
    const gap = 230;
    const offset = (pathIds.length - 1) * gap / 2;
    return new Map(pathIds.map((id, index) => [id, { x: 0, y: index * gap - offset }]));
  }

  function temporalYearsForPath(pathNodes) {
    const years = pathNodes.map((node) => numericChronologyYear(node.data("chronologyYear")));
    if (!years.some((year) => year !== null)) return null;

    return years.map((year, index) => {
      if (year !== null) return year;

      let previousIndex = index - 1;
      while (previousIndex >= 0 && years[previousIndex] === null) previousIndex -= 1;
      let nextIndex = index + 1;
      while (nextIndex < years.length && years[nextIndex] === null) nextIndex += 1;

      if (previousIndex >= 0 && nextIndex < years.length) {
        const span = nextIndex - previousIndex;
        const t = (index - previousIndex) / span;
        return years[previousIndex] + (years[nextIndex] - years[previousIndex]) * t;
      }
      if (previousIndex >= 0) return years[previousIndex] + (index - previousIndex) * 3;
      return years[nextIndex] - (nextIndex - index) * 3;
    });
  }

  function pathTemporalX(index, count, turnIndex, sideSpan) {
    if (count <= 1) return 0;
    if (count === 2) return 0;
    if (turnIndex <= 0) {
      return (index / Math.max(1, count - 1)) * sideSpan;
    }
    if (turnIndex >= count - 1) {
      return -sideSpan + (index / Math.max(1, count - 1)) * sideSpan;
    }
    const shoulder = Math.min(PATH_TEMPORAL_APEX_SHOULDER, sideSpan * 0.34);
    if (index <= turnIndex) {
      if (index === turnIndex) return 0;
      return -sideSpan + (index / Math.max(1, turnIndex - 1)) * (sideSpan - shoulder);
    }
    if (index === turnIndex + 1) return shoulder;
    return shoulder + ((index - turnIndex - 1) / Math.max(1, count - turnIndex - 2)) * (sideSpan - shoulder);
  }

  function pathTemporalLayoutPositions(pathNodes, { scaled = false } = {}) {
    const years = temporalYearsForPath(pathNodes);
    if (!years) return null;

    const count = pathNodes.length;
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const yearRange = Math.max(1, maxYear - minYear);
    const turnIndex = years.reduce((bestIndex, year, index) => (
      year < years[bestIndex] ? index : bestIndex
    ), 0);
    const sideSpan = clamp(
      count * PATH_TEMPORAL_SIDE_SPAN_PER_NODE,
      PATH_TEMPORAL_SIDE_SPAN_MIN,
      PATH_TEMPORAL_SIDE_SPAN_MAX
    );

    let yForIndex;
    if (scaled) {
      const targetHeight = clamp(
        count * PATH_TEMPORAL_PIXELS_PER_NODE,
        PATH_TEMPORAL_MIN_TIME_SPAN,
        PATH_TEMPORAL_MAX_TIME_SPAN
      );
      const yScale = clamp(
        targetHeight / yearRange,
        PATH_TEMPORAL_MIN_YEAR_GAP,
        PATH_TEMPORAL_MAX_YEAR_GAP
      );
      const yearCenter = (minYear + maxYear) / 2;
      yForIndex = (index) => (years[index] - yearCenter) * yScale;
    } else {
      const rankByIndex = new Map();
      years
        .map((year, index) => ({ year, index }))
        .sort((a, b) => a.year - b.year || a.index - b.index)
        .forEach((item, rank) => rankByIndex.set(item.index, rank));
      const offset = (count - 1) * PATH_TEMPORAL_RANK_GAP / 2;
      yForIndex = (index) => rankByIndex.get(index) * PATH_TEMPORAL_RANK_GAP - offset;
    }

    return new Map(pathNodes.map((node, index) => [node.id(), {
      x: pathTemporalX(index, count, turnIndex, sideSpan),
      y: yForIndex(index),
    }]));
  }

  function chronologyBaseForPath(pathNodes, pathIds, elkPositions) {
    const temporalPositions = pathTemporalLayoutPositions(pathNodes, { scaled: true });
    if (!temporalPositions) return elkPositions;
    if (!elkPositions) return temporalPositions;

    return new Map(pathIds.map((id) => {
      const temporal = temporalPositions.get(id);
      const elk = elkPositions.get(id);
      if (!temporal) return [id, elk];
      if (!elk) return [id, temporal];
      return [id, {
        x: temporal.x * 0.84 + elk.x * 0.16,
        y: temporal.y,
      }];
    }).filter(([, position]) => position));
  }

  async function relayoutCurrentPath() {
    if (!state.cy || state.currentPathIds.length < 2) return;
    const runId = ++relayoutRun;
    const expectedPathKey = state.currentPathIds.join("\u0000");
    const visiblePathIds = state.currentPathIds.filter((id) => {
      const node = state.cy.$id(id);
      return node.length && !node.hasClass("is-hidden");
    });
    if (visiblePathIds.length < 2) return;

    const pathNodes = visiblePathIds
      .map((id) => state.cy.$id(id))
      .filter((node) => node.length);
    const edgeRecords = pathEdgeRecords(visiblePathIds);
    const elkPositions = await elkLayoutPositions(pathNodes, edgeRecords);
    const samePath = state.currentPathIds.join("\u0000") === expectedPathKey;
    if (runId !== relayoutRun || !samePath) return;
    const basePositions = elkPositions || pathLayoutPositions(visiblePathIds);
    const temporalPositions = state.chronology
      ? chronologicalLayoutPositions(pathNodes, chronologyBaseForPath(pathNodes, visiblePathIds, elkPositions || basePositions))
      : pathTemporalLayoutPositions(pathNodes, { scaled: false });
    const rawPositions = temporalPositions
      || (state.chronology ? chronologicalLayoutPositions(pathNodes, basePositions) : basePositions);
    const positions = orientPositions(compactStackedPathPositions(rawPositions));
    const visibleEdgeIds = state.currentPathEdgeIds.filter((id) => {
      const edge = state.cy.$id(id);
      return edge.length && !edge.hasClass("is-hidden");
    });
    const relayoutIds = new Set([...visiblePathIds, ...visibleEdgeIds]);
    const pathEles = collectionFromIds([...visiblePathIds, ...visibleEdgeIds]);
    state.pathRelayoutActive = true;
    state.pathRelayoutRequested = true;
    state.pathSourceId = visiblePathIds[0] || state.pathSourceId;
    state.pathTargetId = visiblePathIds[visiblePathIds.length - 1] || state.pathTargetId;
    setPathActionVisible();
    state.cy.elements().removeClass("lineage");
    state.cy.elements().forEach((element) => {
      element.toggleClass("is-hidden", !relayoutIds.has(element.id()));
    });
    pathEles.nodes().removeClass("faded").addClass("path-node");
    pathEles.edges().removeClass("faded").addClass("path-edge");
    syncSidePanel();

    state.cy.once("layoutstop", () => {
      fitGraph(pathEles, isStackedLayout() ? 92 : 120, { maxZoom: isStackedLayout() ? 2.4 : 1.8 });
      updateVisibleCount();
      scheduleMiniMap();
      scheduleTimeline();
    });
    pathEles.layout({
      name: "preset",
      positions: (node) => positions.get(node.id()) || node.position(),
      fit: false,
      animate: !reducedMotion,
      animationDuration: 520,
      animationEasing: "ease-out-cubic",
    }).run();
    updateModeLabel();
    writeUrlState();
    revealGraphOnMobile();
  }

  function clearAllFiltersWithoutLayout() {
    state.focusId = "";
    state.lineageRelayoutId = "";
    state.traceId = "";
    state.query = "";
    clearSearchUi();
    state.cy.elements().removeClass("is-hidden");
    updateVisibleCount();
    renderLegend(state.graph);
    writeUrlState();
  }

  function runPathSearch() {
    const sourceId = resolvePersonId(els.pathFrom.value);
    const targetId = resolvePersonId(els.pathTo.value);
    if (!sourceId || !targetId) {
      els.pathStatus.textContent = "Choose two listed people.";
      return;
    }
    if (sourceId === targetId) {
      els.pathStatus.textContent = "Choose two different people.";
      return;
    }

    const pathIds = findShortestPath(sourceId, targetId);
    if (!pathIds.length) {
      els.pathStatus.textContent = "No connected path found.";
      return;
    }

    highlightPath(pathIds);
    const source = model.peopleById.get(sourceId);
    const target = model.peopleById.get(targetId);
    const links = pathIds.length - 1;
    els.pathStatus.textContent = `${source.name} to ${target.name}: ${links} link${links === 1 ? "" : "s"}.`;
    if (typeof els.pathDialog.close === "function") {
      els.pathDialog.close();
    } else {
      els.pathDialog.removeAttribute("open");
    }
  }

  async function restorePathFromUrl() {
    const sourceId = resolvePersonId(state.pathSourceId);
    const targetId = resolvePersonId(state.pathTargetId);
    if (!sourceId || !targetId) return false;

    const shouldRelayout = state.pathRelayoutRequested;
    const pathIds = findShortestPath(sourceId, targetId);
    if (!pathIds.length) {
      clearPathState();
      writeUrlState();
      return false;
    }

    highlightPath(pathIds);
    if (shouldRelayout) await relayoutCurrentPath();
    return true;
  }

  function scheduleMiniMap() {
    if (miniFrame) return;
    miniFrame = window.requestAnimationFrame(() => {
      miniFrame = 0;
      updateMiniMap();
    });
  }

  function scheduleTimeline() {
    if (timelineFrame) return;
    timelineFrame = window.requestAnimationFrame(() => {
      timelineFrame = 0;
      renderTimeline();
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
    const miniPoint = (position) => ({
      x: offsetX + (position.x - bb.x1) * scale,
      y: offsetY + (position.y - bb.y1) * scale,
    });
    const group = document.createElementNS(ns, "g");
    const miniNodes = nodes.toArray().map((node) => {
      const fill = node.data("fillColor") || categoryColors[node.data("category")] || "#68707a";
      return {
        node,
        fill,
        whiteFill: fill.toLowerCase() === "#ffffff" || fill.toLowerCase() === "white",
      };
    }).sort((a, b) => {
      if (a.whiteFill === b.whiteFill) return 0;
      return a.whiteFill ? -1 : 1;
    });

    miniNodes.forEach(({ node, fill }) => {
      const point = miniPoint(node.position());
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", point.x);
      circle.setAttribute("cy", point.y);
      circle.setAttribute("r", node.hasClass("selected") ? "3.1" : "2.1");
      circle.setAttribute("fill", fill);
      circle.setAttribute("opacity", node.hasClass("faded") ? "0.28" : "0.78");
      group.append(circle);
    });
    els.miniMap.append(group);

    const activeGroup = document.createElementNS(ns, "g");
    const activeNodeIds = new Set();
    visibleElements().edges(".lineage, .path-edge").forEach((edge) => {
      const source = edge.source();
      const target = edge.target();
      if (!source.length || !target.length) return;
      activeNodeIds.add(source.id());
      activeNodeIds.add(target.id());
      const sourcePoint = miniPoint(source.position());
      const targetPoint = miniPoint(target.position());
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", sourcePoint.x);
      line.setAttribute("y1", sourcePoint.y);
      line.setAttribute("x2", targetPoint.x);
      line.setAttribute("y2", targetPoint.y);
      line.setAttribute("stroke", "#ffd166");
      line.setAttribute("stroke-width", edge.hasClass("path-edge") ? "2.5" : "2");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("opacity", "0.92");
      activeGroup.append(line);
    });

    nodes.toArray().forEach((node) => {
      if (!node.hasClass("lineage") && !node.hasClass("path-node") && !node.hasClass("selected") && !activeNodeIds.has(node.id())) return;
      const point = miniPoint(node.position());
      const fill = node.data("fillColor") || categoryColors[node.data("category")] || "#68707a";
      const halo = document.createElementNS(ns, "circle");
      halo.setAttribute("cx", point.x);
      halo.setAttribute("cy", point.y);
      halo.setAttribute("r", node.hasClass("selected") ? "5.2" : "4.2");
      halo.setAttribute("fill", "#ffd166");
      halo.setAttribute("opacity", node.hasClass("faded") ? "0.36" : "0.82");
      activeGroup.append(halo);

      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", point.x);
      dot.setAttribute("cy", point.y);
      dot.setAttribute("r", node.hasClass("selected") ? "2.9" : "2.2");
      dot.setAttribute("fill", fill);
      dot.setAttribute("opacity", node.hasClass("faded") ? "0.44" : "0.95");
      activeGroup.append(dot);
    });
    els.miniMap.append(activeGroup);

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
    view.setAttribute("stroke", "#eef2f7");
    view.setAttribute("stroke-width", "1.4");
    view.setAttribute("rx", "3");
    els.miniMap.append(view);
  }

  function svgElement(name, attrs = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  }

  function clearTimeline() {
    if (!els.timelinePanel || !els.timelineAxis) return;
    els.timelineAxis.replaceChildren();
    els.timelinePanel.hidden = true;
  }

  function timelineAxisItems() {
    if (!state.cy) return [];
    const horizontal = isHorizontalLayout();
    return visibleNodes().toArray()
      .map((node) => {
        const year = numericChronologyYear(node.data("chronologyYear"));
        const position = node.position();
        const coord = horizontal ? Number(position.x) : Number(position.y);
        if (year === null || !Number.isFinite(coord)) return null;
        return { year, coord };
      })
      .filter(Boolean);
  }

  function timelineYearLabel(year) {
    return String(Math.round(year));
  }

  function timelineTickYears(minYear, maxYear, pixelsPerYear) {
    if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) return [];
    const ticks = new Map();
    const centuryStart = Math.floor(minYear / TIMELINE_CENTURY_STEP) * TIMELINE_CENTURY_STEP;
    const centuryEnd = Math.floor(maxYear / TIMELINE_CENTURY_STEP) * TIMELINE_CENTURY_STEP;
    for (let year = centuryStart; year <= centuryEnd; year += TIMELINE_CENTURY_STEP) {
      ticks.set(year, { year, kind: "century" });
    }

    const decadeSpacing = Math.abs(pixelsPerYear * TIMELINE_DECADE_STEP);
    if (decadeSpacing >= TIMELINE_DECADE_MIN_SCREEN_GAP) {
      const decadeStart = Math.floor(minYear / TIMELINE_DECADE_STEP) * TIMELINE_DECADE_STEP;
      const decadeEnd = Math.floor(maxYear / TIMELINE_DECADE_STEP) * TIMELINE_DECADE_STEP;
      for (let year = decadeStart; year <= decadeEnd; year += TIMELINE_DECADE_STEP) {
        if (!ticks.has(year)) ticks.set(year, { year, kind: "decade" });
      }
    }

    return [...ticks.values()].sort((a, b) => a.year - b.year);
  }

  function renderTimeline() {
    if (!state.chronology || !state.cy || !els.timelinePanel || !els.timelineAxis) {
      clearTimeline();
      return;
    }

    const horizontal = isHorizontalLayout();
    els.timelinePanel.hidden = false;
    els.timelinePanel.classList.toggle("is-horizontal", horizontal);
    els.timelinePanel.classList.toggle("is-vertical", !horizontal);

    const items = timelineAxisItems();
    if (!items.length) {
      clearTimeline();
      return;
    }

    const nodes = visibleNodes();
    if (!nodes.length) {
      clearTimeline();
      return;
    }

    const panelRect = els.timelinePanel.getBoundingClientRect();
    const width = Math.max(1, Math.round(panelRect.width));
    const height = Math.max(1, Math.round(panelRect.height));
    const nodeBounds = nodes.boundingBox({ includeLabels: false });
    const graphPad = 260;
    const years = items.map((item) => item.year);
    const coords = items.map((item) => item.coord);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const minCoord = Math.min(...coords);
    const maxCoord = Math.max(...coords);
    const yearSpan = maxYear - minYear;
    const coordSpan = maxCoord - minCoord;
    const axisMidpoint = (minCoord + maxCoord) / 2;
    const yearToCoord = yearSpan <= 0
      ? () => axisMidpoint
      : (year) => minCoord + ((year - minYear) / yearSpan) * coordSpan;

    els.timelineAxis.setAttribute("viewBox", `0 0 ${width} ${height}`);
    els.timelineAxis.setAttribute("preserveAspectRatio", "none");
    els.timelineAxis.setAttribute(
      "aria-label",
      horizontal ? "Chronological x-axis grid" : "Chronological y-axis grid"
    );
    els.timelineAxis.replaceChildren();
    const pan = state.cy.pan();
    const zoom = state.cy.zoom();
    const safeZoom = Math.max(zoom, 0.001);
    const graphX1 = nodeBounds.x1 - graphPad;
    const graphX2 = nodeBounds.x2 + graphPad;
    const graphY1 = nodeBounds.y1 - graphPad;
    const graphY2 = nodeBounds.y2 + graphPad;
    const viewportOverflow = (value, min, max) => {
      if (value < min) return min - value;
      if (value > max) return value - max;
      return 0;
    };
    const leftLabelX = nodeBounds.x1 - 64 / safeZoom;
    const rightLabelX = nodeBounds.x2 + 64 / safeZoom;
    const topLabelY = nodeBounds.y1 - 42 / safeZoom;
    const bottomLabelY = nodeBounds.y2 + 42 / safeZoom;
    const useRightLabel = viewportOverflow(pan.x + zoom * rightLabelX, 24, width - 24)
      <= viewportOverflow(pan.x + zoom * leftLabelX, 24, width - 24);
    const useBottomLabel = viewportOverflow(pan.y + zoom * bottomLabelY, 20, height - 20)
      <= viewportOverflow(pan.y + zoom * topLabelY, 20, height - 20);
    const verticalLabelX = clamp(pan.x + zoom * (useRightLabel ? rightLabelX : leftLabelX), 34, width - 18);
    const verticalLabelAnchor = verticalLabelX > width / 2 ? "end" : "start";
    const horizontalLabelY = clamp(pan.y + zoom * (useBottomLabel ? bottomLabelY : topLabelY), 16, height - 14);
    const layer = svgElement("g", {
      class: "timeline-grid-layer",
      transform: `translate(${pan.x} ${pan.y}) scale(${zoom})`,
    });
    els.timelineAxis.append(layer);

    const pixelsPerYear = yearSpan <= 0 ? 0 : Math.abs((coordSpan / yearSpan) * zoom);
    const ticks = timelineTickYears(minYear, maxYear, pixelsPerYear);

    ticks
      .forEach(({ year, kind }) => {
        const coord = yearToCoord(year);
        if (horizontal) {
          layer.append(svgElement("line", {
            class: `timeline-grid-line is-${kind}`,
            x1: coord,
            x2: coord,
            y1: graphY1,
            y2: graphY2,
          }));
          const label = svgElement("text", {
            class: `timeline-grid-year is-${kind}`,
            x: pan.x + zoom * coord,
            y: horizontalLabelY,
            "text-anchor": "middle",
          });
          label.textContent = timelineYearLabel(year);
          els.timelineAxis.append(label);
        } else {
          layer.append(svgElement("line", {
            class: `timeline-grid-line is-${kind}`,
            x1: graphX1,
            x2: graphX2,
            y1: coord,
            y2: coord,
          }));
          const label = svgElement("text", {
            class: `timeline-grid-year is-${kind}`,
            x: verticalLabelX,
            y: pan.y + zoom * coord,
            "text-anchor": verticalLabelAnchor,
            "dominant-baseline": "central",
          });
          label.textContent = timelineYearLabel(year);
          els.timelineAxis.append(label);
        }
      });
  }

  function splitExportName(name, maxLength = 22) {
    const text = String(name || "").trim();
    if (text.length <= maxLength || !text.includes(" ")) return [text];
    const words = text.split(/\s+/);
    let bestIndex = 1;
    let bestDifference = Number.POSITIVE_INFINITY;
    for (let index = 1; index < words.length; index += 1) {
      const left = words.slice(0, index).join(" ");
      const right = words.slice(index).join(" ");
      const difference = Math.abs(left.length - right.length);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = index;
      }
    }
    return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")];
  }

  function nodeBoundaryPoint(from, to, width, height) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { ...from };
    const scale = 1 / Math.max(
      Math.abs(dx) / Math.max(1, width / 2),
      Math.abs(dy) / Math.max(1, height / 2)
    );
    return {
      x: from.x + dx * scale,
      y: from.y + dy * scale,
    };
  }

  function appendExportTimeline(svg, nodes, bounds) {
    if (!state.chronology || nodes.length < 2) return;
    const horizontal = isHorizontalLayout();
    const items = nodes
      .map((node) => {
        const year = numericChronologyYear(node.data("chronologyYear"));
        const position = node.position();
        if (year === null) return null;
        return { year, coord: horizontal ? position.x : position.y };
      })
      .filter(Boolean);
    if (items.length < 2) return;

    const years = items.map((item) => item.year);
    const coords = items.map((item) => item.coord);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const minCoord = Math.min(...coords);
    const maxCoord = Math.max(...coords);
    const yearSpan = maxYear - minYear;
    if (yearSpan <= 0) return;
    const yearToCoord = (year) => minCoord + ((year - minYear) / yearSpan) * (maxCoord - minCoord);
    const pixelsPerYear = Math.abs((maxCoord - minCoord) / yearSpan);
    const group = svgElement("g", { "aria-label": "Chronological grid" });
    timelineTickYears(minYear, maxYear, pixelsPerYear).forEach(({ year, kind }) => {
      const coord = yearToCoord(year);
      const line = horizontal
        ? svgElement("line", {
            x1: coord,
            x2: coord,
            y1: bounds.y1,
            y2: bounds.y2,
          })
        : svgElement("line", {
            x1: bounds.x1,
            x2: bounds.x2,
            y1: coord,
            y2: coord,
          });
      line.setAttribute("stroke", kind === "century" ? "#ffd166" : "#eef2f7");
      line.setAttribute("stroke-opacity", kind === "century" ? "0.38" : "0.14");
      line.setAttribute("stroke-width", kind === "century" ? "1.4" : "1");
      if (kind === "decade") line.setAttribute("stroke-dasharray", "3 7");
      group.append(line);

      const label = svgElement("text", {
        x: horizontal ? coord : bounds.x1 + 16,
        y: horizontal ? bounds.y1 + 18 : coord,
        fill: kind === "century" ? "#fff0b8" : "#cbd5e1",
        "font-family": "Inter, Arial, sans-serif",
        "font-size": kind === "century" ? 11 : 9,
        "font-weight": "bold",
        "text-anchor": horizontal ? "middle" : "start",
        "dominant-baseline": horizontal ? "auto" : "central",
      });
      label.textContent = timelineYearLabel(year);
      group.append(label);
    });
    svg.append(group);
  }

  function buildExportSvg() {
    if (!state.cy) throw new Error("The graph is not ready to export.");
    const elements = visibleElements();
    const nodes = visibleNodes().toArray();
    if (!nodes.length) throw new Error("There are no visible people to export.");
    const edges = elements.edges().toArray();
    const graphBounds = elements.boundingBox({ includeLabels: true, includeOverlays: false });
    const bounds = {
      x1: graphBounds.x1 - EXPORT_PADDING,
      y1: graphBounds.y1 - EXPORT_PADDING,
      x2: graphBounds.x2 + EXPORT_PADDING,
      y2: graphBounds.y2 + EXPORT_PADDING,
    };
    const width = Math.max(1, bounds.x2 - bounds.x1);
    const height = Math.max(1, bounds.y2 - bounds.y1);
    const svg = svgElement("svg", {
      xmlns: SVG_NS,
      width,
      height,
      viewBox: `${bounds.x1} ${bounds.y1} ${width} ${height}`,
      role: "img",
      "aria-label": "CMU MechE Family Tree export",
    });
    const title = svgElement("title");
    title.textContent = "CMU MechE Family Tree";
    svg.append(title);
    svg.append(svgElement("rect", {
      x: bounds.x1,
      y: bounds.y1,
      width,
      height,
      fill: EXPORT_BACKGROUND,
    }));

    appendExportTimeline(svg, nodes, bounds);

    const definitions = svgElement("defs");
    const marker = svgElement("marker", {
      id: "advisor-arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
      markerUnits: "strokeWidth",
    });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#96a3b3" }));
    definitions.append(marker);
    svg.append(definitions);

    const nodesById = new Map(nodes.map((node) => [node.id(), node]));
    const edgeGroup = svgElement("g", {
      fill: "none",
      "stroke-linecap": "round",
    });
    edges.forEach((edge) => {
      const source = nodesById.get(edge.data("source"));
      const target = nodesById.get(edge.data("target"));
      if (!source || !target) return;
      const sourcePosition = source.position();
      const targetPosition = target.position();
      const sourceSize = nodeSizeForLayout(source);
      const targetSize = nodeSizeForLayout(target);
      const start = nodeBoundaryPoint(sourcePosition, targetPosition, sourceSize.width, sourceSize.height);
      const end = nodeBoundaryPoint(targetPosition, sourcePosition, targetSize.width, targetSize.height);
      const highlighted = edge.hasClass("lineage") || edge.hasClass("path-edge");
      edgeGroup.append(svgElement("line", {
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke: highlighted ? "#ffd166" : "#96a3b3",
        "stroke-width": highlighted ? 3 : (state.chronology ? 1 : 1.25),
        "stroke-opacity": edge.hasClass("faded") ? 0.1 : (highlighted ? 0.95 : (state.chronology ? 0.42 : 0.72)),
        "marker-end": "url(#advisor-arrow)",
      }));
    });
    svg.append(edgeGroup);

    const nodeGroup = svgElement("g");
    nodes.forEach((node) => {
      const position = node.position();
      const { width: nodeWidth, height: nodeHeight } = nodeSizeForLayout(node);
      const highlighted = node.hasClass("selected") || node.hasClass("lineage") || node.hasClass("path-node");
      const group = svgElement("g", {
        opacity: node.hasClass("faded") ? 0.16 : 1,
      });
      group.append(svgElement("rect", {
        x: position.x - nodeWidth / 2,
        y: position.y - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
        rx: 9,
        fill: node.data("fillColor") || "#ffffff",
        stroke: highlighted ? "#ffd166" : (node.data("borderColor") || "#6f7b8a"),
        "stroke-width": highlighted ? 3.5 : 2.5,
      }));
      const nameLines = splitExportName(node.data("name"));
      const yearLabel = String(node.data("yearLabel") || "").trim();
      const lines = yearLabel ? [...nameLines, yearLabel] : nameLines;
      const lineHeight = lines.length > 2 ? 10 : 11;
      const text = svgElement("text", {
        x: position.x,
        y: position.y - ((lines.length - 1) * lineHeight) / 2 + 3,
        fill: node.data("labelColor") || "#1c1f23",
        "font-family": "Inter, Arial, sans-serif",
        "font-size": lines.length > 2 ? 8.7 : 9.5,
        "font-weight": "bold",
        "text-anchor": "middle",
      });
      lines.forEach((line, index) => {
        const span = svgElement("tspan", {
          x: position.x,
          dy: index === 0 ? 0 : lineHeight,
        });
        span.textContent = line;
        text.append(span);
      });
      group.append(text);
      nodeGroup.append(group);
    });
    svg.append(nodeGroup);

    const heading = svgElement("text", {
      x: bounds.x1 + 20,
      y: bounds.y1 + 30,
      fill: "#ffffff",
      "font-family": "Inter, Arial, sans-serif",
      "font-size": 20,
      "font-weight": "bold",
    });
    heading.textContent = "CMU MechE Family Tree";
    svg.append(heading);
    const descriptor = activeViewDescriptor();
    const subtitle = svgElement("text", {
      x: bounds.x1 + 20,
      y: bounds.y1 + 50,
      fill: "#cbd5e1",
      "font-family": "Inter, Arial, sans-serif",
      "font-size": 10,
      "font-weight": "normal",
    });
    subtitle.textContent = `${formatNumber(nodes.length)} people · ${formatNumber(edges.length)} links · ${descriptor ? descriptor.title : "Full tree"}`;
    svg.append(subtitle);

    return { svg, width, height };
  }

  function serializeExportSvg(svg) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function svgImage(markup) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Unable to render the SVG for PNG export."));
      };
      image.src = url;
    });
  }

  function canvasPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to create the PNG image."));
      }, "image/png");
    });
  }

  async function downloadGraphExport(format) {
    if (!exportHelpers) throw new Error("Export helpers failed to load.");
    const normalizedFormat = String(format || "").toLowerCase();
    const { svg, width, height } = buildExportSvg();
    const filename = exportHelpers.exportFileName(normalizedFormat);
    if (normalizedFormat === "svg") {
      downloadBlob(
        new Blob([serializeExportSvg(svg)], { type: "image/svg+xml;charset=utf-8" }),
        filename
      );
      return "Vector SVG downloaded.";
    }
    if (normalizedFormat === "png") {
      const dimensions = exportHelpers.rasterDimensions(width, height);
      const image = await svgImage(serializeExportSvg(svg));
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG rendering is not supported by this browser.");
      context.fillStyle = EXPORT_BACKGROUND;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      downloadBlob(await canvasPngBlob(canvas), filename);
      return `High-resolution PNG downloaded (${dimensions.width} × ${dimensions.height}).`;
    }
    if (normalizedFormat === "pdf") {
      const JsPdf = window.jspdf && window.jspdf.jsPDF;
      if (!JsPdf) throw new Error("PDF support failed to load.");
      const page = exportHelpers.pdfPageDimensions(width, height);
      const pdf = new JsPdf({
        orientation: page.orientation,
        unit: "pt",
        format: [page.width, page.height],
        compress: true,
      });
      if (typeof pdf.svg !== "function") throw new Error("Vector PDF support failed to load.");
      await pdf.svg(svg, { x: 0, y: 0, width: page.width, height: page.height });
      downloadBlob(pdf.output("blob"), filename);
      return "Vector PDF downloaded.";
    }
    throw new Error(`Unsupported export format: ${normalizedFormat || "unknown"}.`);
  }

  function setExportMenuOpen(open, { focusFirst = false } = {}) {
    if (!els.exportPopover || !els.exportButton) return;
    const expanded = Boolean(open);
    els.exportPopover.hidden = !expanded;
    els.exportButton.setAttribute("aria-expanded", String(expanded));
    if (expanded && focusFirst) els.exportOptions[0]?.focus();
  }

  async function runGraphExport(format) {
    const label = els.exportButton.querySelector("span");
    const previousLabel = label ? label.textContent : "Export";
    els.exportOptions.forEach((option) => { option.disabled = true; });
    if (label) label.textContent = "Working";
    els.exportStatus.textContent = `Preparing ${String(format).toUpperCase()}…`;
    try {
      els.exportStatus.textContent = await downloadGraphExport(format);
    } catch (error) {
      els.exportStatus.textContent = error.message || "Export failed.";
      console.error(error);
    } finally {
      els.exportOptions.forEach((option) => { option.disabled = false; });
      if (label) label.textContent = previousLabel;
    }
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

  function readMiniPanelPosition() {
    try {
      const raw = window.localStorage.getItem(MINI_PANEL_STORAGE_KEY);
      if (!raw) return null;
      const position = JSON.parse(raw);
      const x = Number(position.x);
      const y = Number(position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    } catch {
      return null;
    }
  }

  function writeMiniPanelPosition(position) {
    try {
      window.localStorage.setItem(MINI_PANEL_STORAGE_KEY, JSON.stringify(position));
    } catch {
      // Dragging should still work when localStorage is unavailable.
    }
  }

  function clearMiniPanelPosition() {
    try {
      window.localStorage.removeItem(MINI_PANEL_STORAGE_KEY);
    } catch {
      // Nothing to reset if localStorage is unavailable.
    }
  }

  function clampMiniPanelPosition(x, y) {
    const stageRect = els.miniPanel.parentElement.getBoundingClientRect();
    const panelRect = els.miniPanel.getBoundingClientRect();
    const maxX = Math.max(MINI_PANEL_MARGIN, stageRect.width - panelRect.width - MINI_PANEL_MARGIN);
    const maxY = Math.max(MINI_PANEL_MARGIN, stageRect.height - panelRect.height - MINI_PANEL_MARGIN);
    return {
      x: clamp(x, MINI_PANEL_MARGIN, maxX),
      y: clamp(y, MINI_PANEL_MARGIN, maxY),
    };
  }

  function placeMiniPanel(x, y, { persist = false } = {}) {
    if (!els.miniPanel) return;
    const position = clampMiniPanelPosition(x, y);
    els.miniPanel.style.left = `${position.x}px`;
    els.miniPanel.style.top = `${position.y}px`;
    els.miniPanel.style.right = "auto";
    els.miniPanel.style.bottom = "auto";
    if (persist) writeMiniPanelPosition(position);
  }

  function resetMiniPanelPosition() {
    if (!els.miniPanel) return;
    els.miniPanel.style.left = "";
    els.miniPanel.style.top = "";
    els.miniPanel.style.right = "";
    els.miniPanel.style.bottom = "";
    clearMiniPanelPosition();
  }

  function restoreMiniPanelPosition() {
    const position = readMiniPanelPosition();
    if (!position) return;
    window.requestAnimationFrame(() => placeMiniPanel(position.x, position.y, { persist: false }));
  }

  function clampCurrentMiniPanelPosition() {
    if (!els.miniPanel || !els.miniPanel.style.left || !els.miniPanel.style.top) return;
    const x = Number.parseFloat(els.miniPanel.style.left);
    const y = Number.parseFloat(els.miniPanel.style.top);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    placeMiniPanel(x, y, { persist: true });
  }

  function startMiniPanelDrag(event) {
    if (!els.miniPanel || !els.miniPanelHandle) return;
    if (event.button !== undefined && event.button !== 0) return;

    event.preventDefault();
    const panelRect = els.miniPanel.getBoundingClientRect();
    const offsetX = event.clientX - panelRect.left;
    const offsetY = event.clientY - panelRect.top;

    function movePanel(pointerEvent) {
      const stageRect = els.miniPanel.parentElement.getBoundingClientRect();
      placeMiniPanel(
        pointerEvent.clientX - stageRect.left - offsetX,
        pointerEvent.clientY - stageRect.top - offsetY
      );
    }

    function stopDrag() {
      els.miniPanel.classList.remove("is-dragging");
      els.miniPanelHandle.removeEventListener("pointermove", movePanel);
      els.miniPanelHandle.removeEventListener("pointerup", stopDrag);
      els.miniPanelHandle.removeEventListener("pointercancel", stopDrag);
      const x = Number.parseFloat(els.miniPanel.style.left);
      const y = Number.parseFloat(els.miniPanel.style.top);
      if (Number.isFinite(x) && Number.isFinite(y)) writeMiniPanelPosition({ x, y });
      try {
        els.miniPanelHandle.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }

    els.miniPanel.classList.add("is-dragging");
    els.miniPanelHandle.setPointerCapture(event.pointerId);
    els.miniPanelHandle.addEventListener("pointermove", movePanel);
    els.miniPanelHandle.addEventListener("pointerup", stopDrag);
    els.miniPanelHandle.addEventListener("pointercancel", stopDrag);
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
    els.search.addEventListener("input", scheduleSearchResults);
    els.search.addEventListener("focus", () => renderSearchResults(els.search.value));
    els.search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runPersonSearch();
        return;
      }
      if (event.key === "Escape") clearSearchUi();
    });
    els.searchButton.addEventListener("click", () => runPersonSearch());
    els.colorModeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) setColorMode(input.value);
      });
    });
    els.layoutOrientationInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) setLayoutOrientation(input.value);
      });
    });
    els.chronologyToggle.addEventListener("change", () => setChronologyMode(els.chronologyToggle.checked));
    els.fitButton.addEventListener("click", () => fitGraph(visibleElements(), 68));
    els.focusButton.addEventListener("click", () => focusBranch());
    els.traceButton.addEventListener("click", () => traceLineage());
    els.relayoutLineageButton.addEventListener("click", () => relayoutLineage());
    els.resetViewButton.addEventListener("click", resetToFullTree);
    els.clearViewButton.addEventListener("click", resetToFullTree);
    els.profileCloseButton.addEventListener("click", closeProfilePanel);
    els.relayoutPathButton.addEventListener("click", relayoutCurrentPath);
    els.pathPanelCloseButton.addEventListener("click", resetToFullTree);
    els.pathPanelRelayoutButton.addEventListener("click", relayoutCurrentPath);
    els.pathPanelClearButton.addEventListener("click", resetToFullTree);
    els.shareButton.addEventListener("click", copyShareLink);
    els.exportButton.addEventListener("click", () => {
      setExportMenuOpen(els.exportPopover.hidden, { focusFirst: false });
    });
    els.exportOptions.forEach((option) => {
      option.addEventListener("click", () => runGraphExport(option.dataset.exportFormat));
    });
    document.addEventListener("click", (event) => {
      if (!els.exportPopover.hidden && !els.exportMenu.contains(event.target)) {
        setExportMenuOpen(false);
      }
    });
    els.miniMap.addEventListener("click", panFromMiniMap);
    els.miniPanelHandle.addEventListener("pointerdown", startMiniPanelDrag);
    els.miniPanelHandle.addEventListener("dblclick", resetMiniPanelPosition);
    restoreMiniPanelPosition();

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
      clampCurrentMiniPanelPosition();
      scheduleMiniMap();
      scheduleTimeline();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.exportPopover.hidden) {
        setExportMenuOpen(false);
        els.exportButton.focus();
        return;
      }
      if (event.key !== "Escape" || els.pathDialog.open) return;
      if (hasActiveViewState()) {
        resetToFullTree();
        return;
      }
      if (state.selectedId) closeProfilePanel();
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
    if (!layoutHelpers || !exportHelpers) {
      showError(new Error("Graph helpers failed to load."));
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
      syncTemporalEdgeStyle();
      attachEvents();
      applyFilters({ relayout: false });

      const hasPathUrl = Boolean(state.pathSourceId && state.pathTargetId);
      const hasDeferredView = Boolean(
        hasPathUrl || state.lineageRelayoutId || state.traceId || state.focusId
      );
      if (!hasDeferredView) runLayout({ fit: true });

      if (state.selectedId && model.peopleById.has(state.selectedId)) {
        selectPerson(state.selectedId, { center: !hasDeferredView });
      }

      let handledDeferredView = false;
      const restoredPath = hasPathUrl ? await restorePathFromUrl() : false;
      if (restoredPath) {
        handledDeferredView = true;
      } else if (state.lineageRelayoutId && model.peopleById.has(state.lineageRelayoutId)) {
        await relayoutLineage(state.lineageRelayoutId);
        handledDeferredView = true;
      } else if (state.traceId && model.peopleById.has(state.traceId)) {
        if (!state.selectedId) selectPerson(state.traceId, { center: false });
        traceLineage(state.traceId);
        handledDeferredView = true;
      } else if (state.focusId && model.peopleById.has(state.focusId)) {
        applyFilters({ relayout: true });
        handledDeferredView = true;
      }

      if (hasDeferredView && !handledDeferredView) {
        runLayout({ fit: true });
      }

      els.loading.hidden = true;
    } catch (error) {
      showError(error);
      console.error(error);
    }
  }

  init();
})();
