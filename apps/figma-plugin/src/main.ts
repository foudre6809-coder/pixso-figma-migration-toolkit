import {
  classifyApplyFailureStatus,
  classifyPreviewStatus,
  classifyBackgroundRectangle,
  createLayoutPlan,
  createOperationExecutionPlan,
  createRepairSafetyPolicy,
  assessStructureMatch,
  type RepairSafetyLevel,
  type StructureMatchAssessment,
  protectRetainedBackgroundBeforeLayout,
  requiresLaunchSelection
} from "@pixso-figma-migration/layout-engine";
import { type MigrationNode, validateMigrationMap } from "@pixso-figma-migration/migration-schema";
import {
  assessRecoveryCompatibility,
  canSafelyRebuildMainComponent,
  createSafeGeometryRestorePlan,
  isHighConfidenceUniqueMatch,
  type GeometryRestorePlan,
  type MatchResult,
  type MatchCandidate,
  matchNodes,
  normalizeFlattenedRoot
} from "@pixso-figma-migration/node-matcher";

declare const __html__: string;

type RepairStatus = "modified" | "verified" | "partial" | "failed";
type RunMode = "preview" | "apply";

interface RunOptions {
  safetyLevel: RepairSafetyLevel;
  experimentalGeometry: boolean;
}

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
  const strokeComplete =
    !appearance.strokeSummary ||
    (appearance.strokeSummary.source === "native" && appearance.strokeSummary.value?.completeSingleSolid === true);
  if (appearance.stroke.value && strokeComplete) {
    const strokes: ReadonlyArray<Paint> = [
      { type: "SOLID", color: appearance.stroke.value.color, opacity: appearance.stroke.value.opacity }
    ];
    if (!paintsEqual(node.strokes, strokes)) {
      if (mode === "apply") node.strokes = strokes;
      messages.push("已恢复描边。");
    }
  }
  if (
    appearance.stroke.value && strokeComplete &&
    typeof appearance.strokeWeight.value === "number" &&
    node.strokeWeight !== appearance.strokeWeight.value
  ) {
    if (mode === "apply") node.strokeWeight = appearance.strokeWeight.value;
    messages.push("已恢复描边粗细。");
  }
  if (appearance.stroke.value && strokeComplete && appearance.strokeAlign.value && node.strokeAlign !== appearance.strokeAlign.value) {
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
  const strokeComplete =
    !source.appearance.strokeSummary ||
    (source.appearance.strokeSummary.source === "native" &&
      source.appearance.strokeSummary.value?.completeSingleSolid === true);
  return Boolean(source.appearance.fill.value || (source.appearance.stroke.value && strokeComplete));
}

function strokeDiagnosticMessages(source: MigrationNode): string[] {
  const summary = source.appearance.strokeSummary;
  if (!summary || summary.source === "unavailable") {
    return source.riskFlags.includes("stroke-data-unavailable")
      ? ["Pixso 描边数据不可用，无法确认外观完整性；本节点不能视为无需修改。"]
      : [];
  }
  if (summary.value && summary.value.count > 0 && !summary.value.completeSingleSolid) {
    const value = summary.value;
    return [
      `描边包含 ${value.count} 层 Paint（${value.paintTypes.join("、") || "类型未知"}），样式=${value.styleName ?? value.styleId ?? "无"}，渐变=${value.hasGradient ? "是" : "否"}，变量引用=${value.hasVariableReference ? "是" : "否"}；为避免覆盖现有描边，本轮仅报告。`
    ];
  }
  return [];
}

function structureDetails(assessment: StructureMatchAssessment): string {
  return [
    `源子节点 ${assessment.sourceChildCount}`,
    `目标子节点 ${assessment.targetChildCount}`,
    `已匹配 ${assessment.matchedChildCount}`,
    `匹配率 ${(assessment.matchedRatio * 100).toFixed(0)}%`,
    `顺序一致率 ${(assessment.orderConsistency * 100).toFixed(0)}%`,
    `Mask=${assessment.hasMask ? "有" : "无"}`,
    `重叠=${assessment.hasOverlap ? "有" : "无"}`,
    `未知绝对定位=${assessment.hasUnknownAbsolute ? "有" : "无"}`,
    `尺寸阈值=${assessment.sizeWithinTolerance ? "通过" : "未通过"}`
  ].join("，");
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
  match: MatchResult,
  mode: RunMode,
  options: RunOptions,
  structure: StructureMatchAssessment,
  geometryPlan?: GeometryRestorePlan,
  appearanceOwner?: { source: MigrationNode; target: SceneNode; warning?: string }
): RepairItem {
  const policy = createRepairSafetyPolicy(options.safetyLevel, options.experimentalGeometry);
  const plan = createLayoutPlan(source, { children: sourceChildren });
  const compatibilityIssues = assessRecoveryCompatibility(source, {
    type: typeOf(figmaNode),
    rect: localRect(figmaNode),
    textCharacters: figmaNode.type === "TEXT" ? figmaNode.characters : undefined,
    mainComponentName: figmaNode.type === "INSTANCE" ? figmaNode.mainComponent?.name : undefined,
    hasImageFill: hasImageFill(figmaNode)
  });
  if (policy.applyGeometry && typeof geometryPlan?.width === "number" && typeof geometryPlan.height === "number") {
    const staleSizeWarning = compatibilityIssues.findIndex((issue) => issue.code === "size-mismatch");
    if (staleSizeWarning >= 0) compatibilityIssues.splice(staleSizeWarning, 1);
  }
  const componentMessages = componentInformation(source, figmaNode);
  const initialComponentDecision = componentRebuildDecision(source, figmaNode, match);
  const componentAfterConversion = policy.convertGroup && structure.eligibleForGroupConversion && canRebuildComponentAfterGroupConversion(source, figmaNode, match);
  const componentSafe = policy.rebuildComponent && (initialComponentDecision.eligible || componentAfterConversion);
  if (componentSafe) {
    const lostLinkWarning = compatibilityIssues.findIndex((issue) => issue.code === "component-link-lost");
    if (lostLinkWarning >= 0) compatibilityIssues.splice(lostLinkWarning, 1);
  }
  const appearanceSource = appearanceOwner?.source ?? source;
  const appearanceTarget = appearanceOwner?.target ?? figmaNode;
  const appearancePreview =
    policy.applyAppearance && hasRecoverableAppearance(appearanceSource) && canApplyAppearance(appearanceTarget)
      ? applyAppearance(appearanceSource, appearanceTarget, "preview")
      : [];
  const operationPlan = createOperationExecutionPlan({
    layoutRequested: policy.applyLayout && plan.shouldApply && structure.eligibleForAutoLayout,
    layoutRisk: plan.riskLevel === "high" || !structure.eligibleForAutoLayout ? "high" : "low",
    appearanceSafe: appearancePreview.length > 0,
    componentSafe
  });
  const structuralSkipped = policy.applyLayout && plan.shouldApply && !structure.eligibleForAutoLayout;
  const migrationIdChange = policy.writeMigrationId && readPluginMigrationId(figmaNode) !== source.migrationId;
  const plannedChanges = [
    ...(migrationIdChange ? ["写入迁移标识"] : []),
    ...(policy.applyGeometry && geometryPlan ? ["实验性恢复坐标或尺寸"] : []),
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
    ...(geometryPlan && !policy.applyGeometry ? ["检测到几何差异；当前安全等级仅报告，不写入坐标或尺寸。"] : []),
    ...(policy.applyGeometry && geometryPlan ? applyGeometryRestorePlan(figmaNode, geometryPlan, "preview") : []),
    ...(operationPlan.applyLayout ? ["预览：将恢复安全的自动布局属性。"] : []),
    ...appearancePreview.map((message) => `预览：将${message.replace(/^已/, "")}`),
    ...(operationPlan.applyComponent ? ["预览：将重建唯一高置信主 Component。"] : []),
    ...(operationPlan.needsReview ? ["布局风险较高：本轮只跳过布局，仍会独立执行安全外观和 Component 操作。"] : []),
    ...(!componentSafe && initialComponentDecision.message ? [initialComponentDecision.message] : []),
    ...plan.warnings,
    ...compatibilityIssues.map((issue) => issue.message),
    ...componentMessages,
    `结构匹配详情：${structureDetails(structure)}。`,
    ...(structuralSkipped ? [`结构修复已跳过：${structure.reasons.join("；") || "未达到安全门槛"}。`] : []),
    ...(appearanceOwner?.warning ? [appearanceOwner.warning] : []),
    ...strokeDiagnosticMessages(appearanceSource)
  ];
  if (mode === "preview") {
    const needsReview =
      operationPlan.needsReview ||
      plan.warnings.length > 0 ||
      compatibilityIssues.length > 0 ||
      structuralSkipped ||
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
    const wroteMigrationId = mode === "apply" && migrationIdChange;
    if (wroteMigrationId) writePluginMigrationId(figmaNode, source.migrationId);
    const diagnostics = [...strokeDiagnosticMessages(appearanceSource), ...(appearanceOwner?.warning ? [appearanceOwner.warning] : [])];
    return {
      migrationId: source.migrationId,
      nodeName: source.name,
      status:
        compatibilityIssues.length || Boolean(initialComponentDecision.message) || diagnostics.length
          ? "partial"
          : wroteMigrationId
            ? "modified"
            : "verified",
      figmaNodeId: figmaNode.id,
      plannedChanges,
      appliedChanges: wroteMigrationId ? ["迁移标识"] : [],
      messages: [
        ...compatibilityIssues.map((issue) => issue.message),
        ...(initialComponentDecision.message ? [initialComponentDecision.message] : []),
        ...componentMessages,
        ...diagnostics,
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

  if (policy.applyGeometry && geometryPlan) {
    try {
      messages.push(...applyGeometryRestorePlan(layoutTarget, geometryPlan, "apply"));
      appliedChanges.push("坐标或尺寸恢复");
    } catch (error) {
      return failedStep("坐标或尺寸恢复", error);
    }
  }

  const needsGroupConversion =
    policy.convertGroup &&
    structure.eligibleForGroupConversion &&
    source.type === "FRAME" &&
    figmaNode.type === "GROUP" &&
    (operationPlan.applyLayout || operationPlan.applyComponent);
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

  const finalAppearanceTarget = appearanceTarget === figmaNode ? layoutTarget : appearanceTarget;
  if (policy.applyAppearance && canApplyAppearance(finalAppearanceTarget) && hasRecoverableAppearance(appearanceSource) && !promotedBackground) {
    const appearanceChanges = applyAppearance(appearanceSource, finalAppearanceTarget, "preview");
    if (appearanceChanges.length) {
      try {
        messages.push(...applyAppearance(appearanceSource, finalAppearanceTarget, "apply"));
        appliedChanges.push("外观恢复");
      } catch (error) {
        return failedStep("外观恢复", error);
      }
    }
  }
  if (!componentSafe && initialComponentDecision.message) {
    messages.push(initialComponentDecision.message);
  }
  if (policy.writeMigrationId && readPluginMigrationId(layoutTarget) !== source.migrationId) {
    writePluginMigrationId(layoutTarget, source.migrationId);
    appliedChanges.push("迁移标识");
  }
  const reviewMessages = [
    ...(operationPlan.needsReview ? plan.warnings : []),
    ...compatibilityIssues.map((issue) => issue.message),
    ...componentMessages,
    ...(appearanceOwner?.warning ? [appearanceOwner.warning] : []),
    ...strokeDiagnosticMessages(appearanceSource)
  ];
  const needsReview =
    operationPlan.needsReview ||
    structuralSkipped ||
    reviewMessages.length > 0 ||
    Boolean(operationPlan.applyComponent && !finalComponentDecision.eligible);
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

function directSceneChildren(node: SceneNode): SceneNode[] {
  return "children" in node ? node.children.filter((child): child is SceneNode => "visible" in child) : [];
}

function orderConsistency(indices: number[]): number {
  if (indices.length < 2) return 1;
  let orderedPairs = 0;
  for (let index = 1; index < indices.length; index += 1) {
    if (indices[index - 1]! < indices[index]!) orderedPairs += 1;
  }
  return orderedPairs / (indices.length - 1);
}

function createStructureAssessment(
  source: MigrationNode,
  sourceChildren: MigrationNode[],
  target: SceneNode,
  match: MatchResult,
  matchBySourceId: Map<string, MatchResult>,
  geometryPlan?: GeometryRestorePlan
): StructureMatchAssessment {
  const targetChildren = directSceneChildren(target);
  const targetIndexById = new Map(targetChildren.map((child, index) => [child.id, index]));
  const matchedIndices = sourceChildren.flatMap((child) => {
    const childMatch = matchBySourceId.get(child.migrationId);
    const index = childMatch?.candidateId ? targetIndexById.get(childMatch.candidateId) : undefined;
    return index === undefined ? [] : [index];
  });
  const sourceRect = source.rect.value;
  const targetRect = localRect(target);
  const hasMask =
    sourceChildren.some((child) => child.riskFlags.includes("mask")) ||
    targetChildren.some((child) => "isMask" in child && child.isMask);
  const hasBooleanDependency =
    sourceChildren.some((child) => child.type === "BOOLEAN") || targetChildren.some((child) => child.type === "BOOLEAN_OPERATION");
  const hasRotation = "rotation" in target && Math.abs(target.rotation) > 0.01;
  const hasComplexTransform = hasRotation;
  const hasUnknownAbsolute = sourceChildren.some((child) => child.layout.positioning.source === "unavailable");
  const layoutProbe = createLayoutPlan(source, { children: sourceChildren });
  const hasOverlap = layoutProbe.riskLevel === "high" && layoutProbe.warnings.some((warning) => warning.includes("重叠"));
  return assessStructureMatch({
    parentMatchHighConfidence: isHighConfidenceUniqueMatch(match),
    sourceChildCount: sourceChildren.length,
    targetChildCount: targetChildren.length,
    matchedChildCount: matchedIndices.length,
    orderConsistency: orderConsistency(matchedIndices),
    hasMask,
    hasBooleanDependency,
    hasRotation,
    hasComplexTransform,
    hasUnknownAbsolute,
    hasOverlap,
    sourceWidth: sourceRect?.width,
    sourceHeight: sourceRect?.height,
    targetWidth: targetRect?.width,
    targetHeight: targetRect?.height,
    geometryWriteRequired: Boolean(geometryPlan),
    externalBoundsStable: !geometryPlan
  });
}

function resolveAppearanceOwner(
  source: MigrationNode,
  defaultTarget: SceneNode,
  sourceById: Map<string, MigrationNode>,
  matchBySourceId: Map<string, MatchResult>
): { source: MigrationNode; target: SceneNode; warning?: string } {
  if (!source.appearanceOwnerReason || source.appearanceOwnerReason === "self") {
    return { source, target: defaultTarget };
  }
  if (source.appearanceOwnerReason !== "full-size-background" || !source.appearanceOwnerMigrationId) {
    return {
      source,
      target: defaultTarget,
      warning: "未定位输入框视觉承载节点；为避免写错外层，本轮不提升或猜测背景外观。"
    };
  }
  const ownerSource = sourceById.get(source.appearanceOwnerMigrationId);
  const ownerMatch = matchBySourceId.get(source.appearanceOwnerMigrationId);
  const ownerNode = ownerMatch?.candidateId ? figma.getNodeById(ownerMatch.candidateId) : undefined;
  if (!ownerSource || !ownerMatch || !isHighConfidenceUniqueMatch(ownerMatch) || !ownerNode || !("visible" in ownerNode)) {
    return {
      source,
      target: defaultTarget,
      warning: "全尺寸背景视觉承载节点未达到唯一高置信匹配，已跳过外观提升。"
    };
  }
  const sceneOwner = ownerNode as SceneNode;
  if (sceneOwner.parent?.id !== defaultTarget.id) {
    return {
      source,
      target: defaultTarget,
      warning: "背景候选不再是目标节点的直接子节点，已跳过外观恢复。"
    };
  }
  return { source: ownerSource, target: sceneOwner };
}

function runFromJson(json: string, mode: RunMode, options: RunOptions): RepairItem[] {
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
      const structure = createStructureAssessment(source, sourceChildren, sceneNode, match, matchBySourceId, geometryPlan);
      const appearanceOwner = resolveAppearanceOwner(source, sceneNode, sourceById, matchBySourceId);
      results.push(repairNode(source, sceneNode, sourceChildren, match, mode, options, structure, geometryPlan, appearanceOwner));
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

figma.ui.onmessage = (message: {
  type: string;
  json?: string;
  nodeId?: string;
  safetyLevel?: RepairSafetyLevel;
  experimentalGeometry?: boolean;
}) => {
  if ((message.type === "preview" || message.type === "repair") && message.json) {
    try {
      const mode: RunMode = message.type === "preview" ? "preview" : "apply";
      const options: RunOptions = {
        safetyLevel: message.safetyLevel ?? (mode === "preview" ? "diagnostic" : "conservative"),
        experimentalGeometry: message.experimentalGeometry === true
      };
      const results = runFromJson(message.json, mode, options);
      figma.ui.postMessage({ type: "results", results, mode, safetyLevel: options.safetyLevel });
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
