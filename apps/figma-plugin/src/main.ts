import { classifyBackgroundRectangle, createLayoutPlan } from "@pixso-figma-migration/layout-engine";
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

interface GroupConversion {
  frame: FrameNode;
  message: string;
  retainedBackground?: RectangleNode;
}

function hasOnlySolidFills(node: RectangleNode): boolean {
  return node.fills !== figma.mixed && node.fills.every((fill) => fill.type === "SOLID");
}

function copyRectangleAppearanceToFrame(rectangle: RectangleNode, frame: FrameNode): void {
  if (rectangle.fills !== figma.mixed) frame.fills = rectangle.fills;
  frame.strokes = rectangle.strokes;
  if (typeof rectangle.strokeWeight === "number") frame.strokeWeight = rectangle.strokeWeight;
  frame.strokeAlign = rectangle.strokeAlign;
  frame.dashPattern = rectangle.dashPattern;
  frame.effects = rectangle.effects;
  frame.cornerSmoothing = rectangle.cornerSmoothing;
  if (typeof rectangle.cornerRadius === "number") {
    frame.cornerRadius = rectangle.cornerRadius;
  } else {
    frame.topLeftRadius = rectangle.topLeftRadius;
    frame.topRightRadius = rectangle.topRightRadius;
    frame.bottomRightRadius = rectangle.bottomRightRadius;
    frame.bottomLeftRadius = rectangle.bottomLeftRadius;
  }
}

function convertGroupToFrame(group: GroupNode): GroupConversion | undefined {
  const parent = group.parent;
  if (!parent || !("children" in parent) || !("insertChild" in parent) || group.rotation !== 0) return undefined;

  const originalChildren = [...group.children];
  const bottomChild = originalChildren[0];
  const background = bottomChild?.type === "RECTANGLE" ? bottomChild : undefined;
  const backgroundClassification = background
    ? classifyBackgroundRectangle(
        {
          type: background.type,
          index: 0,
          x: background.x,
          y: background.y,
          width: background.width,
          height: background.height,
          visible: background.visible,
          isMask: background.isMask,
          rotation: background.rotation,
          opacity: background.opacity,
          blendMode: background.blendMode,
          hasOnlySolidFills: hasOnlySolidFills(background)
        },
        group.width,
        group.height
      )
    : "none";
  const index = parent.children.indexOf(group);
  const frame = figma.createFrame();
  frame.name = group.name;
  frame.x = group.x;
  frame.y = group.y;
  frame.resizeWithoutConstraints(group.width, group.height);
  frame.fills = [];
  frame.clipsContent = false;
  frame.opacity = group.opacity;
  frame.blendMode = group.blendMode;
  frame.visible = group.visible;
  frame.locked = group.locked;
  parent.insertChild(index, frame);

  if (background && backgroundClassification === "promote") {
    copyRectangleAppearanceToFrame(background, frame);
  }

  for (const child of originalChildren) {
    if (child === background && backgroundClassification === "promote") {
      child.remove();
      continue;
    }
    const { x, y } = child;
    frame.appendChild(child);
    child.x = x;
    child.y = y;
  }
  group.remove();
  const message =
    backgroundClassification === "promote"
      ? "已将 Group 的纯色底图矩形外观迁移到 Frame。"
      : backgroundClassification === "retain"
        ? "底图包含复杂属性，已保留为绝对定位图层，Frame 保持透明。"
        : "未发现可确认的底图矩形，已保留原图层，Frame 保持透明。";
  return {
    frame,
    message,
    retainedBackground: backgroundClassification === "retain" ? background : undefined
  };
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
  let layoutTarget: SceneNode = figmaNode;
  let retainedBackground: RectangleNode | undefined;
  const messages: string[] = [];
  if (figmaNode.type === "GROUP") {
    const converted = convertGroupToFrame(figmaNode);
    if (converted) {
      layoutTarget = converted.frame;
      retainedBackground = converted.retainedBackground;
      messages.push("已将 Sketch 导入的 Group 原位转换为 Frame。", converted.message);
    }
  }
  if (!canAutoLayout(layoutTarget)) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: layoutTarget.id,
      messages: [...compatibilityIssues.map((issue) => issue.message), "目标节点不支持自动布局，未应用任何修改。"]
    };
  }

  for (const operation of plan.operations) applyOperation(layoutTarget, operation.property, operation.value);
  if (retainedBackground) retainedBackground.layoutPositioning = "ABSOLUTE";
  plan.warnings.push(...compatibilityIssues.map((issue) => issue.message));

  return {
    migrationId: source.migrationId,
    nodeName: source.name,
    status: plan.warnings.length ? "partial" : "modified",
    figmaNodeId: layoutTarget.id,
    messages: [...messages, ...plan.warnings]
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
