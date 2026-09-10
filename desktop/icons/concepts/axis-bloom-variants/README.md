# Axis Bloom variants

These five SVGs are a focused second round based on the selected
[Axis Bloom parent concept](../03-axis-bloom.svg). Every variant keeps the
canonical affect orientation—gold up, mint right, blue down, and coral left—
while changing the geometry and visual emphasis.

![Five Axis Bloom variants, numbered one through five](./contact-sheet.png)

| Variant | Preview | Design intent |
| --- | --- | --- |
| **01 · Axis Bloom Bold** | ![Axis Bloom Bold app logo](./axis-01-bloom-bold.svg) | The parent concept distilled: heavier negative-space axes, a larger center, and one decisive contour. This is the most faithful refinement. |
| **02 · Petal Compass** | ![Petal Compass app logo](./axis-02-petal-compass.svg) | Four overlapping Flubbers turn the directional field into a compact organic bloom. |
| **03 · Orbit Bloom** | ![Orbit Bloom app logo](./axis-03-orbit-bloom.svg) | The four affect directions form an outer Flubber ring around a calm tracked state. |
| **04 · Prism Bloom** | ![Prism Bloom app logo](./axis-04-prism-bloom.svg) | A Flubber-edged diamond gives the same valence-arousal model a crisper instrument-like silhouette. |
| **05 · Aurora Axis — selected** | ![Aurora Axis app logo](./axis-05-aurora-axis.svg) | Four blended directional glows express affect as a continuous field while retaining the axes. This is the project’s canonical app logo. |

## Rebuild and verify

```powershell
pnpm desktop:logos:axis:build
pnpm desktop:logos:axis:check
```

Aurora Axis is copied into `desktop/icons/app-icon.svg` and
`site/assets/app-logo.svg`. Its generated PNG, ICO, and ICNS assets provide the
native application, tray, browser favicon, and link-preview variants.
