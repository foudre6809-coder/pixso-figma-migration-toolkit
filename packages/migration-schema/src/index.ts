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
  name: z.string(),
  type: NodeTypeSchema,
  path: z.array(z.string()),
  parentMigrationId: z.string().optional(),
  childMigrationIds: z.array(z.string()).default([]),
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
    heightMode: sourced(z.enum(["FIXED", "HUG", "FILL"]))
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
    imageFillSummary: sourced(z.string())
  }),
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
  nodes: z.array(MigrationNodeSchema),
  warnings: z.array(z.string()).default([])
});
export type MigrationMap = z.infer<typeof MigrationMapSchema>;

export const CapabilityReportSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  createdAt: z.string(),
  sourceTool: z.literal("pixso"),
  checkedNodeCount: z.number(),
  availableFields: z.array(z.string()),
  unavailableFields: z.array(z.string()),
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
