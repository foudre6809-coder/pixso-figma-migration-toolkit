import {
  type CapabilityReport,
  type MigrationMap,
  type MigrationNode,
  inferred,
  native,
  schemaVersion,
  unavailable
} from "@pixso-figma-migration/migration-schema";
import {
  type RawNode,
  type RootRef,
  classifyPixsoNodeType,
  createRootRefs,
  findAppearanceOwnerCandidate,
  readLayoutPositioning,
  rootIndexWarnings,
  rootPath,
  summarizeEffects,
  summarizeImageFills,
  summarizeStrokes
} from "./node-data";

declare const pixso: any;
declare const __html__: string;

type ExportScope = MigrationMap["exportScope"];

let exportCancelled = false;

const fieldsToProbe = [
  "id",
  "name",
  "type",
  "children",
  "x",
  "y",
  "width",
  "height",
  "layoutMode",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "itemSpacing",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "layoutPositioning",
  "layoutAlign",
  "layoutGrow",
  "isAbsolute",
  "ignoreAutoLayout",
  "componentKey",
  "mainComponent",
  "characters",
  "fills",
  "strokes",
  "strokeWeight",
  "strokeAlign",
  "strokeStyleId",
  "strokeStyleName",
  "strokeStyle",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomRightRadius",
  "bottomLeftRadius",
  "visible",
  "isMask",
  "opacity",
  "effects"
];

const fieldsToSample = new Set([
  "type",
  "layoutMode",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "itemSpacing",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "layoutPositioning",
  "layoutAlign",
  "layoutGrow",
  "isAbsolute",
  "ignoreAutoLayout"
]);

function readSelection(): RawNode[] {
  return pixso?.currentPage?.selection ?? [];
}

function rootsForScope(scope: ExportScope): RootRef[] {
  const selection = readSelection();
  const pageChildren = pixso?.currentPage?.children;
  if (scope === "page") {
    if (!Array.isArray(pageChildren)) throw new Error("当前 Pixso 私有化版本未开放当前页面的子节点接口。");
    return createRootRefs(pageChildren, pageChildren, "page");
  }
  const selectionRefs = createRootRefs(selection, Array.isArray(pageChildren) ? pageChildren : undefined, "selection");
  if (scope === "artboard") {
    const artboards = selectionRefs.filter(({ node }) => Array.isArray(node.children));
    if (!artboards.length) throw new Error("请先选择一个或多个画板，再按画板范围导出。");
    return artboards;
  }
  if (!selection.length) throw new Error("请先选择一个或多个节点。");
  return selectionRefs;
}

function createMigrationId(node: RawNode, path: string[]): string {
  if (typeof node.getPluginData === "function") {
    const existing = node.getPluginData("migrationId");
    if (existing) return existing;
  }
  const base =
    typeof node.id === "string"
      ? `node:${node.id}`
      : `${path.join("/")}|${node.name ?? "unnamed"}|${node.type ?? "UNKNOWN"}|${node.width ?? 0}x${node.height ?? 0}`;
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return `pxm_${hash.toString(16)}`;
}

function writeMigrationIdIfAllowed(node: RawNode, migrationId: string): boolean {
  if (typeof node.setPluginData !== "function") return false;
  try {
    node.setPluginData("migrationId", migrationId);
    return typeof node.getPluginData !== "function" || node.getPluginData("migrationId") === migrationId;
  } catch {
    return false;
  }
}

function mapSizing(value: unknown) {
  if (value === "HUG" || value === "AUTO") return native("HUG" as const);
  if (value === "FILL" || value === "STRETCH") return native("FILL" as const);
  if (value === "FIXED") return native("FIXED" as const);
  if (typeof value === "string") return inferred("FIXED" as const, `无法识别尺寸模式 ${value}，按固定尺寸处理。`);
  return unavailable<"FIXED" | "HUG" | "FILL">("未开放尺寸模式字段。");
}

function readSizing(node: RawNode, dimension: "width" | "height") {
  const legacyValue = dimension === "width" ? node.layoutSizingHorizontal : node.layoutSizingVertical;
  if (legacyValue !== undefined) return mapSizing(legacyValue);

  const mode = node.layoutMode;
  const usesPrimaryAxis =
    (mode === "HORIZONTAL" && dimension === "width") || (mode === "VERTICAL" && dimension === "height");
  return mapSizing(usesPrimaryAxis ? node.primaryAxisSizingMode : node.counterAxisSizingMode);
}

function normalizeSolidPaint(paints: unknown, fieldName: string): MigrationNode["appearance"]["fill"] {
  if (!Array.isArray(paints)) return unavailable(`未开放${fieldName}字段。`);
  const visiblePaints = paints.filter((item) => item?.visible !== false);
  if (!visiblePaints.length) return { value: null, source: "native", note: `没有启用的${fieldName}。` };
  if (visiblePaints.length !== 1 || visiblePaints[0]?.type !== "SOLID") {
    return unavailable(`${fieldName}包含渐变、图片或多层 Paint，为避免覆盖原外观，本次不写入。`);
  }
  const paint = visiblePaints[0];
  const color = paint.color;
  if (![color?.r, color?.g, color?.b].every((value) => typeof value === "number")) {
    return unavailable(`${fieldName}颜色格式无法识别。`);
  }
  return native({
    color: { r: color.r, g: color.g, b: color.b },
    opacity: typeof paint.opacity === "number" ? paint.opacity : 1
  });
}

function normalizeStrokeAlign(value: unknown): MigrationNode["appearance"]["strokeAlign"] {
  if (value === "INSIDE" || value === "CENTER" || value === "OUTSIDE") return native(value);
  return unavailable("未开放描边位置字段。");
}

function normalizeCornerRadii(node: RawNode): MigrationNode["appearance"]["cornerRadii"] {
  if (typeof node.cornerRadius === "number") {
    return native([node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius]);
  }
  const radii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
  if (radii.every((value) => typeof value === "number")) {
    return native(radii as [number, number, number, number]);
  }
  return unavailable("未开放圆角字段。");
}

function toMigrationNode(
  node: RawNode,
  path: string[],
  parentMigrationId?: string,
  originalIndex?: number,
  indexSource?: RootRef["indexSource"]
): MigrationNode {
  const migrationId = createMigrationId(node, path);
  const migrationIdPersisted = writeMigrationIdIfAllowed(node, migrationId);
  const children = Array.isArray(node.children) ? node.children : [];
  const childIds = children.map((child: RawNode, index: number) =>
    createMigrationId(child, [...path, `${child.name ?? "unnamed"}[${index}]`])
  );
  const appearanceOwner = findAppearanceOwnerCandidate(node);
  const ownerChildId =
    appearanceOwner.childIndex === undefined ? undefined : childIds[appearanceOwner.childIndex];
  const strokeSummary = summarizeStrokes(node);

  return {
    migrationId,
    originalId: typeof node.id === "string" ? node.id : undefined,
    originalIndex,
    indexSource,
    name: String(node.name ?? "Unnamed"),
    type: classifyPixsoNodeType(node),
    path,
    parentMigrationId,
    childMigrationIds: childIds,
    appearanceOwnerMigrationId:
      appearanceOwner.reason === "self" ? migrationId : appearanceOwner.reason === "full-size-background" ? ownerChildId : undefined,
    appearanceOwnerReason: appearanceOwner.reason,
    fullSizeBackgroundChildMigrationId:
      appearanceOwner.reason === "full-size-background" ? ownerChildId : undefined,
    rect:
      typeof node.x === "number" && typeof node.y === "number" && typeof node.width === "number" && typeof node.height === "number"
        ? native({ x: node.x, y: node.y, width: node.width, height: node.height })
        : unavailable("未开放位置或尺寸字段。"),
    visible: typeof node.visible === "boolean" ? native(node.visible) : unavailable("未开放可见性字段。"),
    layout: {
      mode:
        node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL"
          ? native(node.layoutMode)
          : node.layoutMode === "NONE"
            ? native("NONE")
            : unavailable("未开放自动布局方向字段。"),
      paddingTop: typeof node.paddingTop === "number" ? native(node.paddingTop) : unavailable("未开放上内边距字段。"),
      paddingRight: typeof node.paddingRight === "number" ? native(node.paddingRight) : unavailable("未开放右内边距字段。"),
      paddingBottom: typeof node.paddingBottom === "number" ? native(node.paddingBottom) : unavailable("未开放下内边距字段。"),
      paddingLeft: typeof node.paddingLeft === "number" ? native(node.paddingLeft) : unavailable("未开放左内边距字段。"),
      gap: typeof node.itemSpacing === "number" ? native(node.itemSpacing) : unavailable("未开放元素间距字段。"),
      widthMode: readSizing(node, "width"),
      heightMode: readSizing(node, "height"),
      positioning: readLayoutPositioning(node),
      layoutAlign: typeof node.layoutAlign === "string" ? native(node.layoutAlign) : unavailable("未开放布局对齐字段。"),
      layoutGrow: typeof node.layoutGrow === "number" ? native(node.layoutGrow) : unavailable("未开放布局伸展字段。")
    },
    component: {
      componentKey: typeof node.componentKey === "string" ? native(node.componentKey) : unavailable("未开放组件标识字段。"),
      mainComponentId:
        typeof node.mainComponent?.id === "string" ? native(node.mainComponent.id) : unavailable("未开放主组件字段。"),
      instanceOf: typeof node.mainComponent?.name === "string" ? native(node.mainComponent.name) : unavailable("未开放实例来源字段。")
    },
    text: {
      characters: typeof node.characters === "string" ? native(node.characters) : unavailable("未开放文本内容字段。"),
      styleSummary: unavailable("文本样式摘要需要适配当前私有化版本。")
    },
    asset: {
      svgSummary:
        classifyPixsoNodeType(node) === "VECTOR"
          ? inferred("存在矢量节点", "能力检测未发现精确导出 SVG 的接口。")
          : unavailable(),
      imageFillSummary: summarizeImageFills(node.fills)
    },
    appearance: {
      fill: normalizeSolidPaint(node.fills, "填充"),
      stroke: normalizeSolidPaint(node.strokes, "描边"),
      strokeWeight: typeof node.strokeWeight === "number" ? native(node.strokeWeight) : unavailable("未开放描边粗细字段。"),
      strokeAlign: normalizeStrokeAlign(node.strokeAlign),
      cornerRadii: normalizeCornerRadii(node),
      opacity: typeof node.opacity === "number" ? native(node.opacity) : unavailable("未开放透明度字段。"),
      strokeSummary,
      effectsSummary: summarizeEffects(node.effects)
    },
    riskFlags: [
      ...(node.isMask ? ["mask"] : []),
      ...(classifyPixsoNodeType(node) === "GROUP" ? ["group-may-import-as-frame-or-group"] : []),
      ...(readLayoutPositioning(node).source === "unavailable" ? ["absolute-layout-unconfirmed"] : []),
      ...(appearanceOwner.reason === "ambiguous" ? ["appearance-owner-ambiguous"] : []),
      ...(strokeSummary.source === "unavailable" ? ["stroke-data-unavailable"] : []),
      ...(strokeSummary.value && strokeSummary.value.count > 0 && !strokeSummary.value.completeSingleSolid
        ? ["stroke-paint-incomplete"]
        : []),
      ...(!migrationIdPersisted ? ["migration-id-not-persisted"] : [])
    ]
  };
}

function flatten(nodes: RawNode[], parentPath: string[] = [], parentMigrationId?: string): MigrationNode[] {
  return nodes.flatMap((node, index) => {
    const path = [...parentPath, `${String(node.name ?? "Unnamed")}[${index}]`];
    const mapped = toMigrationNode(node, path, parentMigrationId);
    const children = Array.isArray(node.children) ? flatten(node.children, path, mapped.migrationId) : [];
    return [mapped, ...children];
  });
}

function flattenRoots(roots: RootRef[]): MigrationNode[] {
  return roots.flatMap((root) => {
    const path = rootPath(root);
    const mapped = toMigrationNode(root.node, path, undefined, root.originalIndex, root.indexSource);
    const children = Array.isArray(root.node.children) ? flatten(root.node.children, path, mapped.migrationId) : [];
    return [mapped, ...children];
  });
}

function flattenRawNodes(nodes: RawNode[]): RawNode[] {
  return nodes.flatMap((node) => [node, ...(Array.isArray(node.children) ? flattenRawNodes(node.children) : [])]);
}

function inspectField(node: RawNode, field: string): { available: boolean; value?: unknown } {
  try {
    const value = node[field];
    return { available: field in node && value !== undefined, value };
  } catch {
    return { available: false };
  }
}

function safeSample(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function createCapabilityReport(roots: RawNode[]): CapabilityReport {
  const nodes = flattenRawNodes(roots);
  const available = new Set<string>();
  const unavailableFields = new Set<string>();
  const nodeTypeCounts: Record<string, number> = {};
  const fieldCoverage = fieldsToProbe.map((field) => ({
    field,
    availableCount: 0,
    unavailableCount: 0,
    sampleValues: [] as Array<string | number | boolean | null>
  }));

  for (const node of nodes) {
    const rawType = String(node.type ?? "UNKNOWN");
    nodeTypeCounts[rawType] = (nodeTypeCounts[rawType] ?? 0) + 1;

    for (const coverage of fieldCoverage) {
      const result = inspectField(node, coverage.field);
      if (result.available) {
        available.add(coverage.field);
        coverage.availableCount += 1;
        if (fieldsToSample.has(coverage.field)) {
          const sample = safeSample(result.value);
          if (sample !== undefined && !coverage.sampleValues.includes(sample) && coverage.sampleValues.length < 5) {
            coverage.sampleValues.push(sample);
          }
        }
      } else {
        unavailableFields.add(coverage.field);
        coverage.unavailableCount += 1;
      }
    }
  }
  return {
    schemaVersion,
    createdAt: new Date().toISOString(),
    sourceTool: "pixso",
    checkedNodeCount: nodes.length,
    checkedRootCount: roots.length,
    sourceEnvironment: {
      pluginApiVersion: pixso?.apiVersion,
      fileName: pixso?.root?.name
    },
    availableFields: [...available].sort(),
    unavailableFields: [...unavailableFields].filter((field) => !available.has(field)).sort(),
    nodeTypeCounts,
    fieldCoverage,
    notes: ["本报告递归检查选中节点及其全部后代。字段值仅采样非敏感的布局与节点类型信息。"]
  };
}

function createMigrationMap(scope: ExportScope, roots: RootRef[], index: number, total: number): MigrationMap {
  const nodes = flattenRoots(roots);
  const migrationIds = new Set<string>();
  for (const node of nodes) {
    if (migrationIds.has(node.migrationId)) {
      throw new Error(`检测到重复迁移标识 ${node.migrationId}，已停止导出以避免错误绑定。`);
    }
    migrationIds.add(node.migrationId);
  }
  const warnings = rootIndexWarnings(roots);
  return {
    schemaVersion,
    createdAt: new Date().toISOString(),
    sourceTool: "pixso",
    sourceEnvironment: {
      deployment: "private",
      pluginApiVersion: pixso?.apiVersion,
      fileName: pixso?.root?.name
    },
    exportScope: scope,
    batch: { index, total, rootCount: roots.length },
    nodes,
    warnings
  };
}

function downloadJson(name: string, data: unknown): void {
  pixso?.ui?.postMessage?.({ type: "download-json", name, data });
}

function postStatus(message: Record<string, unknown>): void {
  pixso?.ui?.postMessage?.(message);
}

async function exportBatches(scope: ExportScope, batchSize: number): Promise<void> {
  exportCancelled = false;
  const roots = rootsForScope(scope);
  const safeBatchSize = Math.max(1, Math.min(50, Math.floor(batchSize) || 5));
  const total = Math.ceil(roots.length / safeBatchSize);

  for (let index = 0; index < total; index += 1) {
    if (exportCancelled) {
      postStatus({ type: "export-cancelled", completed: index, total });
      return;
    }
    const batchRoots = roots.slice(index * safeBatchSize, (index + 1) * safeBatchSize);
    const map = createMigrationMap(scope, batchRoots, index + 1, total);
    const suffix = total > 1 ? `-${String(index + 1).padStart(2, "0")}-of-${String(total).padStart(2, "0")}` : "";
    downloadJson(`migration-map${suffix}.json`, map);
    postStatus({ type: "export-progress", completed: index + 1, total, nodeCount: map.nodes.length });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  postStatus({ type: "export-complete", total });
}

pixso?.showUI?.(__html__, { width: 420, height: 520 });

pixso.ui.onmessage = async (message: { type: string; scope?: ExportScope; batchSize?: number }) => {
  if (message.type === "probe") downloadJson("capability-report.json", createCapabilityReport(readSelection()));
  if (message.type === "cancel") exportCancelled = true;
  if (message.type === "export") {
    try {
      await exportBatches(message.scope ?? "selection", message.batchSize ?? 5);
    } catch (error) {
      postStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
};
