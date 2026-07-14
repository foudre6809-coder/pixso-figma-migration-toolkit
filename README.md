# Pixso Figma Migration Toolkit

MVP for migrating a Pixso private-deployment design system into Figma Desktop by pairing a Sketch export with `migration-map.json`.

The project does not assume that private Pixso exposes the same plugin API as public Pixso. The Pixso plugin starts with a capability probe and marks every exported field as `native`, `inferred`, or `unavailable`.

## What Is Included

- Pixso local plugin MVP for capability probing and migration metadata export.
- Figma Desktop plugin MVP for importing metadata, matching Sketch-imported nodes, and restoring layout properties conservatively.
- Shared versioned migration schema.
- Node matching and layout planning packages with tests.
- PRD, architecture, compatibility notes, and test plan.
- Sample `migration-map.json` and capability report.

## Install

```bash
pnpm install
pnpm verify
```

## Pixso Plugin

Pixso private deployments may vary. Import the local plugin manifest from:

```text
apps/pixso-plugin/manifest.json
```

Run the capability probe first on representative selected nodes. Export the generated report before relying on full migration export.

The export UI supports current selection, selected artboards, or the current page. Large exports can be split by root-node count; numbered `migration-map-XX-of-YY.json` files are repaired one at a time in Figma. Current-page export is available only when the private Pixso deployment exposes `currentPage.children`.

## Figma Plugin

In Figma Desktop:

1. Open `Plugins > Development > Import plugin from manifest...`.
2. Choose `apps/figma-plugin/manifest.json`.
3. Import the Sketch file.
4. Run the plugin and choose or paste `migration-map.json`.
5. Choose **诊断** and run **仅扫描预览** first. This stage does not modify Figma.
6. Use **保守修复（默认）** for the first real run. It only writes migration IDs and restores complete single-solid appearance on a confirmed owner; it does not change geometry, node types, Auto Layout, or Components.
7. **结构修复** and **实验性几何恢复** are opt-in and should be tested only on a clean duplicate.

For acceptance testing, always start from a clean Sketch import. Compare an untouched import, the earlier visually better build, and the current conservative build in separate files. Successfully matched nodes receive a persistent migration ID for reliable repeat runs.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Current Limits

- Pixso API access must be verified locally with the capability probe.
- Component instance restoration is conservative. The plugin reports uncertain matches instead of binding incorrectly.
- HUG height is restored as Figma Auto sizing with the Pixso height retained as a minimum, rather than forcing a fixed row height.
- Cancellation takes effect between root-node batches, not midway through one large artboard.
- Variants, variables, constraints, and prototypes are scanned as future work, not fully restored in this MVP.
