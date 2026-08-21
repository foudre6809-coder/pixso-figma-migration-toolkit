export type LayoutCorrespondenceStatus =
  | "exact-match"
  | "equivalent"
  | "normalized"
  | "lost"
  | "unsupported"
  | "unverified";

export interface LayoutFieldObservation {
  observed: boolean;
  value: unknown;
}

export interface LayoutFieldComparison {
  figma: LayoutFieldObservation;
  pixso: LayoutFieldObservation & { apiSupported: boolean };
  equivalent?: boolean;
  normalized?: boolean;
}

export function compareLayoutField(input: LayoutFieldComparison): LayoutCorrespondenceStatus {
  if (!input.figma.observed) return "unverified";
  if (!input.pixso.apiSupported) return "unsupported";
  if (!input.pixso.observed) return "lost";
  if (Object.is(input.figma.value, input.pixso.value)) return "exact-match";
  if (input.equivalent) return "equivalent";
  if (input.normalized) return "normalized";
  return "lost";
}
