# Test Plan

## Automated

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Manual Pixso Checks

1. Select a component spec artboard and run capability probe.
2. Confirm `layoutMode`, padding, gap, geometry, text, and component fields are marked correctly.
3. Export migration map for one small artboard.
4. Export two or more selected artboards with batch size 1 and confirm separate numbered JSON files.
5. Attempt current-page export and record whether `currentPage.children` is available.
6. Repeat for icon/SVG page and complex Auto Layout component page.

## Manual Figma Checks

1. Import the matching Sketch file into Figma Desktop.
2. Select the imported scope.
3. Run the repair plugin with the exported JSON.
4. Review restored, partial, and failed counts.
5. Click failed items and inspect whether the failure is due to API unavailability, Sketch rename/regroup, or unsupported structure.
6. Confirm mismatched components are reported without conversion or instance rebinding.

## MVP Sample Set

- Component spec page.
- Icon/SVG spec page.
- Complex Auto Layout component page.
