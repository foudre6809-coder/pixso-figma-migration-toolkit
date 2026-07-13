# Architecture

## Flow

```text
Pixso private deployment
  -> Pixso local plugin capability probe
  -> Pixso local plugin migration-map.json export
  -> Sketch export for visual content
  -> Figma Desktop Sketch import
  -> Figma local plugin repair
  -> restored / partial / failed report
```

## Packages

- `apps/pixso-plugin`: Pixso-side capability probe and metadata export.
- `apps/figma-plugin`: Figma-side repair and reporting.
- `packages/migration-schema`: Versioned schema and validation helpers.
- `packages/node-matcher`: Conservative multi-feature matching.
- `packages/layout-engine`: Converts migration node metadata into Figma layout operations.

## Matching Strategy

The matcher scores migration ID, name, type, hierarchy path, and geometry. Ambiguous close matches are reported instead of automatically repaired.

## Safety Strategy

- Pixso plugin is read-first and selected-scope by default.
- Every field carries a source marker: `native`, `inferred`, or `unavailable`.
- Figma plugin applies layout only to nodes that can receive Auto Layout.
- Component/instance restoration is conservative and reports uncertain cases.
