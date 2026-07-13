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

function readSelection(): RawNode[] {
  return pixso?.currentPage?.selection ?? [];
}

function typeOf(node: RawNode): MigrationNode["type"] {
  const type = String(node.type ?? "UNKNOWN").toUpperCase();
  if (["FRAME", "GROUP", "COMPONENT", "INSTANCE", "TEXT", "VECTOR", "BOOLEAN"].includes(type)) {
    return type as MigrationNode["type"];
  }
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
  if (typeof value === "string") return inferred("FIXED" as const, `Unknown sizing value: ${value}`);
  return unavailable<"FIXED" | "HUG" | "FILL">("Sizing field is not exposed.");
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
        : unavailable("Geometry fields are not exposed."),
    visible: typeof node.visible === "boolean" ? native(node.visible) : unavailable("Visibility is not exposed."),
    layout: {
      mode:
        node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL"
          ? native(node.layoutMode)
          : node.layoutMode === "NONE"
            ? native("NONE")
            : unavailable("Auto layout mode is not exposed."),
      paddingTop: typeof node.paddingTop === "number" ? native(node.paddingTop) : unavailable("paddingTop unavailable"),
      paddingRight: typeof node.paddingRight === "number" ? native(node.paddingRight) : unavailable("paddingRight unavailable"),
      paddingBottom: typeof node.paddingBottom === "number" ? native(node.paddingBottom) : unavailable("paddingBottom unavailable"),
      paddingLeft: typeof node.paddingLeft === "number" ? native(node.paddingLeft) : unavailable("paddingLeft unavailable"),
      gap: typeof node.itemSpacing === "number" ? native(node.itemSpacing) : unavailable("itemSpacing unavailable"),
      widthMode: mapSizing(node.layoutSizingHorizontal),
      heightMode: mapSizing(node.layoutSizingVertical)
    },
    component: {
      componentKey: typeof node.componentKey === "string" ? native(node.componentKey) : unavailable("componentKey unavailable"),
      mainComponentId:
        typeof node.mainComponent?.id === "string" ? native(node.mainComponent.id) : unavailable("mainComponent unavailable"),
      instanceOf: typeof node.mainComponent?.name === "string" ? native(node.mainComponent.name) : unavailable("instanceOf unavailable")
    },
    text: {
      characters: typeof node.characters === "string" ? native(node.characters) : unavailable("Text characters unavailable"),
      styleSummary: unavailable("Text style summary requires deployment-specific adapter.")
    },
    asset: {
      svgSummary: typeOf(node) === "VECTOR" ? inferred("Vector node present", "Exact SVG export is not exposed in probe.") : unavailable(),
      imageFillSummary: Array.isArray(node.fills) ? inferred(`${node.fills.length} fills`, "Fill details require manual validation.") : unavailable()
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

function createCapabilityReport(nodes: RawNode[]): CapabilityReport {
  const available = new Set<string>();
  const unavailableFields = new Set<string>();
  for (const node of nodes) {
    for (const field of fieldsToProbe) {
      if (field in node && node[field] !== undefined) available.add(field);
      else unavailableFields.add(field);
    }
  }
  return {
    schemaVersion,
    createdAt: new Date().toISOString(),
    sourceTool: "pixso",
    checkedNodeCount: nodes.length,
    availableFields: [...available].sort(),
    unavailableFields: [...unavailableFields].filter((field) => !available.has(field)).sort(),
    notes: ["Run this probe inside the target Pixso private deployment before trusting migration exports."]
  };
}

function createMigrationMap(scope: MigrationMap["exportScope"]): MigrationMap {
  const selection = readSelection();
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
    nodes: flatten(selection),
    warnings: selection.length === 0 ? ["No selected nodes. Select one or more artboards before exporting."] : []
  };
}

function downloadJson(name: string, data: unknown): void {
  pixso?.ui?.postMessage?.({ type: "download-json", name, data });
}

pixso?.showUI?.(__html__, { width: 420, height: 520 });

pixso.ui.onmessage = (message: { type: string; scope?: MigrationMap["exportScope"] }) => {
  if (message.type === "probe") downloadJson("capability-report.json", createCapabilityReport(readSelection()));
  if (message.type === "export") downloadJson("migration-map.json", createMigrationMap(message.scope ?? "selection"));
};
