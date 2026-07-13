# Pixso Figma Migration Toolkit

First-round MVP for migrating a Pixso private-deployment design system into Figma Desktop by pairing a Sketch export with `migration-map.json`.

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

## Figma Plugin

In Figma Desktop:

1. Open `Plugins > Development > Import plugin from manifest...`.
2. Choose `apps/figma-plugin/manifest.json`.
3. Import the Sketch file.
4. Run the plugin and paste or load `migration-map.json`.
5. Review restored, partial, and failed items before touching the full file.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## First-Round Limits

- Pixso API access must be verified locally with the capability probe.
- Component instance restoration is conservative. The plugin reports uncertain matches instead of binding incorrectly.
- Variants, variables, constraints, and prototypes are scanned as future work, not fully restored in this MVP.
