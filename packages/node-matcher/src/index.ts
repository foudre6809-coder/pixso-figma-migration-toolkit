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
    if (a[i] === b[i]) same += 1;
  }
  return same / length;
}

function typeCompatible(sourceType: string, candidateType: string): boolean {
  if (sourceType === candidateType) return true;
  if (sourceType === "GROUP" && candidateType === "FRAME") return true;
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
    score += 0.18;
    reasons.push("name");
  }
  if (typeCompatible(node.type, candidate.type)) {
    score += 0.12;
    reasons.push("type");
  }

  const pathScore = pathSimilarity(node.path, candidate.path);
  score += pathScore * 0.08;
  if (pathScore > 0.5) reasons.push("path");

  const rectScore = rectSimilarity(node.rect.value, candidate.rect);
  score += rectScore * 0.07;
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
      return { migrationId: node.migrationId, score: best?.score ?? 0, status: "unmatched", reasons: [] };
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
