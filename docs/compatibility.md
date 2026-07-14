# Compatibility Notes

## Verified By Implementation

- The repository provides local plugin manifests for Pixso and Figma.
- Migration data is validated with a versioned schema.
- Figma-side layout planning supports layout mode, padding, gap, and hug sizing operations.
- Node matching handles missing migration IDs and reports ambiguity.
- Pixso export supports selected nodes, selected artboards, or the current page, split into root-node batches.
- Figma repair reports unsafe component/instance matches, text differences, missing image fills, vector conversion, and size anomalies.
- Sketch-imported groups can match Pixso frames, and repeated names are disambiguated with indexed hierarchy paths.
- Both plugin interfaces and user-facing diagnostics are displayed in Chinese.

## Must Be Verified In User Pixso Deployment

- Whether selected nodes expose all descendants.
- Whether Auto Layout fields are readable.
- Whether component and instance fields are readable.
- Whether text styles, image fills, SVG/vector details, and plugin data are readable.
- Whether `setPluginData` is permitted.

## Verified With User Sample

- The `InputNumber 数字输入框` sample contained 252 Pixso metadata nodes and 252 Sketch nodes.
- Offline matching resolved all 252 nodes after frame/group compatibility and indexed hierarchy matching were added.
- The sample exposed geometry for all nodes, but did not expose recoverable Auto Layout values; this remains a Pixso API capability limit rather than a matcher failure.

## Known Limits

- Private Pixso API differences may require adapter edits in `apps/pixso-plugin/src/main.ts`.
- Sketch import may rename or regroup nodes, lowering match confidence.
- Figma plugin does not automatically rebind uncertain component instances.
- Page export requires the private deployment to expose `currentPage.children`; otherwise the plugin reports the capability gap.
- Cancellation is checked between root-node batches. A single very large artboard still completes its current batch before stopping.
- Variables, variants, constraints, and prototypes are not fully restored in V1.
