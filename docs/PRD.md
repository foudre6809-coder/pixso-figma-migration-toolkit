# PRD: Pixso Design System Migration Toolkit

## Goal

Help migrate a Pixso private-deployment design system into Figma Desktop through Sketch plus `migration-map.json`, restoring the repetitive structural work that Sketch import usually loses.

## Confirmed Constraints

- Source is Pixso enterprise private deployment.
- User can install Pixso local plugins.
- Pixso private API capabilities are unknown and must be probed locally.
- Target is Figma Desktop with local development plugin install.
- Current source has 49 large artboards and many nested design-system artboards/icons.
- Main visual carrier remains Sketch. PNG/PDF/SVG exports are fallback references.
- First-round priority: Auto Layout, Component, SVG, images, text, padding, gap.
- Variants, variables, constraints, and prototypes are tracked as risks or later work.

## MVP Scope

1. Pixso plugin exports capability report for selected nodes.
2. Pixso plugin exports selection, selected-artboard, or current-page metadata in configurable root-node batches.
3. Figma plugin imports `migration-map.json`, matches imported Sketch nodes, and restores safe layout properties.
4. Figma plugin reports restored, partial, and failed nodes.
5. Documentation explains what is implemented versus what must be verified in the user's Pixso deployment.

## Non-Goals

- No promise of 100% lossless migration.
- No destructive Pixso preprocessing in V1.
- No unsafe component instance rebinding.
- No full variants, variables, prototype, or constraint restoration.

## Success Criteria

- A user can run the Pixso capability probe on selected design-system nodes.
- A user can export a valid `migration-map.json`.
- A user can split a multi-artboard export into numbered batches and cancel between batches.
- A user can import Sketch into Figma Desktop and run repair on selected scope.
- Core matching and layout planning logic is covered by unit tests.
- Unknown Pixso API fields are marked as unavailable, not guessed.
