# Compatibility Notes

## Verified By Implementation

- The repository provides local plugin manifests for Pixso and Figma.
- Migration data is validated with a versioned schema.
- Figma-side layout planning supports layout mode, padding, gap, and hug sizing operations.
- Node matching handles missing migration IDs and reports ambiguity.

## Must Be Verified In User Pixso Deployment

- Whether selected nodes expose all descendants.
- Whether Auto Layout fields are readable.
- Whether component and instance fields are readable.
- Whether text styles, image fills, SVG/vector details, and plugin data are readable.
- Whether `setPluginData` is permitted.

## Known First-Round Limits

- Private Pixso API differences may require adapter edits in `apps/pixso-plugin/src/main.ts`.
- Sketch import may rename or regroup nodes, lowering match confidence.
- Figma plugin does not automatically rebind uncertain component instances.
- Variables, variants, constraints, and prototypes are not fully restored in V1.
