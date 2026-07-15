# Compatibility Notes

## Verified By Implementation

- The repository provides local plugin manifests for Pixso and Figma.
- Migration data is validated with a versioned schema.
- Figma-side layout planning supports layout mode, padding, gap, HUG/FILL sizing, primary/counter sizing, child align/grow, confirmed absolute positioning, and min/max sizes only in opt-in structural repair.
- Node matching handles missing migration IDs and reports ambiguity. Repeated names are first constrained to an already matched direct parent, then may use clearly unique local geometry within that parent only.
- Pixso export supports selected nodes, selected artboards, or the current page, split into root-node batches.
- Figma repair reports unsafe component/instance matches, text differences, missing image fills, vector conversion, and size anomalies.
- Sketch-imported groups can match Pixso frames, and repeated names are disambiguated with indexed hierarchy paths.
- A missing outer Sketch artboard can be treated as a flattened root; matching then uses page-absolute geometry instead of child-local geometry.
- Matched Figma nodes receive a persistent migration ID, so later repair runs do not depend on positions changed by Auto Layout.
- Solid fill, solid stroke, stroke width/alignment, corner radii, and node opacity are restored when Pixso exposes them natively and the visual owner is confirmed.
- Gradient, image, and multi-layer Paint values are left untouched when the current schema cannot represent them completely; they are never converted into an empty fill or stroke.
- HUG height can map to Figma Auto sizing with the original Pixso height retained as `minHeight` in structural repair.
- Migration IDs prefer Pixso's stable node ID and are checked for duplicates before export and import. Duplicate IDs stop export or remain ambiguous instead of being bound by order.
- Both plugin interfaces and user-facing diagnostics are displayed in Chinese.
- Capability reports recursively inspect the selected subtree and include per-field coverage plus non-sensitive layout samples.
- Capability probing checks `layoutPositioning`, `layoutAlign`, `layoutGrow`, `isAbsolute`, and `ignoreAutoLayout`. When overlapping children are found and positioning cannot be confirmed, Auto Layout is skipped and reported as partial.
- Image-filled Pixso nodes are classified as images before rectangle/vector type mapping. Image summaries include fill count, scale modes, opacity, blend mode, available hashes, and transform presence.
- Selection and artboard exports prefer each root's real index in `currentPage.children`. `indexSource` records `page`, `selection`, or `unknown`; selection-order fallback adds a warning because indexed paths are less trustworthy.
- Figma provides a read-only preview stage and a separate safe-repair stage. Preview counts separately report nodes that will change, need no change, need review, or are blocked.
- Selection/artboard migration maps require the matching Figma scope to be selected before plugin launch. Missing selection is blocked instead of silently expanding into a costly full-page scan; page maps still support full-page scans.
- Large migration maps remain in plugin memory after file loading instead of being rendered into the visible textarea, keeping the preview and repair controls responsive.
- A readable but null Pixso fill/stroke means the wrapper has no direct paint; it no longer clears an existing Figma fill, stroke, stroke metadata, or corner radius. Only explicit non-null solid appearance is written.
- The default conservative level never applies Auto Layout, Group conversion, Component rebuilding, root resizing, or child coordinate writes.
- Structural operations are experimental. Auto Layout and Group conversion require strict parent/child structure evidence; failed gates produce a needs-review result and a detailed count, order, mask, overlap, absolute-position, and size report.
- Each repair result includes `plannedChanges` and `appliedChanges`. A later failure after an earlier mutation returns partial, identifies the failed step, and tells the user that Figma Undo can revert the run.
- Pixso exports visual-owner metadata for direct appearance or a unique full-size visible Rectangle, Frame, or Component with direct fill/stroke/corners. Ambiguous candidates are not selected automatically.
- Stroke diagnostics include paint count/types, opacity, style ID/name, bound variable IDs, mixed/gradient markers, weight, align, corners, and effects availability. Incomplete strokes never overwrite Figma strokes.
- A style or variable reference does not make an otherwise complete single-solid stroke unrecoverable. Raw visual values are restored when the Figma target has no visible stroke Paint; an existing binding is preserved only when it still carries a visible stroke.
- Structural repair recognizes a narrow collapsed-container case produced by Sketch: a Pixso Auto Layout Frame may arrive as a content-bounds Group after its fill/stroke is lost. It is rebuildable only when the child match and order are complete and the size difference is explained by the exported Padding within 2px; other size-mismatched Groups remain blocked.
- Known absolute children are protected without copying Pixso coordinates. Unknown positioning or an unconfirmed absolute-child match continues to block structural layout repair.
- Main Components may be rebuilt only in experimental structural repair when a source Component has a unique high-confidence match to an ordinary Figma Frame. Instance candidates are reported but not rebound automatically.

## Must Be Verified In User Pixso Deployment

- Whether selected nodes expose all descendants.
- Whether Auto Layout fields are readable.
- Whether component and instance fields are readable.
- Whether text styles, image fills, SVG/vector details, and plugin data are readable.
- Whether `setPluginData` is permitted.
- Which of the private deployment's absolute-position candidates are present and what values they return.

## Verified With User Sample

- The `InputNumber 数字输入框` sample contained 252 Pixso metadata nodes and 252 Sketch nodes.
- Offline matching resolved all 252 nodes after frame/group compatibility and indexed hierarchy matching were added.
- The sample exposed geometry for all nodes, but did not expose recoverable Auto Layout values; this remains a Pixso API capability limit rather than a matcher failure.
- Figma results distinguish actual modifications from nodes that were only matched and verified, so zero-change runs are not reported as successful repairs.
- Earlier experimental builds converted Sketch-imported groups before applying Auto Layout. That behavior is now disabled by default after real-file validation showed visual regressions; it remains behind strict structural gates for controlled testing only.
- The `Input 输入框` export contains 960 metadata nodes. Pixso exposed 621 solid fills, 161 solid strokes, and 535 corner-radius values; these fields are available for Figma-side appearance restoration.
- The refreshed capability report confirms fills and strokes are readable for all 960 nodes. Input component wrappers commonly expose null direct paints while their nested `画板 112` Frame carries the white fill, border, and 4px radius.
- On the clean Figma copy, parent-scoped and local-geometry matching increased the structural preview from 45 to 219 planned modifications while keeping unmatched nodes at 1. The actual collapsed-input conversion still requires a clean-import visual run before acceptance.

## Awaiting Clean-Import Visual Verification

- The risk comparison from `c9bd132` to `fa2600f` was rechecked: `restoreConvertedFrameBounds` was removed, conservative policy disables geometry/layout/type/Component writes, and the current changes do not reintroduce default root resize or child `x/y` writes.
- Real Figma validation showed that the previous automatic geometry restoration increased misalignment. Geometry writes are now disabled by default and remain experimental.
- Final acceptance requires three clean imports: A raw Sketch, B the earlier plugin baseline, and C this conservative build. Compare displaced-node count, mean position error, root size, correct input strokes, correct padding/gap, extra borders, and text wrapping.
- The acceptance floor is that conservative repair must not look worse than raw Sketch import. No 80%-90% restoration claim is made before this comparison passes.

## Known Limits

- Private Pixso API differences may require adapter edits in `apps/pixso-plugin/src/main.ts`.
- Sketch import may rename or regroup nodes, lowering match confidence.
- Overlapping repeated nodes with identical names, types, hierarchy, and geometry remain intentionally ambiguous unless a migration ID has already been written.
- Geometry-based HUG inference remains conservative for files whose private Pixso API does not expose sizing modes. Unconfirmed overlapping or absolute-position cases are skipped rather than automatically repaired.
- Figma plugin does not automatically rebind uncertain component instances.
- Page export requires the private deployment to expose `currentPage.children`; otherwise the plugin reports the capability gap.
- Cancellation is checked between root-node batches. A single very large artboard still completes its current batch before stopping.
- Full-page matching can still be expensive on pages with many unrelated imported nodes; selection/artboard maps should be run against the selected matching scope.
- Variables, variants, constraints, and prototypes are not fully restored in V1.

## Roadmap Only

- Icon-specific Group-to-Frame conversion.
- Scanning for unreferenced master components.
- Automatic instance replacement or rebinding.
