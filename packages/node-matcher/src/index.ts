import type { MigrationNode, Rect } from "@pixso-figma-migration/migration-schema";

export interface MatchCandidate {
  id: string;
  parentId?: string;
  name: string;
  type: string;
  path: string[];
  rect?: Rect;
  absoluteRect?: Rect;
  migrationId?: string;
}

export interface MatchResult {
  migrationId: string;
  candidateId?: string;
  score: number;
  status: "matched" | "ambiguous" | "unmatched";
  reasons: string[];
}

export interface GeometryRestorePlan {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function isHighConfidenceUniqueMatch(match: MatchResult): boolean {
  if (match.status !== "matched" || !match.candidateId) return false;
  if (match.reasons.includes("migrationId")) return true;
  return (
    match.score >= 0.8 &&
    match.reasons.includes("name") &&
    match.reasons.includes("type") &&
    (match.reasons.includes("path") || match.reasons.includes("rect") || match.reasons.includes("parent"))
  );
}

export function createSafeGeometryRestorePlan(
  node: MigrationNode,
  parent: MigrationNode | undefined,
  match: MatchResult,
  candidateRect: Rect | undefined,
  options: {
    parentCandidateMatched: boolean;
    coordinates: "local" | "absolute";
    canResizeRoot: boolean;
  }
): GeometryRestorePlan | undefined {
  const sourceRect = node.rect.value;
  if (!sourceRect || !candidateRect || !isHighConfidenceUniqueMatch(match)) return undefined;

  if (!parent) {
    if (!options.canResizeRoot) return undefined;
    const widthChanged = Math.abs(sourceRect.width - candidateRect.width) > 0.5;
    const heightChanged = Math.abs(sourceRect.height - candidateRect.height) > 0.5;
    return widthChanged || heightChanged ? { width: sourceRect.width, height: sourceRect.height } : undefined;
  }

  if (options.coordinates !== "local" || !options.parentCandidateMatched || parent.layout.mode.value !== "NONE") {
    return undefined;
  }
  const xChanged = Math.abs(sourceRect.x - candidateRect.x) > 0.5;
  const yChanged = Math.abs(sourceRect.y - candidateRect.y) > 0.5;
  return xChanged || yChanged ? { x: sourceRect.x, y: sourceRect.y } : undefined;
}

export function canSafelyRebuildMainComponent(
  sourceType: string,
  candidateType: string,
  match: MatchResult,
  hasForbiddenAncestor = false
): boolean {
  return !hasForbiddenAncestor && sourceType === "COMPONENT" && candidateType === "FRAME" && isHighConfidenceUniqueMatch(match);
}

export interface RecoveryCandidate {
  type: string;
  rect?: Rect;
  textCharacters?: string;
  mainComponentName?: string;
  hasImageFill?: boolean;
}

export interface RecoveryIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface FlattenedRootNormalization {
  nodes: MigrationNode[];
  candidates: MatchCandidate[];
  flattenedRoot?: MigrationNode;
}

function rectSimilarity(a?: Rect | null, b?: Rect): number {
  if (!a || !b) return 0;
  const sizeDelta = Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
  const positionDelta = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return Math.max(0, 1 - (sizeDelta + positionDelta * 0.25) / 1000);
}

function rectDistance(a?: Rect | null, b?: Rect): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
}

function pathSimilarity(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length, 1);
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const sourceSegment = a[i].replace(/\[\d+\]$/, "");
    const candidateSegment = b[i].replace(/\[\d+\]$/, "");
    if (sourceSegment === candidateSegment) same += 1;
  }
  return same / length;
}

function hasExactPath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

function typeCompatible(sourceType: string, candidateType: string): boolean {
  if (sourceType === candidateType) return true;
  if ((sourceType === "GROUP" && candidateType === "FRAME") || (sourceType === "FRAME" && candidateType === "GROUP")) return true;
  if ((sourceType === "COMPONENT" || sourceType === "INSTANCE") && (candidateType === "GROUP" || candidateType === "FRAME")) return true;
  if (
    sourceType === "VECTOR" &&
    ["BOOLEAN", "RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "STAR", "VECTOR"].includes(candidateType)
  )
    return true;
  return false;
}

export function normalizeFlattenedRoot(
  nodes: MigrationNode[],
  candidates: MatchCandidate[]
): FlattenedRootNormalization {
  const roots = nodes.filter((node) => !node.parentMigrationId);
  if (roots.length !== 1) return { nodes, candidates };

  const root = roots[0];
  const canFlatten = (root.type === "FRAME" || root.type === "GROUP") && root.layout.mode.value === "NONE";
  const hasRootCandidate = candidates.some(
    (candidate) => candidate.path.length === 1 && candidate.name === root.name && typeCompatible(root.type, candidate.type)
  );
  if (!canFlatten || hasRootCandidate) return { nodes, candidates };

  const nodeById = new Map(nodes.map((node) => [node.migrationId, node]));
  const absoluteRectCache = new Map<string, Rect>();
  const absoluteRectOf = (node: MigrationNode): Rect | undefined => {
    const cached = absoluteRectCache.get(node.migrationId);
    if (cached) return cached;
    const rect = node.rect.value;
    if (!rect) return undefined;
    const parent = node.parentMigrationId ? nodeById.get(node.parentMigrationId) : undefined;
    const parentRect = parent ? absoluteRectOf(parent) : undefined;
    const absolute = parentRect ? { ...rect, x: parentRect.x + rect.x, y: parentRect.y + rect.y } : rect;
    absoluteRectCache.set(node.migrationId, absolute);
    return absolute;
  };
  const normalized = nodes
    .filter((node) => node.migrationId !== root.migrationId)
    .map((node) => ({
      ...node,
      parentMigrationId: node.parentMigrationId === root.migrationId ? undefined : node.parentMigrationId,
      path: node.path.slice(1),
      rect: { ...node.rect, value: absoluteRectOf(node) ?? null }
    }));

  return {
    nodes: normalized,
    candidates: candidates.map((candidate) => ({ ...candidate, rect: candidate.absoluteRect ?? candidate.rect })),
    flattenedRoot: root
  };
}

export function scoreCandidate(node: MigrationNode, candidate: MatchCandidate): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (node.type !== "UNKNOWN" && candidate.type !== "UNKNOWN" && !typeCompatible(node.type, candidate.type)) {
    return { score: 0, reasons };
  }

  if (candidate.migrationId && candidate.migrationId === node.migrationId) {
    score += 0.55;
    reasons.push("migrationId");
  }
  if (candidate.name === node.name) {
    score += 0.25;
    reasons.push("name");
  }
  if (typeCompatible(node.type, candidate.type)) {
    score += 0.15;
    reasons.push("type");
  }

  const pathScore = pathSimilarity(node.path, candidate.path);
  score += pathScore * 0.15;
  if (hasExactPath(node.path, candidate.path)) score += 0.2;
  if (pathScore > 0.5) reasons.push("path");

  const rectScore = rectSimilarity(node.rect.value, candidate.rect);
  const sourceRect = node.rect.value;
  const exactGeometry =
    sourceRect && candidate.rect
      ? Math.abs(sourceRect.x - candidate.rect.x) +
          Math.abs(sourceRect.y - candidate.rect.y) +
          Math.abs(sourceRect.width - candidate.rect.width) +
          Math.abs(sourceRect.height - candidate.rect.height) <=
        4
      : false;
  score += exactGeometry ? 0.25 : rectScore * 0.1;
  if (exactGeometry || rectScore > 0.85) reasons.push("rect");

  return { score: Math.min(1, score), reasons };
}

export function matchNodes(nodes: MigrationNode[], candidates: MatchCandidate[]): MatchResult[] {
  const pending = new Map(nodes.map((node) => [node.migrationId, node]));
  const available = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const resolved = new Map<string, MatchResult>();
  const candidateMigrationIdCounts = candidates.reduce((counts, candidate) => {
    if (candidate.migrationId) counts.set(candidate.migrationId, (counts.get(candidate.migrationId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  const rank = (node: MigrationNode) =>
    [...available.values()]
      .map((candidate) => ({ candidate, ...scoreCandidate(node, candidate) }))
      .sort((a, b) => b.score - a.score);

  while (pending.size && available.size) {
    const proposals = [...pending.values()]
      .flatMap((node) => {
        const ranked = rank(node);
        const best = ranked[0];
        const second = ranked[1];
        const margin = best ? best.score - (second?.score ?? 0) : 0;
        const duplicatedMigrationId =
          best?.candidate.migrationId === node.migrationId && (candidateMigrationIdCounts.get(node.migrationId) ?? 0) > 1;
        const confident =
          best &&
          !duplicatedMigrationId &&
          best.score >= 0.45 &&
          (best.reasons.includes("migrationId") || !second || margin >= 0.08);
        return confident ? [{ node, best, margin }] : [];
      })
      .sort((a, b) => b.best.score - a.best.score || b.margin - a.margin);

    if (!proposals.length) break;
    const claimedThisRound = new Set<string>();
    let assigned = 0;
    for (const proposal of proposals) {
      const candidateId = proposal.best.candidate.id;
      if (!pending.has(proposal.node.migrationId) || !available.has(candidateId) || claimedThisRound.has(candidateId)) continue;
      claimedThisRound.add(candidateId);
      resolved.set(proposal.node.migrationId, {
        migrationId: proposal.node.migrationId,
        candidateId,
        score: proposal.best.score,
        status: "matched",
        reasons: proposal.best.reasons
      });
      pending.delete(proposal.node.migrationId);
      available.delete(candidateId);
      assigned += 1;
    }
    if (!assigned) break;
  }

  // Sketch often changes sibling indices while keeping the parent container intact.
  // Resolve duplicate names inside an already matched parent before declaring them ambiguous.
  let hierarchyAssigned = 0;
  do {
    hierarchyAssigned = 0;
    const claimedThisRound = new Set<string>();
    for (const node of [...pending.values()].sort((left, right) => left.path.length - right.path.length)) {
      if (!node.parentMigrationId) continue;
      const parentMatch = resolved.get(node.parentMigrationId);
      if (parentMatch?.status !== "matched" || !parentMatch.candidateId) continue;
      const ranked = [...available.values()]
        .filter((candidate) => candidate.parentId === parentMatch.candidateId)
        .map((candidate) => ({ candidate, ...scoreCandidate(node, candidate) }))
        .sort((left, right) => right.score - left.score);
      const best = ranked[0];
      const second = ranked[1];
      const margin = best ? best.score - (second?.score ?? 0) : 0;
      const bestDistance = best ? rectDistance(node.rect.value, best.candidate.rect) : Number.POSITIVE_INFINITY;
      const secondDistance = second ? rectDistance(node.rect.value, second.candidate.rect) : Number.POSITIVE_INFINITY;
      const geometricallyUnique =
        bestDistance <= 200 && secondDistance - bestDistance >= Math.max(8, bestDistance * 0.25);
      const confident =
        best &&
        best.score >= 0.4 &&
        best.reasons.includes("name") &&
        best.reasons.includes("type") &&
        (!second || margin >= 0.08 || geometricallyUnique);
      if (!confident || claimedThisRound.has(best.candidate.id)) continue;
      claimedThisRound.add(best.candidate.id);
      resolved.set(node.migrationId, {
        migrationId: node.migrationId,
        candidateId: best.candidate.id,
        score: Math.min(1, best.score + 0.25),
        status: "matched",
        reasons: [...best.reasons, "parent"]
      });
      pending.delete(node.migrationId);
      available.delete(best.candidate.id);
      hierarchyAssigned += 1;
    }
  } while (hierarchyAssigned > 0 && pending.size && available.size);

  for (const node of pending.values()) {
    const ranked = rank(node);
    const best = ranked[0];
    const second = ranked[1];
    const duplicatedMigrationId =
      best?.candidate.migrationId === node.migrationId && (candidateMigrationIdCounts.get(node.migrationId) ?? 0) > 1;

    if (!best || best.score < 0.45) {
      resolved.set(node.migrationId, {
        migrationId: node.migrationId,
        score: best?.score ?? 0,
        status: "unmatched",
        reasons: best?.reasons ?? []
      });
      continue;
    }
    if (duplicatedMigrationId || (second && best.score - second.score < 0.08)) {
      resolved.set(node.migrationId, {
        migrationId: node.migrationId,
        candidateId: best.candidate.id,
        score: best.score,
        status: "ambiguous",
        reasons: best.reasons
      });
      continue;
    }
    resolved.set(node.migrationId, {
      migrationId: node.migrationId,
      candidateId: best.candidate.id,
      score: best.score,
      status: "matched",
      reasons: best.reasons
    });
  }

  return nodes.map(
    (node) =>
      resolved.get(node.migrationId) ?? {
        migrationId: node.migrationId,
        score: 0,
        status: "unmatched",
        reasons: []
      }
  );
}

export function assessRecoveryCompatibility(node: MigrationNode, candidate: RecoveryCandidate): RecoveryIssue[] {
  const issues: RecoveryIssue[] = [];

  if (node.type === "COMPONENT" && candidate.type !== "COMPONENT") {
    if (candidate.type === "GROUP" || candidate.type === "FRAME") {
      issues.push({ code: "component-link-lost", severity: "warning", message: "组件关系已在 Sketch 导入时丢失，本次仅恢复布局。" });
    } else {
      issues.push({ code: "component-type-mismatch", severity: "error", message: "组件匹配到了不兼容节点，已跳过转换。" });
    }
  }
  if (node.type === "INSTANCE") {
    if (candidate.type === "GROUP" || candidate.type === "FRAME") {
      issues.push({ code: "instance-link-lost", severity: "warning", message: "实例关系已在 Sketch 导入时丢失，本次仅恢复布局。" });
    } else if (candidate.type !== "INSTANCE") {
      issues.push({ code: "instance-type-mismatch", severity: "error", message: "实例匹配到了不兼容节点，已跳过重新绑定。" });
    } else if (node.component.instanceOf.value && candidate.mainComponentName !== node.component.instanceOf.value) {
      issues.push({ code: "instance-rebind-required", severity: "warning", message: "无法确认实例的主组件，因此未重新绑定。" });
    }
  }
  if (node.type === "TEXT" && node.text.characters.value !== null && candidate.textCharacters !== node.text.characters.value) {
    issues.push({ code: "text-content-mismatch", severity: "warning", message: "文本内容与 Pixso 导出数据不一致。" });
  }
  if (node.type === "VECTOR" && candidate.type !== "VECTOR" && candidate.type !== "BOOLEAN") {
    issues.push({ code: "vector-type-mismatch", severity: "warning", message: "矢量内容可能在 Sketch 导入过程中被展平或转换。" });
  }
  if (node.type === "IMAGE" && !candidate.hasImageFill) {
    issues.push({ code: "image-fill-missing", severity: "warning", message: "未找到预期的图片填充。" });
  }

  const sourceRect = node.rect.value;
  if (sourceRect && candidate.rect) {
    const widthDelta = Math.abs(sourceRect.width - candidate.rect.width);
    const heightDelta = Math.abs(sourceRect.height - candidate.rect.height);
    const tolerance = Math.max(2, Math.max(sourceRect.width, sourceRect.height) * 0.05);
    if (widthDelta > tolerance || heightDelta > tolerance) {
      issues.push({ code: "size-mismatch", severity: "warning", message: "导入后的尺寸差异超过 5% 或 2 像素。" });
    }
  }

  return issues;
}
