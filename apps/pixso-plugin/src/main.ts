import {
  type CapabilityReport,
  type MigrationMap,
  type MigrationNode,
  inferred,
  native,
  schemaVersion,
  unavailable
} from "@pixso-figma-migration/migration-schema";

declare const pixso: any;
declare const __html__: string;

type RawNode = Record<string, any>;
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
  "componentKey",
  "mainComponent",
  "characters",
  "fills",
  "visible",
  "isMask"
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
  "layoutSizingVertical"
]);

function readSelection(): RawNode[] {
  return pixso?.currentPage?.selection ?? [];
}

function rootsForScope(scope: ExportScope): RawNode[] {
  const selection = readSelection();
  if (scope === "page") {
    const children = pixso?.currentPage?.children;
    if (!Array.isArray(children)) throw new Error("当前 Pixso 私有化版本未开放当前页面的子节点接口。");
    return children;
  }
  if (scope === "artboard") {
    const artboards = selection.filter((node) => Array.isArray(node.children));
    if (!artboards.length) throw new Error("请先选择一个或多个画板，再按画板范围导出。");
    return artboards;
  }
  if (!selection.length) throw new Error("请先选择一个或多个节点。");
  return selection;
}

function typeOf(node: RawNode): MigrationNode["type"] {
  const type = String(node.type ?? "UNKNOWN").toUpperCase();
  if (["FRAME", "GROUP", "COMPONENT", "INSTANCE", "TEXT", "VECTOR", "BOOLEAN"].includes(type)) {
    return type as MigrationNode["type"];
  }
  if (["RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "STAR", "SHAPE_PATH"].includes(type)) return "VECTOR";
  if (type.includes("IMAGE")) return "IMAGE";
  return "UNKNOWN";
}

function createMigrationId(node: RawNode, path: string[]): string {
  if (typeof node.getPluginData === "function") {
    const existing = node.getPluginData("migrationId");
    if (existing) return existing;
  }
  const base = `${path.join("/")}|${node.name ?? "unnamed"}|${node.type ?? "UNKNOWN"}|${node.width ?? 0}x${node.height ?? 0}`;
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return `pxm_${hash.toString(16)}`;
}

function writeMigrationIdIfAllowed(node: RawNode, migrationId: string): void {
  if (typeof node.setPluginData !== "function") return;
  try {
    node.setPluginData("migrationId", migrationId);
  } catch {
    // Private Pixso deployments may expose read methods without write permissions.
  }
}

function mapSizing(value: unknown) {
  if (value === "HUG" || value === "AUTO") return native("HUG" as const);
  if (value === "FILL" || value === "STRETCH") return native("FILL" as const);
  if (typeof value === "string") return inferred("FIXED" as const, `无法识别尺寸模式 ${value}，按固定尺寸处理。`);
  return unavailable<"FIXED" | "HUG" | "FILL">("未开放尺寸模式字段。");
}

function toMigrationNode(node: RawNode, path: string[], parentMigrationId?: string): MigrationNode {
  const migrationId = createMigrationId(node, path);
  writeMigrationIdIfAllowed(node, migrationId);
  const children = Array.isArray(node.children) ? node.children : [];
  const childIds = children.map((child: RawNode, index: number) =>
    createMigrationId(child, [...path, `${child.name ?? "unnamed"}[${index}]`])
  );

  return {
    migrationId,
    originalId: typeof node.id === "string" ? node.id : undefined,
    name: String(node.name ?? "Unnamed"),
    type: typeOf(node),
    path,
    parentMigrationId,
    childMigrationIds: childIds,
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
      widthMode: mapSizing(node.layoutSizingHorizontal),
      heightMode: mapSizing(node.layoutSizingVertical)
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
      svgSummary: typeOf(node) === "VECTOR" ? inferred("存在矢量节点", "能力检测未发现精确导出 SVG 的接口。") : unavailable(),
      imageFillSummary: Array.isArray(node.fills) ? inferred(`包含 ${node.fills.length} 个填充`, "填充详情需要人工验证。") : unavailable()
    },
    riskFlags: [
      ...(node.isMask ? ["mask"] : []),
      ...(typeOf(node) === "GROUP" ? ["group-may-import-as-frame-or-group"] : [])
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

function createMigrationMap(scope: ExportScope, roots: RawNode[], index: number, total: number): MigrationMap {
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
    nodes: flatten(roots),
    warnings: []
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
