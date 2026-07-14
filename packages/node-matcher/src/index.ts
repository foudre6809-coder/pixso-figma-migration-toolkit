import type { MigrationNode, Rect } from "@pixso-figma-migration/migration-schema";

export interface MatchCandidate {
  id: string;
  name: string;
  type: string;
  path: string[];
  rect?: Rect;
  migrationId?: string;
}

export interface MatchResult {
  migrationId: string;
  candidateId?: string;
  score: number;
  status: "matched" | "ambiguous" | "unmatched";
  reasons: string[];
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

function rectSimilarity(a?: Rect | null, b?: Rect): number {
  if (!a || !b) return 0;
  const sizeDelta = Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
  const positionDelta = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return Math.max(0, 1 - (sizeDelta + positionDelta * 0.25) / 1000);
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
  if (sourceType === "VECTOR" && candidateType === "BOOLEAN") return true;
  return false;
}

export function scoreCandidate(node: MigrationNode, candidate: MatchCandidate): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

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
  score += rectScore * 0.1;
  if (rectScore > 0.85) reasons.push("rect");

  return { score: Math.min(1, score), reasons };
}

export function matchNodes(nodes: MigrationNode[], candidates: MatchCandidate[]): MatchResult[] {
  return nodes.map((node) => {
    const ranked = candidates
      .map((candidate) => ({ candidate, ...scoreCandidate(node, candidate) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];

    if (!best || best.score < 0.45) {
      return { migrationId: node.migrationId, score: best?.score ?? 0, status: "unmatched", reasons: best?.reasons ?? [] };
    }
    if (second && best.score - second.score < 0.08) {
      return {
        migrationId: node.migrationId,
        candidateId: best.candidate.id,
        score: best.score,
        status: "ambiguous",
        reasons: best.reasons
      };
    }
    return {
      migrationId: node.migrationId,
      candidateId: best.candidate.id,
      score: best.score,
      status: "matched",
      reasons: best.reasons
    };
  });
}

export function assessRecoveryCompatibility(node: MigrationNode, candidate: RecoveryCandidate): RecoveryIssue[] {
  const issues: RecoveryIssue[] = [];

  if (node.type === "COMPONENT" && candidate.type !== "COMPONENT") {
    issues.push({ code: "component-type-mismatch", severity: "error", message: "组件匹配到了非组件节点，已跳过转换。" });
  }
  if (node.type === "INSTANCE") {
    if (candidate.type !== "INSTANCE") {
      issues.push({ code: "instance-type-mismatch", severity: "error", message: "实例匹配到了非实例节点，已跳过重新绑定。" });
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
