import {
  classifyBackgroundRectangle,
  createLayoutPlan,
  protectRetainedBackgroundBeforeLayout
} from "@pixso-figma-migration/layout-engine";
import { type MigrationNode, validateMigrationMap } from "@pixso-figma-migration/migration-schema";
import {
  assessRecoveryCompatibility,
  canSafelyRebuildMainComponent,
  type MatchResult,
  type MatchCandidate,
  matchNodes,
  normalizeFlattenedRoot
} from "@pixso-figma-migration/node-matcher";

declare const __html__: string;

type RepairStatus = "modified" | "verified" | "partial" | "failed";
type RunMode = "preview" | "apply";

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

function writePluginMigrationId(node: BaseNode, migrationId: string): void {
  if ("setPluginData" in node && typeof node.setPluginData === "function") {
    node.setPluginData("migrationId", migrationId);
  }
}

function localRect(node: SceneNode) {
  if (!("x" in node) || !("y" in node) || !("width" in node) || !("height" in node)) return undefined;
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function absoluteRect(node: SceneNode) {
  if (!("absoluteTransform" in node) || !("width" in node) || !("height" in node)) return undefined;
  return { x: node.absoluteTransform[0][2], y: node.absoluteTransform[1][2], width: node.width, height: node.height };
}

function typeOf(node: SceneNode): string {
  if (node.type === "COMPONENT_SET") return "COMPONENT";
  if (node.type === "BOOLEAN_OPERATION") return "BOOLEAN";
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
      absoluteRect: absoluteRect(scene),
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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

function hasOnlySolidFills(node: RectangleNode): boolean {
  return node.fills !== figma.mixed && node.fills.every((fill) => fill.type === "SOLID");
}

function tryCopyRectangleAppearanceToFrame(rectangle: RectangleNode, frame: FrameNode): string | undefined {
  try {
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
    return undefined;
  } catch (error) {
    frame.fills = [];
    frame.strokes = [];
    frame.effects = [];
    frame.cornerRadius = 0;
    return describeError(error);
  }
}

function convertGroupToFrame(group: GroupNode): GroupConversion | undefined {
  const parent = group.parent;
  if (!parent || !("children" in parent) || !("insertChild" in parent) || group.rotation !== 0) return undefined;

  const originalChildren = [...group.children];
  const bottomChild = originalChildren[0];
  const background = bottomChild?.type === "RECTANGLE" ? bottomChild : undefined;
  let backgroundClassification = background
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
  const groupLocked = group.locked;
  const frame = figma.createFrame();
  let promotionError: string | undefined;
  try {
    frame.name = group.name;
    frame.x = group.x;
    frame.y = group.y;
    frame.resizeWithoutConstraints(group.width, group.height);
    frame.fills = [];
    frame.clipsContent = false;
    frame.opacity = group.opacity;
    frame.blendMode = group.blendMode;
    frame.visible = group.visible;
    parent.insertChild(index, frame);

    if (background && backgroundClassification === "promote") {
      promotionError = tryCopyRectangleAppearanceToFrame(background, frame);
      if (promotionError) backgroundClassification = "retain";
    }

    for (const child of originalChildren) {
      if (child === background && backgroundClassification === "promote") continue;
      const { x, y } = child;
      frame.appendChild(child);
      child.x = x;
      child.y = y;
    }
    if (background && backgroundClassification === "promote" && !background.removed) background.remove();
    if (!group.removed) group.remove();
    frame.locked = groupLocked;
  } catch (error) {
    if (!group.removed) {
      for (const [childIndex, child] of originalChildren.entries()) {
        if (child.removed || child.parent === group) continue;
        const { x, y } = child;
        group.insertChild(Math.min(childIndex, group.children.length), child);
        child.x = x;
        child.y = y;
      }
    }
    if (!frame.removed) frame.remove();
    throw error;
  }
  const message =
    backgroundClassification === "promote"
      ? "已将 Group 的纯色底图矩形外观迁移到 Frame。"
      : backgroundClassification === "retain"
        ? promotionError
          ? `底图外观无法安全迁移，已保留为绝对定位图层：${promotionError}`
          : "底图包含复杂属性，已保留为绝对定位图层，Frame 保持透明。"
        : "未发现可确认的底图矩形，已保留原图层，Frame 保持透明。";
  return {
    frame,
    message,
    retainedBackground: backgroundClassification === "retain" ? background : undefined
  };
}

function restoreConvertedFrameBounds(
  frame: FrameNode,
  source: MigrationNode,
  sourceRectCoordinates: "local" | "absolute"
): string | undefined {
  const sourceRect = source.rect.value;
  const currentRect = sourceRectCoordinates === "absolute" ? absoluteRect(frame) : localRect(frame);
  if (!sourceRect || !currentRect) return undefined;

  const parentUsesAutoLayout =
    frame.parent && "layoutMode" in frame.parent && frame.parent.layoutMode !== "NONE";
  if (!parentUsesAutoLayout) {
    frame.x += sourceRect.x - currentRect.x;
    frame.y += sourceRect.y - currentRect.y;
  }
  frame.resizeWithoutConstraints(sourceRect.width, sourceRect.height);
  return "已按 Pixso 原始边界恢复 Frame 的位置与尺寸。";
}

function applyOperation(node: FrameNode | ComponentNode | InstanceNode, property: string, value: string | number): void {
  if (property === "layoutMode" && (value === "HORIZONTAL" || value === "VERTICAL")) node.layoutMode = value;
  if (property === "paddingTop" && typeof value === "number") node.paddingTop = value;
  if (property === "paddingRight" && typeof value === "number") node.paddingRight = value;
  if (property === "paddingBottom" && typeof value === "number") node.paddingBottom = value;
  if (property === "paddingLeft" && typeof value === "number") node.paddingLeft = value;
  if (property === "itemSpacing" && typeof value === "number") node.itemSpacing = value;
  if (property === "primaryAxisSizingMode" && (value === "AUTO" || value === "FIXED")) node.primaryAxisSizingMode = value;
  if (property === "counterAxisSizingMode" && (value === "AUTO" || value === "FIXED")) node.counterAxisSizingMode = value;
  if (property === "minHeight" && typeof value === "number" && "minHeight" in node) {
    (node as typeof node & { minHeight: number | null }).minHeight = value;
  }
}

type AppearanceNode = SceneNode & GeometryMixin;

function canApplyAppearance(node: SceneNode): node is AppearanceNode {
  return "fills" in node && "strokes" in node && "strokeWeight" in node && "strokeAlign" in node;
}

function paintsEqual(current: ReadonlyArray<Paint> | PluginAPI["mixed"], expected: ReadonlyArray<Paint>): boolean {
  return current !== figma.mixed && JSON.stringify(current) === JSON.stringify(expected);
}

function applyAppearance(source: MigrationNode, node: AppearanceNode): string[] {
  const messages: string[] = [];
  const { appearance } = source;
  if (appearance.fill.source !== "unavailable") {
    const fills: ReadonlyArray<Paint> = appearance.fill.value
      ? [{ type: "SOLID", color: appearance.fill.value.color, opacity: appearance.fill.value.opacity }]
      : [];
    if (!paintsEqual(node.fills, fills)) {
      node.fills = fills;
      messages.push("已恢复填充。");
    }
  }
  if (appearance.stroke.source !== "unavailable") {
    const strokes: ReadonlyArray<Paint> = appearance.stroke.value
      ? [{ type: "SOLID", color: appearance.stroke.value.color, opacity: appearance.stroke.value.opacity }]
      : [];
    if (!paintsEqual(node.strokes, strokes)) {
      node.strokes = strokes;
      messages.push("已恢复描边。");
    }
  }
  if (typeof appearance.strokeWeight.value === "number" && node.strokeWeight !== appearance.strokeWeight.value) {
    node.strokeWeight = appearance.strokeWeight.value;
    messages.push("已恢复描边粗细。");
  }
  if (appearance.strokeAlign.value && node.strokeAlign !== appearance.strokeAlign.value) {
    node.strokeAlign = appearance.strokeAlign.value;
    messages.push("已恢复描边位置。");
  }
  if (appearance.cornerRadii.value && "topLeftRadius" in node) {
    const [topLeft, topRight, bottomRight, bottomLeft] = appearance.cornerRadii.value;
    if (
      node.topLeftRadius !== topLeft ||
      node.topRightRadius !== topRight ||
      node.bottomRightRadius !== bottomRight ||
      node.bottomLeftRadius !== bottomLeft
    ) {
      node.topLeftRadius = topLeft;
      node.topRightRadius = topRight;
      node.bottomRightRadius = bottomRight;
      node.bottomLeftRadius = bottomLeft;
      messages.push("已恢复圆角。");
    }
  }
  return messages;
}

function hasRecoverableAppearance(source: MigrationNode): boolean {
  return Object.values(source.appearance).some((field) => field.source !== "unavailable");
}

function hasForbiddenComponentAncestor(node: SceneNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === "COMPONENT" || parent.type === "COMPONENT_SET" || parent.type === "INSTANCE") return true;
    parent = parent.parent;
  }
  return false;
}

function componentInformation(source: MigrationNode, figmaNode: SceneNode): string[] {
  if (source.type !== "INSTANCE") return [];
  const original = [
    `名称=${source.component.instanceOf.value ?? "未知"}`,
    `主组件ID=${source.component.mainComponentId.value ?? "未知"}`,
    `组件Key=${source.component.componentKey.value ?? "未知"}`
  ].join("，");
  const candidate =
    figmaNode.type === "INSTANCE"
      ? `INSTANCE，主组件=${figmaNode.mainComponent?.name ?? "未知"}，Key=${figmaNode.mainComponent?.key ?? "未知"}`
      : `${figmaNode.type}，节点=${figmaNode.name}，无可确认主组件`;
  return [`原组件信息：${original}。`, `候选组件信息：${candidate}。`, "实例自动重绑未启用。"];
}

function componentRebuildDecision(source: MigrationNode, figmaNode: SceneNode, match: MatchResult): {
  eligible: boolean;
  message?: string;
} {
  if (source.type !== "COMPONENT") return { eligible: false };
  if (figmaNode.type !== "FRAME") {
    return { eligible: false, message: `主 Component 未重建：候选节点类型为 ${figmaNode.type}，要求普通 Frame。` };
  }
  if (!canSafelyRebuildMainComponent(source.type, figmaNode.type, match, hasForbiddenComponentAncestor(figmaNode))) {
    if (hasForbiddenComponentAncestor(figmaNode)) {
      return { eligible: false, message: "主 Component 未重建：候选 Frame 位于 Component、Component Set 或 Instance 内。" };
    }
    return { eligible: false, message: "主 Component 未重建：匹配未达到唯一高置信度要求。" };
  }
  return { eligible: true };
}

function repairNode(
  source: MigrationNode,
  figmaNode: SceneNode,
  sourceChildren: MigrationNode[],
  sourceRectCoordinates: "local" | "absolute",
  match: MatchResult,
  mode: RunMode
): RepairItem {
  const plan = createLayoutPlan(source, { children: sourceChildren });
  const compatibilityIssues = assessRecoveryCompatibility(source, {
    type: typeOf(figmaNode),
    rect: localRect(figmaNode),
    textCharacters: figmaNode.type === "TEXT" ? figmaNode.characters : undefined,
    mainComponentName: figmaNode.type === "INSTANCE" ? figmaNode.mainComponent?.name : undefined,
    hasImageFill: hasImageFill(figmaNode)
  });
  const componentMessages = componentInformation(source, figmaNode);
  const componentDecision = componentRebuildDecision(source, figmaNode, match);
  if (componentDecision.eligible) {
    const lostLinkWarning = compatibilityIssues.findIndex((issue) => issue.code === "component-link-lost");
    if (lostLinkWarning >= 0) compatibilityIssues.splice(lostLinkWarning, 1);
  }
  const appearanceWork = hasRecoverableAppearance(source) && canApplyAppearance(figmaNode);
  const blockingIssue = compatibilityIssues.some((issue) => issue.severity === "error");
  if (blockingIssue) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: figmaNode.id,
      messages: [...compatibilityIssues.map((issue) => issue.message), ...componentMessages]
    };
  }

  if (plan.riskLevel === "high") {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "partial",
      figmaNodeId: figmaNode.id,
      messages: [...plan.warnings, ...compatibilityIssues.map((issue) => issue.message), ...componentMessages, "高风险项默认跳过，未修改 Figma。"]
    };
  }

  const previewMessages = [
    ...(plan.shouldApply ? ["预览：可执行安全的自动布局修复。"] : ["预览：没有可应用的自动布局属性。"]),
    ...(appearanceWork ? ["预览：可安全恢复填充、描边或圆角。"] : []),
    ...(componentDecision.eligible ? ["预览：可将唯一高置信普通 Frame 重建为主 Component。"] : []),
    ...(componentDecision.message ? [componentDecision.message] : []),
    ...plan.warnings,
    ...compatibilityIssues.map((issue) => issue.message),
    ...componentMessages
  ];
  if (mode === "preview") {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: plan.warnings.length || compatibilityIssues.length || Boolean(componentDecision.message) ? "partial" : "verified",
      figmaNodeId: figmaNode.id,
      messages: previewMessages
    };
  }

  if (!plan.shouldApply && !componentDecision.eligible && !appearanceWork) {
    writePluginMigrationId(figmaNode, source.migrationId);
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: compatibilityIssues.length || Boolean(componentDecision.message) ? "partial" : "verified",
      figmaNodeId: figmaNode.id,
      messages: [
        ...compatibilityIssues.map((issue) => issue.message),
        ...(componentDecision.message ? [componentDecision.message] : []),
        ...componentMessages,
        "节点已匹配，但没有可安全应用的修改。"
      ]
    };
  }

  let layoutTarget: SceneNode = figmaNode;
  let retainedBackground: RectangleNode | undefined;
  const messages: string[] = [];
  if (componentDecision.eligible && layoutTarget.type === "FRAME") {
    layoutTarget = figma.createComponentFromNode(layoutTarget);
    messages.push("已将唯一高置信普通 Frame 重建为主 Component。");
  }
  if (figmaNode.type === "GROUP") {
    const converted = convertGroupToFrame(figmaNode);
    if (converted) {
      layoutTarget = converted.frame;
      retainedBackground = converted.retainedBackground;
      messages.push("已将 Sketch 导入的 Group 原位转换为 Frame。", converted.message);
      const boundsMessage = restoreConvertedFrameBounds(converted.frame, source, sourceRectCoordinates);
      if (boundsMessage) messages.push(boundsMessage);
    }
  }
  if (plan.shouldApply && !canAutoLayout(layoutTarget)) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: layoutTarget.id,
      messages: [...compatibilityIssues.map((issue) => issue.message), "目标节点不支持自动布局，未应用任何修改。"]
    };
  }

  if (plan.shouldApply && canAutoLayout(layoutTarget)) {
    const layoutModeOperation = plan.operations.find((operation) => operation.property === "layoutMode");
    if (layoutModeOperation) {
      if (retainedBackground) {
        protectRetainedBackgroundBeforeLayout(retainedBackground, () =>
          applyOperation(layoutTarget as FrameNode | ComponentNode | InstanceNode, layoutModeOperation.property, layoutModeOperation.value)
        );
      } else {
        applyOperation(layoutTarget, layoutModeOperation.property, layoutModeOperation.value);
      }
    }
    for (const operation of plan.operations) {
      if (operation !== layoutModeOperation) applyOperation(layoutTarget, operation.property, operation.value);
    }
  }

  if (canApplyAppearance(layoutTarget) && hasRecoverableAppearance(source)) {
    messages.push(...applyAppearance(source, layoutTarget));
  }
  if (!componentDecision.eligible && componentDecision.message) {
    messages.push(componentDecision.message);
  }
  writePluginMigrationId(layoutTarget, source.migrationId);
  plan.warnings.push(...compatibilityIssues.map((issue) => issue.message));

  const didModify = plan.shouldApply || componentDecision.eligible || messages.some((message) => message.startsWith("已"));
  return {
    migrationId: source.migrationId,
    nodeName: source.name,
    status: plan.warnings.length ? "partial" : didModify ? "modified" : "verified",
    figmaNodeId: layoutTarget.id,
    messages: [...messages, ...plan.warnings, ...componentMessages]
  };
}

function runFromJson(json: string, mode: RunMode): RepairItem[] {
  const input = JSON.parse(json) as Record<string, unknown>;
  if ("checkedNodeCount" in input && !("nodes" in input)) {
    throw new Error("你选择的是 capability-report.json（能力检测报告）。请改选 Pixso 导出的 migration-map.json。");
  }
  const map = validateMigrationMap(input);
  const scopeRoot = figma.currentPage.selection.length
    ? ({ children: figma.currentPage.selection } as BaseNode & ChildrenMixin)
    : figma.currentPage;
  const candidates = collectCandidates(scopeRoot);
  const normalized = normalizeFlattenedRoot(map.nodes, candidates);
  const matches = matchNodes(normalized.nodes, normalized.candidates);
  const sourceById = new Map(normalized.nodes.map((node) => [node.migrationId, node]));
  const sourceRectCoordinates = normalized.flattenedRoot ? "absolute" : "local";
  const results: RepairItem[] = [];

  if (normalized.flattenedRoot) {
    results.push({
      migrationId: normalized.flattenedRoot.migrationId,
      nodeName: normalized.flattenedRoot.name,
      status: "verified",
      messages: ["Sketch 已将最外层画板展平；已按原始画板坐标修正其直接子节点的匹配位置。"]
    });
  }

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
    try {
      const sourceChildren = source.childMigrationIds.flatMap((id) => {
        const child = sourceById.get(id);
        return child ? [child] : [];
      });
      results.push(repairNode(source, figmaNode as SceneNode, sourceChildren, sourceRectCoordinates, match, mode));
    } catch (error) {
      console.error(`修复节点失败：${source.name} (${source.migrationId})`, error);
      results.push({
        migrationId: source.migrationId,
        nodeName: source.name,
        status: "failed",
        figmaNodeId: figmaNode.id,
        messages: [`修复执行失败：${describeError(error)}`]
      });
    }
  }
  return results;
}

figma.showUI(__html__, { width: 480, height: 620 });

figma.ui.onmessage = (message: { type: string; json?: string; nodeId?: string }) => {
  if ((message.type === "preview" || message.type === "repair") && message.json) {
    try {
      const mode: RunMode = message.type === "preview" ? "preview" : "apply";
      const results = runFromJson(message.json, mode);
      figma.ui.postMessage({ type: "results", results, mode });
      figma.notify(`${mode === "preview" ? "扫描预览" : "安全修复"}完成：已检查 ${results.length} 个节点。`);
    } catch (error) {
      console.error(error);
      figma.ui.postMessage({ type: "error", message: `无法开始修复：${describeError(error)}` });
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
