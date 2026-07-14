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
- The Figma plugin exposes three levels: diagnostic, conservative repair (default), and structural repair (experimental).
- Conservative repair writes migration IDs and restores only complete single-solid appearance on a confirmed visual owner. It never changes geometry, node type, Auto Layout, or Component structure.
- Structural repair is opt-in. Auto Layout and Group conversion require a unique high-confidence parent match, equal child counts, at least 90% child matching, consistent order, no mask/unknown absolute/overlap, and source/target sizes within 2px or 2%.
- Geometry restoration is a second, separately disabled experimental switch. Geometry differences remain visible in diagnostics when writes are disabled.
- Preview distinguishes planned changes from no-change matches. Apply results retain `appliedChanges`, so partial mutations and failed later steps remain auditable and undoable.
- Appearance restoration follows `appearanceOwnerMigrationId`. A full-size bottom Rectangle can own a container's appearance; ambiguous candidates are reported without promotion.
- Component/instance restoration is conservative and reports uncertain cases.

## Reserved Roadmap Boundaries

The V1 architecture leaves extension points for icon Group conversion, unreferenced master scanning, and instance replacement. These remain roadmap items and are not part of the current migration execution path.
