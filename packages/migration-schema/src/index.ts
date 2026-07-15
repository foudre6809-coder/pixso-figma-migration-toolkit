import { z } from "zod";

export const schemaVersion = "0.1.0";

export const FieldSourceSchema = z.enum(["native", "inferred", "unavailable"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

const sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    source: FieldSourceSchema,
    note: z.string().optional()
  });

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});
export type Rect = z.infer<typeof RectSchema>;

export const SolidPaintSchema = z.object({
  color: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  opacity: z.number().min(0).max(1)
});

export const ImageFillSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  scaleModes: z.array(z.string()),
  opacities: z.array(z.number().min(0).max(1)),
  blendModes: z.array(z.string()),
  hashes: z.array(z.string()),
  hasTransform: z.boolean()
});
export type ImageFillSummary = z.infer<typeof ImageFillSummarySchema>;

export const StrokePaintSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  paintTypes: z.array(z.string()),
  opacities: z.array(z.number().min(0).max(1)),
  styleId: z.string().nullable(),
  styleName: z.string().nullable(),
  isMixed: z.boolean(),
  hasGradient: z.boolean(),
  hasVariableReference: z.boolean(),
  boundVariables: z.record(z.string(), z.array(z.string())).default({}),
  paintStyleIds: z.array(z.string()).default([]),
  completeSingleSolid: z.boolean()
});
export type StrokePaintSummary = z.infer<typeof StrokePaintSummarySchema>;

export const EffectsSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  types: z.array(z.string()),
  complete: z.boolean()
});
export type EffectsSummary = z.infer<typeof EffectsSummarySchema>;

const emptyAppearance = {
  fill: { value: null, source: "unavailable" as const },
  stroke: { value: null, source: "unavailable" as const },
  strokeWeight: { value: null, source: "unavailable" as const },
  strokeAlign: { value: null, source: "unavailable" as const },
  cornerRadii: { value: null, source: "unavailable" as const },
  opacity: { value: null, source: "unavailable" as const },
  strokeSummary: { value: null, source: "unavailable" as const },
  effectsSummary: { value: null, source: "unavailable" as const }
};

export const AppearanceSchema = z.object({
  fill: sourced(SolidPaintSchema),
  stroke: sourced(SolidPaintSchema),
  strokeWeight: sourced(z.number().nonnegative()),
  strokeAlign: sourced(z.enum(["INSIDE", "CENTER", "OUTSIDE"])),
  cornerRadii: sourced(z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()])),
  opacity: sourced(z.number().min(0).max(1)).optional(),
  strokeSummary: sourced(StrokePaintSummarySchema).optional(),
  effectsSummary: sourced(EffectsSummarySchema).optional()
});

export const NodeTypeSchema = z.enum([
  "PAGE",
  "FRAME",
  "GROUP",
  "COMPONENT",
  "INSTANCE",
  "TEXT",
  "VECTOR",
  "BOOLEAN",
  "IMAGE",
  "UNKNOWN"
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const MigrationNodeSchema = z.object({
  migrationId: z.string().min(1),
  originalId: z.string().optional(),
  originalIndex: z.number().int().nonnegative().optional(),
  indexSource: z.enum(["page", "selection", "unknown"]).optional(),
  name: z.string(),
  type: NodeTypeSchema,
  path: z.array(z.string()),
  parentMigrationId: z.string().optional(),
  childMigrationIds: z.array(z.string()).default([]),
  appearanceOwnerMigrationId: z.string().optional(),
  appearanceOwnerReason: z.enum(["self", "full-size-background", "ambiguous", "unavailable"]).optional(),
  fullSizeBackgroundChildMigrationId: z.string().optional(),
  rect: sourced(RectSchema),
  visible: sourced(z.boolean()),
  layout: z.object({
    mode: sourced(z.enum(["NONE", "HORIZONTAL", "VERTICAL"])),
    paddingTop: sourced(z.number()),
    paddingRight: sourced(z.number()),
    paddingBottom: sourced(z.number()),
    paddingLeft: sourced(z.number()),
    gap: sourced(z.number()),
    widthMode: sourced(z.enum(["FIXED", "HUG", "FILL"])),
    heightMode: sourced(z.enum(["FIXED", "HUG", "FILL"])),
    positioning: sourced(z.enum(["AUTO", "ABSOLUTE"])).default({ value: null, source: "unavailable" }),
    layoutAlign: sourced(z.string()).default({ value: null, source: "unavailable" }),
    layoutGrow: sourced(z.number()).default({ value: null, source: "unavailable" }),
    primaryAxisSizingMode: sourced(z.enum(["FIXED", "AUTO"])).optional(),
    counterAxisSizingMode: sourced(z.enum(["FIXED", "AUTO"])).optional(),
    minWidth: sourced(z.number().nonnegative()).optional(),
    maxWidth: sourced(z.number().nonnegative()).optional(),
    minHeight: sourced(z.number().nonnegative()).optional(),
    maxHeight: sourced(z.number().nonnegative()).optional()
  }),
  component: z.object({
    componentKey: sourced(z.string()),
    mainComponentId: sourced(z.string()),
    instanceOf: sourced(z.string())
  }),
  text: z.object({
    characters: sourced(z.string()),
    styleSummary: sourced(z.string())
  }),
  asset: z.object({
    svgSummary: sourced(z.string()),
    imageFillSummary: sourced(z.union([z.string(), ImageFillSummarySchema]))
  }),
  appearance: AppearanceSchema.default(emptyAppearance),
  riskFlags: z.array(z.string()).default([])
});
export type MigrationNode = z.infer<typeof MigrationNodeSchema>;

export const MigrationMapSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  createdAt: z.string(),
  sourceTool: z.literal("pixso"),
  sourceEnvironment: z.object({
    deployment: z.literal("private"),
    pluginApiVersion: z.string().optional(),
    fileName: z.string().optional()
  }),
  exportScope: z.enum(["selection", "page", "artboard"]),
  batch: z
    .object({
      index: z.number().int().positive(),
      total: z.number().int().positive(),
      rootCount: z.number().int().nonnegative()
    })
    .optional(),
  nodes: z.array(MigrationNodeSchema),
  warnings: z.array(z.string()).default([])
}).superRefine((map, context) => {
  const seen = new Set<string>();
  for (const node of map.nodes) {
    if (seen.has(node.migrationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `迁移标识重复：${node.migrationId}`
      });
      return;
    }
    seen.add(node.migrationId);
  }
});
export type MigrationMap = z.infer<typeof MigrationMapSchema>;

export const CapabilityReportSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  createdAt: z.string(),
  sourceTool: z.literal("pixso"),
  checkedNodeCount: z.number(),
  checkedRootCount: z.number().int().nonnegative().optional(),
  sourceEnvironment: z
    .object({
      pluginApiVersion: z.string().optional(),
      fileName: z.string().optional()
    })
    .optional(),
  availableFields: z.array(z.string()),
  unavailableFields: z.array(z.string()),
  nodeTypeCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  fieldCoverage: z
    .array(
      z.object({
        field: z.string(),
        availableCount: z.number().int().nonnegative(),
        unavailableCount: z.number().int().nonnegative(),
        sampleValues: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([])
      })
    )
    .default([]),
  notes: z.array(z.string()).default([])
});
export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;

export function unavailable<T>(note?: string): { value: T | null; source: FieldSource; note?: string } {
  return { value: null, source: "unavailable", note };
}

export function native<T>(value: T): { value: T; source: FieldSource } {
  return { value, source: "native" };
}

export function inferred<T>(value: T, note?: string): { value: T; source: FieldSource; note?: string } {
  return { value, source: "inferred", note };
}

export function validateMigrationMap(input: unknown): MigrationMap {
  return MigrationMapSchema.parse(input);
}

export function validateCapabilityReport(input: unknown): CapabilityReport {
  return CapabilityReportSchema.parse(input);
}
