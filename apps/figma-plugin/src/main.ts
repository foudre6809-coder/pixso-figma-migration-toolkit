import { createLayoutPlan } from "@pixso-figma-migration/layout-engine";
import { type MigrationNode, validateMigrationMap } from "@pixso-figma-migration/migration-schema";
import { type MatchCandidate, matchNodes } from "@pixso-figma-migration/node-matcher";

declare const __html__: string;

type RepairStatus = "restored" | "partial" | "failed";

interface RepairItem {
  migrationId: string;
  nodeName: string;
  status: RepairStatus;
  figmaNodeId?: string;
  messages: string[];
}

function readPluginMigrationId(node: BaseNode): string | undefined {
  if ("getPluginData" in node && typeof node.getPluginData === "function") {
    const value = node.getPluginData("migrationId");
    return value || undefined;
  }
  return undefined;
}

function absoluteRect(node: SceneNode) {
  const box = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : undefined;
  if (!box) return undefined;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function typeOf(node: SceneNode): string {
  if (node.type === "COMPONENT_SET") return "COMPONENT";
  if (node.type === "RECTANGLE" && "fills" in node) return "IMAGE";
  return node.type;
}

function collectCandidates(root: BaseNode & ChildrenMixin, parentPath: string[] = []): MatchCandidate[] {
  const children = root.children ?? [];
  return children.flatMap((child) => {
    const path = [...parentPath, child.name];
    const scene = child as SceneNode;
    const current: MatchCandidate = {
      id: child.id,
      name: child.name,
      type: typeOf(scene),
      path,
      rect: absoluteRect(scene),
      migrationId: readPluginMigrationId(child)
    };
    const nested = "children" in child ? collectCandidates(child as BaseNode & ChildrenMixin, path) : [];
    return [current, ...nested];
  });
}

function canAutoLayout(node: SceneNode): node is FrameNode | ComponentNode | InstanceNode {
  return node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE";
}

function applyOperation(node: FrameNode | ComponentNode | InstanceNode, property: string, value: string | number): void {
  if (property === "layoutMode" && (value === "HORIZONTAL" || value === "VERTICAL")) node.layoutMode = value;
  if (property === "paddingTop" && typeof value === "number") node.paddingTop = value;
  if (property === "paddingRight" && typeof value === "number") node.paddingRight = value;
  if (property === "paddingBottom" && typeof value === "number") node.paddingBottom = value;
  if (property === "paddingLeft" && typeof value === "number") node.paddingLeft = value;
  if (property === "itemSpacing" && typeof value === "number") node.itemSpacing = value;
  if (property === "primaryAxisSizingMode" && value === "AUTO") node.primaryAxisSizingMode = value;
  if (property === "counterAxisSizingMode" && value === "AUTO") node.counterAxisSizingMode = value;
}

function repairNode(source: MigrationNode, figmaNode: SceneNode): RepairItem {
  const plan = createLayoutPlan(source);
  if (!canAutoLayout(figmaNode)) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: figmaNode.id,
      messages: [`Matched node type ${figmaNode.type} cannot receive auto layout.`]
    };
  }

  for (const operation of plan.operations) applyOperation(figmaNode, operation.property, operation.value);
  if (source.type === "COMPONENT" && figmaNode.type !== "COMPONENT") plan.warnings.push("Component source matched non-component node.");
  if (source.type === "INSTANCE") plan.warnings.push("Instance rebinding is not applied automatically in MVP.");

  return {
    migrationId: source.migrationId,
    nodeName: source.name,
    status: plan.warnings.length ? "partial" : "restored",
    figmaNodeId: figmaNode.id,
    messages: plan.warnings
  };
}

function repairFromJson(json: string): RepairItem[] {
  const map = validateMigrationMap(JSON.parse(json));
  const scopeRoot = figma.currentPage.selection.length
    ? ({ children: figma.currentPage.selection } as BaseNode & ChildrenMixin)
    : figma.currentPage;
  const candidates = collectCandidates(scopeRoot);
  const matches = matchNodes(map.nodes, candidates);
  const sourceById = new Map(map.nodes.map((node) => [node.migrationId, node]));
  const results: RepairItem[] = [];

  for (const match of matches) {
    const source = sourceById.get(match.migrationId);
    if (!source) continue;
    if (match.status !== "matched" || !match.candidateId) {
      results.push({
        migrationId: source.migrationId,
        nodeName: source.name,
        status: match.status === "ambiguous" ? "partial" : "failed",
        messages: [`Node match ${match.status}; reasons: ${match.reasons.join(", ") || "none"}.`]
      });
      continue;
    }
    const figmaNode = figma.getNodeById(match.candidateId);
    if (!figmaNode || !("type" in figmaNode)) {
      results.push({ migrationId: source.migrationId, nodeName: source.name, status: "failed", messages: ["Matched node missing."] });
      continue;
    }
    results.push(repairNode(source, figmaNode as SceneNode));
  }
  return results;
}

figma.showUI(__html__, { width: 480, height: 620 });

figma.ui.onmessage = (message: { type: string; json?: string; nodeId?: string }) => {
  if (message.type === "repair" && message.json) {
    try {
      const results = repairFromJson(message.json);
      figma.ui.postMessage({ type: "results", results });
      figma.notify(`Migration repair complete: ${results.length} nodes reviewed.`);
    } catch (error) {
      figma.ui.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === "select" && message.nodeId) {
    const node = figma.getNodeById(message.nodeId);
    if (node && "visible" in node) {
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
  }
};
