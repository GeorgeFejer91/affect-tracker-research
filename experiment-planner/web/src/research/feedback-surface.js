/** Shared render-only SVG surface; no authoring, input or acquisition authority. */
export function previewOverlayMarkup({ includeFace = false } = {}) {
  const faceMarkup = includeFace ? `
      <svg data-preview-face class="preview-face" viewBox="0 0 200 200" aria-hidden="true" focusable="false" hidden>
        <ellipse data-preview-face-head class="preview-face-head" cx="100" cy="100" rx="65" ry="78"></ellipse>
        <path data-preview-face-brow="left" class="preview-face-brow" d="M55 72 Q72 62 87 72"></path>
        <path data-preview-face-brow="right" class="preview-face-brow" d="M113 72 Q128 62 145 72"></path>
        <ellipse data-preview-face-eye="left" class="preview-face-eye" cx="73" cy="91" rx="13" ry="9"></ellipse>
        <ellipse data-preview-face-eye="right" class="preview-face-eye" cx="127" cy="91" rx="13" ry="9"></ellipse>
        <circle data-preview-face-pupil="left" class="preview-face-pupil" cx="73" cy="91" r="5"></circle>
        <circle data-preview-face-pupil="right" class="preview-face-pupil" cx="127" cy="91" r="5"></circle>
        <path data-preview-face-mouth-shape class="preview-face-mouth-shape" d="M62 128 Q100 152 138 128 Q100 168 62 128 Z"></path>
        <path data-preview-face-mouth-line class="preview-face-mouth-line" d="M62 128 Q100 152 138 128"></path>
      </svg>` : "";
  return `
    <div
      class="preview-overlay"
      data-preview-overlay
      data-locked="false"
      aria-hidden="true"
    >
      <canvas class="preview-grid-canvas" data-preview-grid-canvas aria-hidden="true"></canvas>
      <svg data-preview-grid viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        ${includeFace ? '<path data-preview-tile-lines class="preview-tile-lines" fill="none" stroke="#f4f2ea" hidden></path><g data-preview-active-tile class="preview-active-tile" hidden><rect data-preview-tile-edge="contrast" class="preview-tile-contrast" fill="none" stroke="#111310" stroke-width="2"></rect><rect data-preview-tile-edge="highlight" class="preview-tile-highlight" fill="none" stroke="#ffffff" stroke-width="1"></rect></g>' : ""}
        <line data-preview-grid-line class="preview-grid-lines" x1="25" y1="0" x2="25" y2="100"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="50" y1="0" x2="50" y2="100"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="75" y1="0" x2="75" y2="100"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="0" y1="25" x2="100" y2="25"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="0" y1="50" x2="100" y2="50"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="0" y1="75" x2="100" y2="75"></line>
        <rect data-preview-grid-outline class="preview-grid-outline" x="0.5" y="0.5" width="99" height="99" fill="none"></rect>
        <circle data-preview-grid-cursor class="preview-grid-cursor" cx="50" cy="50" r="4"></circle>
      </svg>
      <svg data-preview-flubber class="preview-flubber" viewBox="-1.62 -1.62 3.24 3.24" aria-hidden="true" focusable="false">
        ${includeFace ? `<defs>
          <filter id="preview-studio-halo-fade" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">
            <feGaussianBlur data-preview-halo-blur stdDeviation="0.045"></feGaussianBlur>
            <feComponentTransfer><feFuncA data-preview-halo-falloff type="gamma" amplitude="1" exponent="1" offset="0"></feFuncA></feComponentTransfer>
          </filter>
        </defs>` : ""}
        <path data-preview-flubber-halo class="preview-flubber-halo"${includeFace ? ' filter="url(#preview-studio-halo-fade)"' : ""}></path>
        <path data-preview-flubber-base class="preview-flubber-base"></path>
        <path data-preview-flubber-outline class="preview-flubber-outline"></path>
      </svg>
      ${faceMarkup}
    </div>`;
}

