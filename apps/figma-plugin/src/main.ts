import {
  classifyApplyFailureStatus,
  classifyPreviewStatus,
  classifyBackgroundRectangle,
  createLayoutPlan,
  createOperationExecutionPlan,
  hasDirectSolidAppearance,
  protectRetainedBackgroundBeforeLayout,
  requiresLaunchSelection
} from "@pixso-figma-migration/layout-engine";
import { type MigrationNode, validateMigrationMap } from "@pixso-figma-migration/migration-schema";
import {
  assessRecoveryCompatibility,
  canSafelyRebuildMainComponent,
  createSafeGeometryRestorePlan,
  type GeometryRestorePlan,
  type MatchResult,
  type MatchCandidate,
  matchNodes,
  normalizeFlattenedRoot
} from "@pixso-figma-migration/node-matcher";

declare const __html__: string;

type RepairStatus = "modified" | "verified" | "partial" | "failed";
type RunMode = "preview" | "apply";

const launchSelectionIds = figma.currentPage.selection.map((node) => node.id);
const launchedWithSelection = launchSelectionIds.length > 0;

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
  plannedChanges: string[];
  appliedChanges: string[];
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
  promotedBackground: boolean;
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
    promotedBackground: backgroundClassification === "promote",
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

function applyAppearance(source: MigrationNode, node: AppearanceNode, mode: RunMode): string[] {
  const messages: string[] = [];
  const { appearance } = source;
  if (appearance.fill.value) {
    const fills: ReadonlyArray<Paint> = [
      { type: "SOLID", color: appearance.fill.value.color, opacity: appearance.fill.value.opacity }
    ];
    if (!paintsEqual(node.fills, fills)) {
      if (mode === "apply") node.fills = fills;
      messages.push("已恢复填充。");
    }
  }
  if (appearance.stroke.value) {
    const strokes: ReadonlyArray<Paint> = [
      { type: "SOLID", color: appearance.stroke.value.color, opacity: appearance.stroke.value.opacity }
    ];
    if (!paintsEqual(node.strokes, strokes)) {
      if (mode === "apply") node.strokes = strokes;
      messages.push("已恢复描边。");
    }
  }
  if (
    appearance.stroke.value &&
    typeof appearance.strokeWeight.value === "number" &&
    node.strokeWeight !== appearance.strokeWeight.value
  ) {
    if (mode === "apply") node.strokeWeight = appearance.strokeWeight.value;
    messages.push("已恢复描边粗细。");
  }
  if (appearance.stroke.value && appearance.strokeAlign.value && node.strokeAlign !== appearance.strokeAlign.value) {
    if (mode === "apply") node.strokeAlign = appearance.strokeAlign.value;
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
      if (mode === "apply") {
        node.topLeftRadius = topLeft;
        node.topRightRadius = topRight;
        node.bottomRightRadius = bottomRight;
        node.bottomLeftRadius = bottomLeft;
      }
      messages.push("已恢复圆角。");
    }
  }
  return messages;
}

function canResizeWithoutConstraints(node: SceneNode): node is SceneNode & { resizeWithoutConstraints(width: number, height: number): void } {
  return "resizeWithoutConstraints" in node && typeof node.resizeWithoutConstraints === "function";
}

function applyGeometryRestorePlan(node: SceneNode, plan: GeometryRestorePlan, mode: RunMode): string[] {
  const messages: string[] = [];
  if (typeof plan.width === "number" && typeof plan.height === "number") {
    if (mode === "apply" && canResizeWithoutConstraints(node)) node.resizeWithoutConstraints(plan.width, plan.height);
    messages.push(`${mode === "preview" ? "预览：可" : "已"}按 Pixso 恢复根画板尺寸 ${plan.width}×${plan.height}。`);
  }
  if (typeof plan.x === "number" && typeof plan.y === "number") {
    if (mode === "apply") {
      node.x = plan.x;
      node.y = plan.y;
    }
    messages.push(`${mode === "preview" ? "预览：可" : "已"}按 Pixso 原始父级坐标归位到 (${plan.x}, ${plan.y})。`);
  }
  return messages;
}

function hasRecoverableAppearance(source: MigrationNode): boolean {
  return hasDirectSolidAppearance(source);
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

function canRebuildComponentAfterGroupConversion(source: MigrationNode, figmaNode: SceneNode, match: MatchResult): boolean {
  return (
    source.type === "COMPONENT" &&
    figmaNode.type === "GROUP" &&
    canSafelyRebuildMainComponent(source.type, "FRAME", match, hasForbiddenComponentAncestor(figmaNode))
  );
}

function repairNode(
  source: MigrationNode,
  figmaNode: SceneNode,
  sourceChildren: MigrationNode[],
  sourceRectCoordinates: "local" | "absolute",
  match: MatchResult,
  mode: RunMode,
  geometryPlan?: GeometryRestorePlan
): RepairItem {
  const plan = createLayoutPlan(source, { children: sourceChildren });
  const compatibilityIssues = assessRecoveryCompatibility(source, {
    type: typeOf(figmaNode),
    rect: localRect(figmaNode),
    textCharacters: figmaNode.type === "TEXT" ? figmaNode.characters : undefined,
    mainComponentName: figmaNode.type === "INSTANCE" ? figmaNode.mainComponent?.name : undefined,
    hasImageFill: hasImageFill(figmaNode)
  });
  if (typeof geometryPlan?.width === "number" && typeof geometryPlan.height === "number") {
    const staleSizeWarning = compatibilityIssues.findIndex((issue) => issue.code === "size-mismatch");
    if (staleSizeWarning >= 0) compatibilityIssues.splice(staleSizeWarning, 1);
  }
  const componentMessages = componentInformation(source, figmaNode);
  const initialComponentDecision = componentRebuildDecision(source, figmaNode, match);
  const componentAfterConversion = canRebuildComponentAfterGroupConversion(source, figmaNode, match);
  const componentSafe = initialComponentDecision.eligible || componentAfterConversion;
  if (componentSafe) {
    const lostLinkWarning = compatibilityIssues.findIndex((issue) => issue.code === "component-link-lost");
    if (lostLinkWarning >= 0) compatibilityIssues.splice(lostLinkWarning, 1);
  }
  const appearancePreview =
    hasRecoverableAppearance(source) && canApplyAppearance(figmaNode) ? applyAppearance(source, figmaNode, "preview") : [];
  const operationPlan = createOperationExecutionPlan({
    layoutRequested: plan.shouldApply,
    layoutRisk: plan.riskLevel,
    appearanceSafe: appearancePreview.length > 0,
    componentSafe
  });
  const plannedChanges = [
    ...(geometryPlan ? ["恢复坐标或尺寸"] : []),
    ...(operationPlan.applyLayout ? ["恢复自动布局"] : []),
    ...(operationPlan.applyAppearance ? ["恢复外观"] : []),
    ...(operationPlan.applyComponent ? ["重建主 Component"] : [])
  ];
  const blockingIssue = compatibilityIssues.some((issue) => issue.severity === "error");
  if (blockingIssue) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: "failed",
      figmaNodeId: figmaNode.id,
      plannedChanges: [],
      appliedChanges: [],
      messages: [...compatibilityIssues.map((issue) => issue.message), ...componentMessages]
    };
  }

  const previewMessages = [
    ...(geometryPlan ? applyGeometryRestorePlan(figmaNode, geometryPlan, "preview") : []),
    ...(operationPlan.applyLayout ? ["预览：将恢复安全的自动布局属性。"] : []),
    ...appearancePreview.map((message) => `预览：将${message.replace(/^已/, "")}`),
    ...(operationPlan.applyComponent ? ["预览：将重建唯一高置信主 Component。"] : []),
    ...(operationPlan.needsReview ? ["布局风险较高：本轮只跳过布局，仍会独立执行安全外观和 Component 操作。"] : []),
    ...(!componentSafe && initialComponentDecision.message ? [initialComponentDecision.message] : []),
    ...plan.warnings,
    ...compatibilityIssues.map((issue) => issue.message),
    ...componentMessages
  ];
  if (mode === "preview") {
    const needsReview =
      operationPlan.needsReview ||
      plan.warnings.length > 0 ||
      compatibilityIssues.length > 0 ||
      Boolean(!componentSafe && initialComponentDecision.message);
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: classifyPreviewStatus({ plannedChanges: plannedChanges.length, needsReview, blocked: false }),
      figmaNodeId: figmaNode.id,
      plannedChanges,
      appliedChanges: [],
      messages: previewMessages
    };
  }

  if (!plannedChanges.length) {
    writePluginMigrationId(figmaNode, source.migrationId);
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: compatibilityIssues.length || Boolean(initialComponentDecision.message) ? "partial" : "verified",
      figmaNodeId: figmaNode.id,
      plannedChanges,
      appliedChanges: [],
      messages: [
        ...compatibilityIssues.map((issue) => issue.message),
        ...(initialComponentDecision.message ? [initialComponentDecision.message] : []),
        ...componentMessages,
        "节点已匹配，但没有可安全应用的修改。"
      ]
    };
  }

  let layoutTarget: SceneNode = figmaNode;
  let retainedBackground: RectangleNode | undefined;
  let promotedBackground = false;
  const messages: string[] = [];
  const appliedChanges: string[] = [];
  const failedStep = (step: string, error: unknown): RepairItem => ({
    migrationId: source.migrationId,
    nodeName: source.name,
    status: classifyApplyFailureStatus(appliedChanges.length),
    figmaNodeId: layoutTarget.id,
    plannedChanges,
    appliedChanges: [...appliedChanges],
    messages: [
      ...messages,
      ...(appliedChanges.length ? [`已完成：${appliedChanges.join("、")}。`] : []),
      `${step}失败：${describeError(error)}`,
      "可以使用 Figma Undo 回退本轮已执行的修改。"
    ]
  });

  if (geometryPlan) {
    try {
      messages.push(...applyGeometryRestorePlan(layoutTarget, geometryPlan, "apply"));
      appliedChanges.push("坐标或尺寸恢复");
    } catch (error) {
      return failedStep("坐标或尺寸恢复", error);
    }
  }

  const needsGroupConversion = figmaNode.type === "GROUP" && (operationPlan.applyLayout || operationPlan.applyComponent);
  if (needsGroupConversion && figmaNode.type === "GROUP") {
    try {
      const converted = convertGroupToFrame(figmaNode);
      if (!converted) return failedStep("Group 转 Frame", "当前 Group 无法安全转换");
      layoutTarget = converted.frame;
      retainedBackground = converted.retainedBackground;
      promotedBackground = converted.promotedBackground;
      const scopeIndex = launchSelectionIds.indexOf(figmaNode.id);
      if (scopeIndex >= 0) launchSelectionIds[scopeIndex] = converted.frame.id;
      messages.push("已将 Sketch 导入的 Group 原位转换为 Frame。", converted.message);
      appliedChanges.push("Group 转 Frame");
      const boundsMessage = restoreConvertedFrameBounds(converted.frame, source, sourceRectCoordinates);
      if (boundsMessage) messages.push(boundsMessage);
    } catch (error) {
      return failedStep("Group 转 Frame", error);
    }
  }

  const finalComponentDecision = componentRebuildDecision(source, layoutTarget, match);
  if (operationPlan.applyComponent) {
    if (!finalComponentDecision.eligible || layoutTarget.type !== "FRAME") {
      messages.push(finalComponentDecision.message ?? "主 Component 未重建：转换后的节点不满足安全条件。");
    } else {
      try {
        const previousId = layoutTarget.id;
        layoutTarget = figma.createComponentFromNode(layoutTarget);
        const scopeIndex = launchSelectionIds.indexOf(previousId);
        if (scopeIndex >= 0) launchSelectionIds[scopeIndex] = layoutTarget.id;
        messages.push("已将唯一高置信普通 Frame 重建为主 Component。");
        appliedChanges.push("主 Component 重建");
      } catch (error) {
        return failedStep("主 Component 重建", error);
      }
    }
  }

  if (operationPlan.applyLayout && !canAutoLayout(layoutTarget)) {
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status: appliedChanges.length ? "partial" : "failed",
      figmaNodeId: layoutTarget.id,
      plannedChanges,
      appliedChanges,
      messages: [...messages, ...compatibilityIssues.map((issue) => issue.message), "目标节点不支持自动布局。", "可以使用 Figma Undo 回退本轮已执行的修改。"]
    };
  }

  if (operationPlan.applyLayout && canAutoLayout(layoutTarget)) {
    try {
      const layoutModeOperation = plan.operations.find((operation) => operation.property === "layoutMode");
      if (layoutModeOperation) {
        if (retainedBackground) {
          protectRetainedBackgroundBeforeLayout(retainedBackground, () =>
            applyOperation(layoutTarget as FrameNode | ComponentNode | InstanceNode, layoutModeOperation.property, layoutModeOperation.value)
          );
        } else {
          applyOperation(layoutTarget, layoutModeOperation.property, layoutModeOperation.value);
        }
        appliedChanges.push(`自动布局:${layoutModeOperation.property}`);
      }
      for (const operation of plan.operations) {
        if (operation === layoutModeOperation) continue;
        applyOperation(layoutTarget, operation.property, operation.value);
        appliedChanges.push(`自动布局:${operation.property}`);
      }
      messages.push("已恢复自动布局方向、Padding、Gap 和安全尺寸模式。");
    } catch (error) {
      return failedStep("自动布局恢复", error);
    }
  } else if (operationPlan.needsReview) {
    messages.push(...plan.warnings, "已跳过高风险布局修复；安全外观和 Component 操作仍独立执行。");
  }

  if (canApplyAppearance(layoutTarget) && hasRecoverableAppearance(source) && !promotedBackground) {
    const appearanceChanges = applyAppearance(source, layoutTarget, "preview");
    if (appearanceChanges.length) {
      try {
        messages.push(...applyAppearance(source, layoutTarget, "apply"));
        appliedChanges.push("外观恢复");
      } catch (error) {
        return failedStep("外观恢复", error);
      }
    }
  }
  if (!componentSafe && initialComponentDecision.message) {
    messages.push(initialComponentDecision.message);
  }
  writePluginMigrationId(layoutTarget, source.migrationId);
  const reviewMessages = [
    ...(operationPlan.needsReview ? plan.warnings : []),
    ...compatibilityIssues.map((issue) => issue.message),
    ...componentMessages
  ];
  const needsReview = operationPlan.needsReview || reviewMessages.length > 0 || Boolean(operationPlan.applyComponent && !finalComponentDecision.eligible);
  return {
    migrationId: source.migrationId,
    nodeName: source.name,
    status: needsReview ? "partial" : appliedChanges.length ? "modified" : "verified",
    figmaNodeId: layoutTarget.id,
    plannedChanges,
    appliedChanges,
    messages: [...messages, ...reviewMessages]
  };
}

function runFromJson(json: string, mode: RunMode): RepairItem[] {
  const input = JSON.parse(json) as Record<string, unknown>;
  if ("checkedNodeCount" in input && !("nodes" in input)) {
    throw new Error("你选择的是 capability-report.json（能力检测报告）。请改选 Pixso 导出的 migration-map.json。");
  }
  const map = validateMigrationMap(input);
  if (requiresLaunchSelection(map.exportScope) && !launchedWithSelection) {
    throw new Error("此迁移数据来自选择或画板范围。请关闭插件，先选中对应的 Figma 画板，再重新运行；已阻止扩大为整页扫描。");
  }
  const launchSelection = launchSelectionIds.flatMap((id) => {
    const node = figma.getNodeById(id);
    return node && "visible" in node ? [node as SceneNode] : [];
  });
  if (launchedWithSelection && launchSelection.length !== launchSelectionIds.length) {
    throw new Error("启动时选择的画板已被删除或替换。请关闭插件，重新选择画板后再运行，已阻止扩大为整页扫描。");
  }
  const scopeRoot = launchSelection.length
    ? ({ children: launchSelection } as unknown as BaseNode & ChildrenMixin)
    : figma.currentPage;
  const candidates = collectCandidates(scopeRoot);
  const normalized = normalizeFlattenedRoot(map.nodes, candidates);
  const matches = matchNodes(normalized.nodes, normalized.candidates);
  const sourceById = new Map(normalized.nodes.map((node) => [node.migrationId, node]));
  const matchBySourceId = new Map(matches.map((match) => [match.migrationId, match]));
  const sourceRectCoordinates = normalized.flattenedRoot ? "absolute" : "local";
  const results: RepairItem[] = [];

  if (normalized.flattenedRoot) {
    results.push({
      migrationId: normalized.flattenedRoot.migrationId,
      nodeName: normalized.flattenedRoot.name,
      status: "verified",
      plannedChanges: [],
      appliedChanges: [],
      messages: ["Sketch 已将最外层画板展平；原始绝对坐标仅用于匹配，展平场景暂不自动写回局部坐标。"]
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
        plannedChanges: [],
        appliedChanges: [],
        messages: [
          `节点${matchStatusLabels[match.status]}（匹配分数 ${match.score.toFixed(2)}），依据：${match.reasons.map((reason) => reasonLabels[reason] ?? reason).join("、") || "无"}。`
        ]
      });
      continue;
    }
    const figmaNode = figma.getNodeById(match.candidateId);
    if (!figmaNode || !("type" in figmaNode)) {
      results.push({
        migrationId: source.migrationId,
        nodeName: source.name,
        status: "failed",
        plannedChanges: [],
        appliedChanges: [],
        messages: ["匹配到的节点已不存在。"]
      });
      continue;
    }
    try {
      const sourceChildren = source.childMigrationIds.flatMap((id) => {
        const child = sourceById.get(id);
        return child ? [child] : [];
      });
      const sceneNode = figmaNode as SceneNode;
      const sourceParent = source.parentMigrationId ? sourceById.get(source.parentMigrationId) : undefined;
      const parentMatch = sourceParent ? matchBySourceId.get(sourceParent.migrationId) : undefined;
      const geometryPlan = createSafeGeometryRestorePlan(source, sourceParent, match, localRect(sceneNode), {
        parentCandidateMatched: Boolean(parentMatch?.candidateId && sceneNode.parent?.id === parentMatch.candidateId),
        coordinates: sourceRectCoordinates,
        canResizeRoot: canResizeWithoutConstraints(sceneNode)
      });
      results.push(repairNode(source, sceneNode, sourceChildren, sourceRectCoordinates, match, mode, geometryPlan));
    } catch (error) {
      console.error(`修复节点失败：${source.name} (${source.migrationId})`, error);
      results.push({
        migrationId: source.migrationId,
        nodeName: source.name,
        status: "failed",
        figmaNodeId: figmaNode.id,
        plannedChanges: [],
        appliedChanges: [],
        messages: [`修复执行失败：${describeError(error)}`, "可以使用 Figma Undo 回退本轮已执行的修改。"]
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
