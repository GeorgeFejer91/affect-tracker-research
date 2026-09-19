// Presentation-only HSV picker. The owning dialog decides when a draft is saved.
const bound = (value, max = 1) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

export function hsvToHex({ h, s, v }) {
  const hue = bound(h, 360) / 60;
  const saturation = bound(s);
  const brightness = bound(v);
  const chroma = brightness * saturation;
  const x = chroma * (1 - Math.abs(hue % 2 - 1));
  const sector = Math.floor(hue) % 6;
  const channels = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector];
  return `#${channels.map(channel => Math.round((channel + brightness - chroma) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToHsv(hex, fallbackHue = 0) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/iu.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = bound(fallbackHue, 360);
  if (delta > 0) {
    h = (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
    h = (h + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function createInlineColorPicker(root, { onChange = () => {} } = {}) {
  const map = root.querySelector("[data-inline-color-map]");
  const hue = root.querySelector("[data-inline-color-hue]");
  const strip = root.querySelector("[data-inline-hue-strip]");
  const status = root.querySelector("[data-inline-color-status]");
  if (!(map instanceof HTMLCanvasElement) || !(strip instanceof HTMLCanvasElement) || !(hue instanceof HTMLInputElement)) {
    throw new TypeError("Inline color picker markup is incomplete.");
  }
  let hsv = { h: 0, s: 1, v: 1 };
  let pointer = null;
  let destroyed = false;
  const listeners = [];
  const listen = (element, type, handler) => {
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  };

  const hueContext = strip.getContext("2d");
  if (hueContext) {
    const gradient = hueContext.createLinearGradient(0, 0, strip.width, 0);
    for (let step = 0; step <= 6; step += 1) gradient.addColorStop(step / 6, hsvToHex({ h: step * 60, s: 1, v: 1 }));
    hueContext.fillStyle = gradient;
    hueContext.fillRect(0, 0, strip.width, strip.height);
  }

  function paint() {
    const context = map.getContext("2d");
    if (context) {
      const { width, height } = map;
      context.fillStyle = hsvToHex({ h: hsv.h, s: 1, v: 1 });
      context.fillRect(0, 0, width, height);
      const white = context.createLinearGradient(0, 0, width, 0);
      white.addColorStop(0, "#ffffff"); white.addColorStop(1, "#ffffff00");
      context.fillStyle = white; context.fillRect(0, 0, width, height);
      const black = context.createLinearGradient(0, 0, 0, height);
      black.addColorStop(0, "#00000000"); black.addColorStop(1, "#000000");
      context.fillStyle = black; context.fillRect(0, 0, width, height);
      // Keep the selection ring wholly visible even on a map edge.
      const x = Math.max(7, Math.min(width - 7, hsv.s * width));
      const y = Math.max(7, Math.min(height - 7, (1 - hsv.v) * height));
      context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2);
      context.strokeStyle = "#111310"; context.lineWidth = 4; context.stroke();
      context.strokeStyle = "#ffffff"; context.lineWidth = 2; context.stroke();
    }
    hue.value = String(hsv.h);
    hue.setAttribute("aria-valuetext", `${Math.round(hsv.h)} degrees`);
    const description = `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%.`;
    map.setAttribute("aria-label", `Color map. ${description} Use left/right for saturation, up/down for brightness. Shift makes larger steps.`);
    if (status) status.textContent = description;
  }

  function emit() { paint(); onChange(hsvToHex(hsv)); }
  function point(event) {
    const rect = map.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    hsv.s = bound((event.clientX - rect.left) / rect.width);
    hsv.v = 1 - bound((event.clientY - rect.top) / rect.height);
    emit();
  }
  function release() {
    const captured = pointer;
    pointer = null;
    if (captured !== null && map.hasPointerCapture(captured)) map.releasePointerCapture(captured);
  }
  listen(map, "pointerdown", event => {
    if (event.button !== 0 || pointer !== null) return;
    pointer = event.pointerId; map.setPointerCapture(pointer); map.focus();
    point(event); event.preventDefault();
  });
  listen(map, "pointermove", event => { if (event.pointerId === pointer) point(event); });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    listen(map, type, event => { if (event.pointerId === pointer) release(); });
  }
  listen(map, "blur", release);
  listen(map, "keydown", event => {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === "ArrowLeft") hsv.s = bound(hsv.s - step);
    else if (event.key === "ArrowRight") hsv.s = bound(hsv.s + step);
    else if (event.key === "ArrowUp") hsv.v = bound(hsv.v + step);
    else if (event.key === "ArrowDown") hsv.v = bound(hsv.v - step);
    else return;
    event.preventDefault(); event.stopPropagation(); emit();
  });
  listen(hue, "input", event => {
    event.stopPropagation(); hsv.h = bound(Number(hue.value), 360); emit();
  });
  paint();
  return Object.freeze({
    setColor(hex) {
      if (destroyed || typeof hex !== "string" || hex.toLowerCase() === hsvToHex(hsv)) return;
      const next = hexToHsv(hex, hsv.h);
      if (next) { hsv = next; paint(); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; release(); listeners.forEach(remove => remove());
    },
  });
}
