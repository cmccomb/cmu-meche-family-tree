(() => {
  const DATA_URL = "graph-data.json";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const categoryColors = {
    "cmu-faculty": "#b00",
    "alumni": "#4f7cac",
    "unknown-lineage": "#3e8c69",
    "missing-advisor": "#c28a16",
    "follow-up": "#d45f16",
  };

  const els = {
    appShell: document.getElementById("appShell"),
    cy: document.getElementById("cy"),
    loading: document.getElementById("loadingOverlay"),
    search: document.getElementById("searchInput"),
    peopleOptions: document.getElementById("peopleOptions"),
    searchResults: document.getElementById("searchResults"),
    eraFilter: document.getElementById("eraFilter"),
    roleFilter: document.getElementById("roleFilter"),
    categoryFilter: document.getElementById("categoryFilter"),
    guidedChips: document.getElementById("guidedChips"),
    clearButton: document.getElementById("clearButton"),
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
    era: "",
    role: "",
    category: "",
    focusId: "",
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
  };

  let filterTimer = 0;
  let miniFrame = 0;

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value || 0);
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
      person.role,
      person.era,
      person.categoryLabel,
      person.yearLabel,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function edgeKey(a, b) {
    return `${a}::${b}`;
  }

  function resolvePersonId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (model.peopleById.has(raw)) return raw;
    return model.peopleByName.get(raw.toLowerCase()) || "";
  }

  function createOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    state.selectedId = params.get("person") || "";
    state.query = params.get("q") || "";
    state.era = params.get("era") || "";
    state.role = params.get("role") || "";
    state.category = params.get("category") || "";
    state.focusId = params.get("focus") || "";
  }

  function writeUrlState() {
    const params = new URLSearchParams();
    if (state.selectedId) params.set("person", state.selectedId);
    if (state.query) params.set("q", state.query);
    if (state.era) params.set("era", state.era);
    if (state.role) params.set("role", state.role);
    if (state.category) params.set("category", state.category);
    if (state.focusId) params.set("focus", state.focusId);
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

    graph.nodes.forEach((person) => {
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
      const size = Math.max(42, Math.min(78, 38 + Math.sqrt(degree + 1) * 9));
      const layout = person.layout || {};
      const x = Number(layout.x);
      const y = Number(layout.y);
      const position = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
      return {
        data: {
          ...person,
          label: `${person.name}\n${person.yearLabel || ""}`,
          size,
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
            width: "data(size)",
            height: "data(size)",
            "background-color": "#4f7cac",
            "border-width": 2,
            "border-color": "#ffffff",
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": 132,
            "text-valign": "center",
            "text-halign": "right",
            "text-margin-x": 10,
            color: "#1c1f23",
            "font-family": "Inter, system-ui, sans-serif",
            "font-size": 10,
            "font-weight": "bold",
            "line-height": 1.15,
            "text-outline-width": 3,
            "text-outline-color": "#ffffff",
            "min-zoomed-font-size": 7,
            "overlay-padding": 6,
            "transition-property": "background-color, border-color, opacity, width, height",
            "transition-duration": reducedMotion ? 0 : 160,
          },
        },
        {
          selector: 'node[category = "cmu-faculty"]',
          style: {
            "background-color": categoryColors["cmu-faculty"],
            width: "mapData(degree, 0, 16, 54, 86)",
            height: "mapData(degree, 0, 16, 54, 86)",
          },
        },
        {
          selector: 'node[category = "unknown-lineage"]',
          style: { "background-color": categoryColors["unknown-lineage"] },
        },
        {
          selector: 'node[category = "missing-advisor"]',
          style: {
            "background-color": categoryColors["missing-advisor"],
          },
        },
        {
          selector: 'node[category = "follow-up"]',
          style: { "background-color": categoryColors["follow-up"] },
        },
        {
          selector: "edge",
          style: {
            width: 1.35,
            "curve-style": "bezier",
            "line-color": "#aeb7c2",
            "target-arrow-color": "#aeb7c2",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.8,
            opacity: 0.72,
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
    const options = hasPresetLayout(nodes)
      ? {
          name: "preset",
          positions: (node) => nodeLayoutPosition(node) || node.position(),
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
    if (state.era && person.era !== state.era) return false;
    if (state.role && person.role !== state.role) return false;
    if (state.category && person.category !== state.category) return false;
    if (focusSet && !focusSet.has(person.id)) return false;
    if (queryContext && !queryContext.context.has(person.id)) return false;
    return true;
  }

  function applyFilters({ relayout = true } = {}) {
    if (!state.cy || !state.graph) return;

    state.query = els.search.value.trim();
    state.era = els.eraFilter.value;
    state.role = els.roleFilter.value;
    state.category = els.categoryFilter.value;

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
    if (state.focusId) {
      const person = model.peopleById.get(state.focusId);
      els.modeLabel.textContent = person ? `Focused: ${person.name}` : "Focused branch";
      return;
    }
    const active = [state.query, state.era, state.role, state.category].filter(Boolean).length;
    els.modeLabel.textContent = active ? `${active} filter${active === 1 ? "" : "s"}` : "Explore";
  }

  function populateControls(graph) {
    els.nodeCount.textContent = formatNumber(graph.meta.nodeCount);
    els.edgeCount.textContent = formatNumber(graph.meta.edgeCount);
    els.facultyCount.textContent = formatNumber(graph.meta.facultyCount);

    graph.filters.eras.forEach((era) => createOption(els.eraFilter, era, era));
    graph.filters.roles.forEach((role) => createOption(els.roleFilter, role, role));
    graph.filters.categories.forEach((category) => {
      createOption(els.categoryFilter, category.id, category.label);
    });

    graph.nodes.forEach((person) => {
      const option = document.createElement("option");
      option.value = person.name;
      els.peopleOptions.append(option);
    });

    renderGuidedChips(graph);
    renderLegend(graph);

    els.search.value = state.query;
    els.eraFilter.value = state.era;
    els.roleFilter.value = state.role;
    els.categoryFilter.value = state.category;
  }

  function renderGuidedChips(graph) {
    els.guidedChips.replaceChildren();

    const categories = new Map(graph.filters.categories.map((category) => [category.id, category.label]));
    const chips = [];
    if (categories.has("cmu-faculty")) {
      chips.push({ label: "CMU faculty", count: graph.meta.facultyCount, category: "cmu-faculty" });
    }
    if (graph.filters.eras.includes("2020-present")) {
      const count = graph.nodes.filter((node) => node.era === "2020-present").length;
      chips.push({ label: "Recent graduates", count, era: "2020-present" });
    }
    if (categories.has("unknown-lineage")) {
      const count = graph.nodes.filter((node) => node.category === "unknown-lineage").length;
      chips.push({ label: "Unknown lineage", count, category: "unknown-lineage" });
    }
    if (categories.has("follow-up")) {
      chips.push({ label: "Follow-up needed", count: graph.meta.followUpCount, category: "follow-up" });
    }
    if (categories.has("missing-advisor")) {
      chips.push({ label: "No advisor recorded", count: graph.meta.missingAdvisorCount, category: "missing-advisor" });
    }

    chips.filter((chip) => chip.count > 0).forEach((chip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.era = chip.era || "";
      button.dataset.category = chip.category || "";

      const label = document.createElement("span");
      label.textContent = chip.label;
      const count = document.createElement("small");
      count.textContent = formatNumber(chip.count);
      button.append(label, count);

      button.addEventListener("click", () => {
        clearElementHighlights();
        state.focusId = "";
        els.search.value = "";
        els.eraFilter.value = chip.era || "";
        els.roleFilter.value = "";
        els.categoryFilter.value = chip.category || "";
        applyFilters({ relayout: true });
      });
      els.guidedChips.append(button);
    });
  }

  function renderLegend(graph) {
    els.legend.replaceChildren();
    graph.filters.categories.forEach((category) => {
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
      person.categoryLabel,
      person.era,
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
    clearElementHighlights();
    const node = state.cy.$id(id);
    const lineage = node.predecessors().union(node.successors()).union(node);
    state.cy.elements().addClass("faded");
    lineage.removeClass("faded").addClass("lineage");
    node.removeClass("lineage").addClass("selected");
    fitGraph(lineage.not(".is-hidden"), 94);
    updateModeLabel("Lineage trace");
  }

  function focusBranch(id = state.selectedId) {
    if (!id) return;
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
    state.category = "";
    state.era = "";
    state.role = "";
    state.query = "";
    els.search.value = "";
    els.searchResults.replaceChildren();
    els.eraFilter.value = "";
    els.roleFilter.value = "";
    els.categoryFilter.value = "";
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
    state.query = "";
    state.era = "";
    state.role = "";
    state.category = "";
    els.search.value = "";
    els.eraFilter.value = "";
    els.roleFilter.value = "";
    els.categoryFilter.value = "";
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
      circle.setAttribute("fill", categoryColors[node.data("category")] || "#68707a");
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
    els.eraFilter.addEventListener("change", () => applyFilters({ relayout: true }));
    els.roleFilter.addEventListener("change", () => applyFilters({ relayout: true }));
    els.categoryFilter.addEventListener("change", () => applyFilters({ relayout: true }));
    els.clearButton.addEventListener("click", clearAll);
    els.fitButton.addEventListener("click", () => fitGraph(visibleElements(), 68));
    els.focusButton.addEventListener("click", () => focusBranch());
    els.traceButton.addEventListener("click", () => traceLineage());
    els.focusBranchButton.addEventListener("click", () => focusBranch());
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
