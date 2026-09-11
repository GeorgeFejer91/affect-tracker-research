import {
  affectPaletteColor,
  buildFlubberPath,
  clamp,
  createProfiles,
  createProjectionOffsets,
} from "../math.js";
import { createResponsiveFaceGeometry } from "./responsive-face.js";
import { DEFAULT_PREVIEW_TILE_COUNT, parsePreviewTileCount, previewTileGeometry, previewTileLines } from "./preview-tiles.js";

const profiles = createProfiles();
const offsets = createProjectionOffsets("affect-research-v1-preview");
const TWO_PI = Math.PI * 2;
const PREVIEW_MODES = new Set(["legacy", "flubber", "grid", "face"]);
const RESPONSE_MODES = new Set(["continuous", "stepwise"]);
const DEFAULT_COLORS = Object.freeze({
  up: "#f2c94c",
  down: "#2f80ed",
  left: "#eb5757",
  right: "#27ae60",
  idle: "#9ca3af",
  outline: "#f8fafc",
  halo: "#93c5fd",
  cursor: "#ffffff",
});

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeHex(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function setElementHidden(element, hidden) {
  if (element instanceof HTMLElement) {
    element.hidden = hidden;
  } else if (element instanceof SVGElement) {
    element.toggleAttribute("hidden", hidden);
  }
}

function normalizedState(source = {}) {
  const colors = source.colors ?? {};
  const flubber = source.flubber ?? {};
  const grid = source.grid ?? {};
  const position = source.position ?? {};
  return {
    x: clamp(finite(source.x, 0)),
    y: clamp(finite(source.y, 0)),
    gridVisible: source.gridVisible !== false,
    flubberVisible: source.flubberVisible !== false,
    hideFeedback: source.hideFeedback === true,
    sizePercent: clamp(finite(source.sizePercent, 32), 5, 100),
    transparencyPercent: clamp(finite(source.transparencyPercent, 5), 0, 100),
    position: {
      x: clamp(finite(position.x, 0.5), 0, 1),
      y: clamp(finite(position.y, 0.5), 0, 1),
    },
    lockPosition: source.lockPosition === true,
    displayMode: PREVIEW_MODES.has(source.displayMode) ? source.displayMode : "legacy",
    responseMode: RESPONSE_MODES.has(source.responseMode) ? source.responseMode : "stepwise",
    tileCount: parsePreviewTileCount(source.tileCount) ?? DEFAULT_PREVIEW_TILE_COUNT,
    tileRows: parsePreviewTileCount(source.tileRows ?? source.tileCount) ?? DEFAULT_PREVIEW_TILE_COUNT,
    colors: {
      up: normalizeHex(colors.up, DEFAULT_COLORS.up),
      down: normalizeHex(colors.down, DEFAULT_COLORS.down),
      left: normalizeHex(colors.left, DEFAULT_COLORS.left),
      right: normalizeHex(colors.right, DEFAULT_COLORS.right),
      idle: normalizeHex(colors.idle, DEFAULT_COLORS.idle),
      outline: normalizeHex(colors.outline, DEFAULT_COLORS.outline),
      halo: normalizeHex(colors.halo, DEFAULT_COLORS.halo),
      cursor: normalizeHex(colors.cursor, DEFAULT_COLORS.cursor),
    },
    flubber: {
      showOutline: flubber.showOutline !== false,
      outlineThickness: clamp(finite(flubber.outlineThickness, 2), 0, 20),
      showHalo: flubber.showHalo !== false,
      haloSizePercent: clamp(finite(flubber.haloSizePercent, 100), 100, 240),
    },
    grid: {
      lineThickness: clamp(finite(grid.lineThickness, 1), 0.25, 20),
      showOutline: grid.showOutline !== false,
      outlineThickness: clamp(finite(grid.outlineThickness, 2), 0, 20),
      cursorSize: clamp(finite(grid.cursorSize, 14), 2, 100),
    },
    frequency: clamp(finite(source.frequency, 1.5), 0, 10),
    amplitude: clamp(finite(source.amplitude, 0.3), 0, 1),
    edgeSmoothness: clamp(finite(source.edgeSmoothness, 0.5), 0, 1),
    pulseSynchrony: clamp(finite(source.pulseSynchrony, 0.6), 0, 1),
    waveVariation: clamp(finite(source.waveVariation, 0.4), 0, 1),
    saturation: clamp(finite(source.saturation, Math.hypot(finite(source.x, 0), finite(source.y, 0))), 0, 1),
  };
}

function formatCoordinate(value) {
  const number = clamp(finite(value, 0));
  return `${number >= 0 ? "+" : ""}${number.toFixed(3)}`;
}

export function drawAffectField(canvas, colors) {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const size = 72;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  const image = context.createImageData(size, size);
  for (let row = 0; row < size; row += 1) {
    const y = 1 - (row / (size - 1)) * 2;
    for (let column = 0; column < size; column += 1) {
      const x = (column / (size - 1)) * 2 - 1;
      const cssColor = affectPaletteColor(x, y, colors);
      const channels = cssColor.match(/\d+/g)?.map(Number) ?? [183, 183, 183];
      const offset = (row * size + column) * 4;
      image.data[offset] = channels[0];
      image.data[offset + 1] = channels[1];
      image.data[offset + 2] = channels[2];
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export function createResearchPreview(root, options = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("Research preview root must be an HTMLElement");
  }

  const stage = root.matches(".research-preview-stage")
    ? root
    : root.querySelector(".research-preview-stage");
  if (!(stage instanceof HTMLElement)) {
    throw new Error("Research preview stage is missing");
  }

  const overlay = stage.querySelector("[data-preview-overlay]");
  const primaryStage = stage.querySelector(".preview-primary-stage") ?? stage;
  const gridCanvas = stage.querySelector("[data-preview-grid-canvas]");
  const gridSvg = stage.querySelector("[data-preview-grid]");
  const gridLines = [...stage.querySelectorAll("[data-preview-grid-line]")];
  const gridOutline = stage.querySelector("[data-preview-grid-outline]");
  const gridCursor = stage.querySelector("[data-preview-grid-cursor]");
  const flubberSvg = stage.querySelector("[data-preview-flubber]");
  const flubberBase = stage.querySelector("[data-preview-flubber-base]");
  const flubberOutline = stage.querySelector("[data-preview-flubber-outline]");
  const flubberHalo = stage.querySelector("[data-preview-flubber-halo]");
  const haloBlur = stage.querySelector("[data-preview-halo-blur]");
  const controlCanvas = stage.querySelector("[data-preview-control-canvas]");
  const controlGrid = stage.querySelector("[data-preview-control-grid]");
  const tileLines = [...stage.querySelectorAll("[data-preview-tile-lines]")];
  const activeTiles = [...stage.querySelectorAll("[data-preview-active-tile]")];
  const tileStatus = stage.querySelector("[data-preview-tile-status]");
  const controlOutline = stage.querySelector("[data-preview-control-outline]");
  const controlCursor = stage.querySelector("[data-preview-control-cursor]");
  const faceSvg = stage.querySelector("[data-preview-face]");
  const faceHead = stage.querySelector("[data-preview-face-head]");
  const faceBrows = {
    left: stage.querySelector('[data-preview-face-brow="left"]'),
    right: stage.querySelector('[data-preview-face-brow="right"]'),
  };
  const faceEyes = {
    left: stage.querySelector('[data-preview-face-eye="left"]'),
    right: stage.querySelector('[data-preview-face-eye="right"]'),
  };
  const facePupils = {
    left: stage.querySelector('[data-preview-face-pupil="left"]'),
    right: stage.querySelector('[data-preview-face-pupil="right"]'),
  };
  const faceMouthShape = stage.querySelector("[data-preview-face-mouth-shape]");
  const faceMouthLine = stage.querySelector("[data-preview-face-mouth-line]");
  const studio = stage.getAttribute("data-preview-variant") === "studio";

  if (!(overlay instanceof HTMLElement) || !(gridCanvas instanceof HTMLCanvasElement)
    || !(gridSvg instanceof SVGElement) || !(gridCursor instanceof SVGElement)
    || !(flubberSvg instanceof SVGElement) || !(flubberBase instanceof SVGPathElement)
    || !(flubberOutline instanceof SVGPathElement) || !(flubberHalo instanceof SVGPathElement)) {
    throw new Error("Research preview markup is incomplete");
  }

  let state = normalizedState(options.initialState);
  let frameId = 0;
  let lastFrame = performance.now();
  let phase = 0;
  let paletteFingerprint = "";
  let renderedTileCount = null;
  let draggingPointer = null;

  function setPositionFromPointer(event) {
    const bounds = primaryStage.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const position = {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
    state = normalizedState({ ...state, position });
    options.onPositionChange?.(position);
    renderStatic();
  }

  function renderStatic() {
    const fingerprint = `${state.colors.up}:${state.colors.down}:${state.colors.left}:${state.colors.right}`;
    if (fingerprint !== paletteFingerprint) {
      paletteFingerprint = fingerprint;
      drawAffectField(gridCanvas, state.colors);
      if (controlCanvas instanceof HTMLCanvasElement) drawAffectField(controlCanvas, state.colors);
    }

    const outputMode = studio ? state.displayMode : "legacy";
    const gridVisible = outputMode === "grid" || (outputMode === "legacy" && state.gridVisible);
    const flubberVisible = outputMode === "flubber" || (outputMode === "legacy" && state.flubberVisible);
    const faceVisible = outputMode === "face";
    const tiled = studio && state.responseMode === "stepwise";
    overlay.hidden = state.hideFeedback || (!gridVisible && !flubberVisible && !faceVisible);
    overlay.dataset.locked = String(state.lockPosition);
    overlay.style.setProperty("--overlay-left", `${state.position.x * 100}%`);
    overlay.style.setProperty("--overlay-top", `${state.position.y * 100}%`);
    overlay.style.setProperty("--overlay-size", `${state.sizePercent}%`);
    overlay.style.setProperty("--overlay-opacity", String(1 - state.transparencyPercent / 100));
    overlay.style.setProperty("--outline-color", state.colors.outline);
    overlay.style.setProperty("--halo-color", state.colors.halo);
    overlay.style.setProperty("--cursor-color", state.colors.cursor);
    stage.style.setProperty("--cursor-color", state.colors.cursor);

    setElementHidden(gridCanvas, !gridVisible);
    setElementHidden(gridSvg, !gridVisible);
    setElementHidden(flubberSvg, !flubberVisible);
    setElementHidden(faceSvg, !faceVisible);
    for (const line of gridLines) {
      setElementHidden(line, tiled);
      line.style.strokeWidth = String(state.grid.lineThickness);
    }
    setElementHidden(gridCursor, tiled);
    if (gridOutline instanceof SVGElement) {
      setElementHidden(gridOutline, !state.grid.showOutline);
      gridOutline.style.strokeWidth = String(state.grid.outlineThickness);
    }
    gridCursor.setAttribute("cx", String(((state.x + 1) / 2) * 100));
    gridCursor.setAttribute("cy", String((1 - (state.y + 1) / 2) * 100));
    gridCursor.setAttribute("r", String(state.grid.cursorSize));
    setElementHidden(flubberOutline, !state.flubber.showOutline);
    flubberOutline.style.strokeWidth = String(state.flubber.outlineThickness);
    setElementHidden(flubberHalo, !state.flubber.showHalo);
    const haloWidth = state.flubber.haloSizePercent / 100;
    flubberHalo.style.strokeWidth = String(Math.max(1, state.flubber.outlineThickness * 3) * (studio ? haloWidth : 1));
    // The studio halo uses the exact animated outline; only its stroke spreads.
    // Fill and white outline paint above the fade, keeping the inner edge crisp.
    flubberHalo.setAttribute("transform", `scale(${studio ? 1 : haloWidth})`);
    if (studio && haloBlur instanceof SVGElement) {
      haloBlur.setAttribute("stdDeviation", String(0.03 * haloWidth));
    }

    if (controlGrid instanceof SVGElement && controlCursor instanceof SVGElement) {
      controlGrid.dataset.responseMode = state.responseMode;
      setElementHidden(controlCursor, tiled);
      if (controlOutline instanceof SVGElement) {
        controlOutline.style.strokeWidth = String(state.grid.outlineThickness);
      }
      controlCursor.setAttribute("cx", String(((state.x + 1) / 2) * 100));
      controlCursor.setAttribute("cy", String((1 - (state.y + 1) / 2) * 100));
    }

    if (studio) {
      const dimensions = `${state.tileCount}:${state.tileRows}`;
      if (tiled && renderedTileCount !== dimensions) {
        const path = previewTileLines(state.tileCount, state.tileRows);
        for (const line of tileLines) {
          line.setAttribute("d", path);
          line.setAttribute("stroke-width", String(Math.min(0.4, 8 / Math.max(state.tileCount, state.tileRows))));
          line.style.strokeWidth = String(Math.min(0.4, 8 / Math.max(state.tileCount, state.tileRows)));
        }
        renderedTileCount = dimensions;
      }
      for (const line of tileLines) setElementHidden(line, !tiled);
      const tile = previewTileGeometry(state.x, state.y, state.tileCount, state.tileRows);
      for (const highlight of activeTiles) {
        setElementHidden(highlight, !tiled);
        const stroke = Math.min(1.1, Math.min(tile.width, tile.height) * 0.12);
        highlight.style.setProperty("--tile-outline-width", String(stroke));
        for (const rectangle of highlight.querySelectorAll("rect")) {
          // Essential paint geometry must also work without the page stylesheet.
          rectangle.setAttribute("stroke-width", String(stroke * (rectangle.getAttribute("data-preview-tile-edge") === "contrast" ? 2 : 1)));
          rectangle.setAttribute("x", String(tile.x + stroke));
          rectangle.setAttribute("y", String(tile.y + stroke));
          rectangle.setAttribute("width", String(tile.width - stroke * 2));
          rectangle.setAttribute("height", String(tile.height - stroke * 2));
        }
      }
      if (tileStatus instanceof HTMLElement) {
        tileStatus.hidden = !tiled;
        const label = `Current tile: column ${tile.column + 1} of ${state.tileCount}, row ${tile.row + 1} of ${state.tileRows}.`;
        if (tileStatus.textContent !== label) tileStatus.textContent = label;
      }
    }

    for (const anchor of stage.querySelectorAll("[data-color-anchor]")) {
      const id = anchor.getAttribute("data-color-anchor");
      if (id && Object.hasOwn(state.colors, id)) anchor.style.setProperty("--anchor-color", state.colors[id]);
    }

    if (faceSvg instanceof SVGElement && faceHead instanceof SVGElement
      && faceBrows.left instanceof SVGElement && faceBrows.right instanceof SVGElement
      && faceEyes.left instanceof SVGElement && faceEyes.right instanceof SVGElement
      && facePupils.left instanceof SVGElement && facePupils.right instanceof SVGElement
      && faceMouthShape instanceof SVGElement && faceMouthLine instanceof SVGElement) {
      const geometry = createResponsiveFaceGeometry({ valence: state.x, arousal: state.y });
      faceHead.setAttribute("cx", String(geometry.face.cx));
      faceHead.setAttribute("cy", String(geometry.face.cy));
      faceHead.setAttribute("rx", String(geometry.face.rx));
      faceHead.setAttribute("ry", String(geometry.face.ry));
      for (const side of ["left", "right"]) {
        faceBrows[side].setAttribute("d", geometry.brows[side].d);
        faceEyes[side].setAttribute("cx", String(geometry.eyes[side].cx));
        faceEyes[side].setAttribute("cy", String(geometry.eyes[side].cy));
        faceEyes[side].setAttribute("rx", String(geometry.eyes[side].rx));
        faceEyes[side].setAttribute("ry", String(geometry.eyes[side].ry));
        facePupils[side].setAttribute("cx", String(geometry.eyes[side].cx));
        facePupils[side].setAttribute("cy", String(geometry.eyes[side].cy));
      }
      faceMouthShape.setAttribute("d", geometry.mouth.shape.d);
      faceMouthLine.setAttribute("d", geometry.mouth.center.d);
    }
    stage.setAttribute(
      "aria-label",
      `${studio ? `${outputMode === "grid" ? "2D Grid" : outputMode === "face" ? "Responsive Face" : "Classic Flubber"} design preview.` : "Visual feedback preview."} Position ${Math.round(state.position.x * 100)} percent across and ${Math.round(state.position.y * 100)} percent down. ${state.lockPosition ? "Position locked." : "Pointer dragging is available; keyboard users can set the two normalized position fields."}`,
    );
    root.querySelectorAll("[data-preview-x]").forEach((output) => { output.textContent = formatCoordinate(state.x); });
    root.querySelectorAll("[data-preview-y]").forEach((output) => { output.textContent = formatCoordinate(state.y); });
    root.querySelectorAll("[data-preview-position]").forEach((output) => {
      output.textContent = `${state.position.x.toFixed(2)}, ${state.position.y.toFixed(2)}`;
    });
  }

  function renderFrame(now) {
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      phase = (phase + deltaSeconds * TWO_PI * state.frequency) % TWO_PI;
    }
    const rendered = buildFlubberPath({
      profiles,
      offsets,
      x: state.x,
      y: state.y,
      phase,
      palette: state.colors,
      projectionAmplitude: state.amplitude,
      edgeSmoothness: state.edgeSmoothness,
      pulseSynchrony: state.pulseSynchrony,
      amplitudeVariation: state.waveVariation,
      colorSaturation: state.saturation,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const idle = Math.hypot(state.x, state.y) < 0.005;
    overlay.style.setProperty("--flubber-color", idle ? state.colors.idle : rendered.color);
    overlay.style.setProperty("--face-color", idle ? state.colors.idle : rendered.color);
    flubberBase.setAttribute("d", rendered.path);
    flubberOutline.setAttribute("d", rendered.path);
    flubberHalo.setAttribute("d", rendered.path);
    frameId = requestAnimationFrame(renderFrame);
  }

  function onPointerDown(event) {
    if (state.lockPosition || event.button !== 0) return;
    draggingPointer = event.pointerId;
    overlay.dataset.dragging = "true";
    overlay.setPointerCapture(event.pointerId);
    setPositionFromPointer(event);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (event.pointerId !== draggingPointer) return;
    setPositionFromPointer(event);
    event.preventDefault();
  }

  function finishPointer(event) {
    if (event.pointerId !== draggingPointer) return;
    draggingPointer = null;
    delete overlay.dataset.dragging;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
  }

  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", finishPointer);
  overlay.addEventListener("pointercancel", finishPointer);

  renderStatic();
  frameId = requestAnimationFrame(renderFrame);

  return Object.freeze({
    update(nextState) {
      const square = Object.hasOwn(nextState, "tileCount") && !Object.hasOwn(nextState, "tileRows")
        ? { tileRows: nextState.tileCount } : {};
      state = normalizedState({ ...state, ...nextState, ...square });
      renderStatic();
    },
    snapshot() {
      return structuredClone(state);
    },
    destroy() {
      cancelAnimationFrame(frameId);
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", finishPointer);
      overlay.removeEventListener("pointercancel", finishPointer);
    },
  });
}

export { DEFAULT_COLORS, formatCoordinate, normalizedState as normalizePreviewState };
