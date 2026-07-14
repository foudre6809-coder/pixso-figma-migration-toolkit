import { createLayoutPlan } from "@pixso-figma-migration/layout-engine";
import { type MigrationNode, validateMigrationMap } from "@pixso-figma-migration/migration-schema";
import { assessRecoveryCompatibility, type MatchCandidate, matchNodes } from "@pixso-figma-migration/node-matcher";

declare const __html__: string;

type RepairStatus = "modified" | "verified" | "partial" | "failed";

const matchStatusLabels = { matched: "已匹配但缺少目标节点", ambiguous: "存在歧义", unmatched: "未匹配" } as const;
const reasonLabels: Record<string, string> = {
  migrationId: "迁移标识",
  name: "名称",
  type: "节点类型",
  path: "层级路径",
  rect: "位置尺寸"
};

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

function localRect(node: SceneNode) {
  if (!("x" in node) || !("y" in node) || !("width" in node) || !("height" in node)) return undefined;
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function typeOf(node: SceneNode): string {
  if (node.type === "COMPONENT_SET") return "COMPONENT";
  if (node.type === "RECTANGLE" && hasImageFill(node)) return "IMAGE";
  return node.type;
}

function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node) || !Array.isArray(node.fills)) return false;
  return node.fills.some((fill) => fill.type === "IMAGE");
}

function collectCandidates(root: BaseNode & ChildrenMixin, parentPath: string[] = []): MatchCandidate[] {
  const children = root.children ?? [];
  return children.flatMap((child, index) => {
    const path = [...parentPath, `${child.name}[${index}]`];
    const scene = child as SceneNode;
    const current: MatchCandidate = {
      id: child.id,
      name: child.name,
      type: typeOf(scene),
      path,
      rect: localRect(scene),
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
  const compatibilityIssues = assessRecoveryCompatibility(source, {
    type: typeOf(figmaNode),
    rect: localRect(figmaNode),
    textCharacters: figmaNode.type === "TEXT" ? figmaNode.characters : undefined,
    mainComponentName: figmaNode.type === "INSTANCE" ? figmaNode.mainComponent?.name : undefined,
    hasImageFill: hasImageFill(figmaNode)
  });
  const blockingIssue = compatibilityIssues.some((issue) => issue.severity === "error");
  if (blockingIssue) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: figmaNode.id,
      messages: compatibilityIssues.map((issue) => issue.message)
    };
  }
  if (!plan.shouldApply) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: compatibilityIssues.length ? "partial" : "verified",
      figmaNodeId: figmaNode.id,
      messages: [...compatibilityIssues.map((issue) => issue.message), "节点已匹配，但迁移数据中没有可应用的布局属性，仅完成一致性检查。"]
    };
  }
  if (!canAutoLayout(figmaNode)) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: figmaNode.id,
      messages: [...compatibilityIssues.map((issue) => issue.message), "目标节点不支持自动布局，未应用任何修改。"]
    };
  }

  for (const operation of plan.operations) applyOperation(figmaNode, operation.property, operation.value);
  plan.warnings.push(...compatibilityIssues.map((issue) => issue.message));

  return {
    migrationId: source.migrationId,
    nodeName: source.name,
    status: plan.warnings.length ? "partial" : "modified",
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
        messages: [
          `节点${matchStatusLabels[match.status]}（匹配分数 ${match.score.toFixed(2)}），依据：${match.reasons.map((reason) => reasonLabels[reason] ?? reason).join("、") || "无"}。`
        ]
      });
      continue;
    }
    const figmaNode = figma.getNodeById(match.candidateId);
    if (!figmaNode || !("type" in figmaNode)) {
      results.push({ migrationId: source.migrationId, nodeName: source.name, status: "failed", messages: ["匹配到的节点已不存在。"] });
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
      figma.notify(`迁移修复完成：已检查 ${results.length} 个节点。`);
    } catch (error) {
      console.error(error);
      figma.ui.postMessage({ type: "error", message: "迁移数据无效或版本不兼容，请重新从 Pixso 导出。" });
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
