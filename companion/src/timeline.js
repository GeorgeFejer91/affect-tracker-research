// Presentation-only, bounded history of observed native samples. Never an input path.
export class RatingTimeline {
  constructor({ limit = 28_800, gapMs = 2_000 } = {}) {
    if (!Number.isInteger(limit) || limit < 2 || limit > 28_800) throw new TypeError("Invalid timeline capacity.");
    this.limit = limit; this.gapMs = gapMs; this.runId = null; this.points = []; this.breakNext = true;
  }
  disconnect() { this.breakNext = true; }
  accept(sample) {
    if (!sample || typeof sample.runId !== "string" || !sample.runId.length || sample.runId.length > 96
      || !Number.isSafeInteger(sample.sequence) || sample.sequence < 1
      || !Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 0
      || ![sample.valence, sample.arousal].every(n => Number.isFinite(n) && n >= -1 && n <= 1)) return false;
    if (sample.runId !== this.runId) {
      this.runId = sample.runId; this.points = []; this.breakNext = true;
    }
    const previous = this.points.at(-1);
    if (previous && (sample.sequence <= previous.sequence || sample.elapsedMs <= previous.elapsedMs)) return false;
    this.points.push(Object.freeze({ runId: sample.runId, sequence: sample.sequence, elapsedMs: sample.elapsedMs,
      valence: sample.valence, arousal: sample.arousal,
      gap: this.breakNext || Boolean(previous && sample.elapsedMs - previous.elapsedMs > this.gapMs) }));
    this.breakNext = false;
    if (this.points.length > this.limit) this.points.splice(0, this.points.length - this.limit);
    return true;
  }
  clear() { this.runId = null; this.points = []; this.breakNext = true; }
}

const clock = ms => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function paintTimeline(canvas, history, dimension, { windowMs = 300_000 } = {}) {
  if (!["valence", "arousal"].includes(dimension)) throw new TypeError("Unknown rating dimension.");
  const width = Math.max(240, Math.round(canvas.getBoundingClientRect().width));
  const height = 180, ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const context = canvas.getContext("2d"); context.scale(ratio, ratio);
  const box = { left: 38, top: 12, width: width - 50, height: height - 44 };
  const end = Math.max(10_000, history.points.at(-1)?.elapsedMs ?? 0);
  const start = windowMs === Infinity ? history.points[0]?.elapsedMs ?? 0 : Math.max(0, end - windowMs);
  const span = Math.max(1, end - start);
  const x = time => box.left + (time - start) / span * box.width;
  const y = value => box.top + (1 - value) / 2 * box.height;
  context.font = "12px system-ui, sans-serif";
  context.textBaseline = "middle"; context.lineWidth = 1;
  for (const value of [-1, 0, 1]) {
    context.strokeStyle = value === 0 ? "#697065" : "#3b4039";
    context.beginPath(); context.moveTo(box.left, y(value)); context.lineTo(box.left + box.width, y(value)); context.stroke();
    context.fillStyle = "#aaa99f"; context.fillText(value > 0 ? "+1" : String(value), 8, y(value));
  }
  context.textBaseline = "top";
  for (let tick = 0; tick <= 4; tick += 1) {
    const time = start + span * tick / 4;
    context.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
    context.fillText(clock(time), x(time), height - 22);
  }
  context.save(); context.beginPath(); context.rect(box.left, box.top - 2, box.width, box.height + 4); context.clip();
  context.strokeStyle = dimension === "valence" ? "#75bd8f" : "#d4a94f"; context.lineWidth = 1.8;
  context.beginPath(); let connected = false;
  for (const point of history.points) {
    if (point.elapsedMs < start) { connected = false; continue; }
    if (!connected || point.gap) context.moveTo(x(point.elapsedMs), y(point[dimension]));
    else context.lineTo(x(point.elapsedMs), y(point[dimension]));
    connected = true;
  }
  context.stroke(); context.restore();
}
