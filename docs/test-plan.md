# Test Plan

## Automated

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

GitHub Actions repeats these checks after a frozen-lockfile install. Unit coverage includes default-off geometry, diagnostic no-write policy, strict structure gates, full-size Frame visual-owner detection, style/variable stroke metadata, incomplete-stroke protection, layout align/grow/FILL/absolute/min-max planning, absolute-child position protection, sparse-selection indices, preview status, and partial execution status.

## Manual Pixso Checks

1. Select a component spec artboard and run capability probe.
2. Confirm `layoutMode`, primary/counter sizing, padding, gap, align/grow/positioning, min/max size, geometry, text, and component fields are marked correctly.
3. Export migration map for one small artboard.
4. Export two or more selected artboards with batch size 1 and confirm separate numbered JSON files.
5. With five page children, select only the second and fifth roots; confirm `originalIndex` is `1` and `4` and `indexSource` is `page`. Hide `currentPage.children` in a mock/probe and confirm selection-order fallback emits a warning.
6. Attempt current-page export and record whether `currentPage.children` is available.
7. Repeat for icon/SVG page and complex Auto Layout component page.

## Manual Figma Checks

1. Import the matching Sketch file into Figma Desktop.
2. Use a clean import that has not been repaired by an older plugin version, then select only the imported scope.
3. Run **诊断** and confirm no Figma node changes.
4. Confirm preview separately reports **将修改 / 无需修改 / 需人工确认 / 无法处理**, then run the default **保守修复**.
5. Click failed items and inspect whether the failure is due to API unavailability, Sketch rename/regroup, or unsupported structure.
6. Confirm mismatched components are reported without conversion or instance rebinding.
7. Run the same JSON a second time and confirm migration IDs prevent positional rematching failures.
8. Clear selection outlines and compare Pixso/Figma screenshots for component bounds, text baselines, fills, strokes, corner radii, and spacing.
9. Include a gradient/image-fill sample and confirm unsupported Paint data is preserved rather than cleared.
10. Include overlapping children with unavailable positioning fields and confirm the item is partial and unchanged.
11. Confirm only a uniquely matched ordinary Frame from a source Component is rebuilt as a main Component.
12. Use a sample whose layout is high risk but appearance is safe; confirm layout is skipped, appearance is restored, and the result is partial.
13. Use a high-risk layout sample with a uniquely matched source Component; confirm main Component rebuilding still runs and the result is partial.
14. Force a later operation failure after one safe mutation; confirm `appliedChanges` is populated, status is partial, the failed step is named, and the message mentions Figma Undo.
15. Confirm conservative repair leaves root dimensions and every child `x/y` unchanged.
16. Load a migration map larger than 3 MB and confirm the UI reports its file name and size without rendering the full JSON into the textarea.
17. Launch a selection/artboard map without a Figma selection and confirm the plugin blocks the run; confirm a page map still permits a full-page scan.
18. Use an Instance whose outer fill/stroke is null and whose nested Frame owns the input border; confirm repair does not clear the imported wrapper or nested input appearance.
19. Confirm **结构修复** and **实验性几何恢复** are both off by default. Turn on structural repair and verify any count mismatch, match rate below 90%, Mask, unknown absolute positioning, overlap, or size mismatch blocks Auto Layout.
20. Use an input whose unique full-size background is a Frame with white fill, solid border, 4px corners, and opacity; confirm conservative repair targets that Frame and does not write appearance to the outer wrapper.
21. Use a single-solid Pixso stroke with style/variable metadata. Confirm its visible values remain recoverable, cross-tool IDs are diagnostic-only, and an existing Figma binding is not overwritten.
22. In structural mode, verify a confirmed absolute child keeps its current Figma `x/y` while receiving `layoutPositioning=ABSOLUTE`; repeat with an unconfirmed child and confirm the parent layout is skipped.
23. Use repeated input names under repeated parents. Confirm matching stays inside the already matched direct parent and uses local geometry only when the nearest candidate is clearly unique.
24. Use a Pixso 344x36 input Frame imported as a 320x20 content-bounds Group with 12px horizontal and 7px vertical Padding. In structural mode, confirm the plugin rebuilds its background/Frame and border without moving the visible child content; a Group whose size difference is not explained by Padding must remain unchanged.

## Visual Regression Baseline

Use three separate clean Sketch imports: A without the plugin, B with the last visually better build, and C with this build's conservative repair. Record displaced-node count, mean position deviation, root size, correct input-border count, correct padding/gap count, extra-border count, and text-wrap anomalies. Do not reuse a file modified by another build.

## MVP Sample Set

- Component spec page.
- Icon/SVG spec page.
- Complex Auto Layout component page.
