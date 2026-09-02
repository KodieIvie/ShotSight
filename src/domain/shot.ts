import {
  distanceBetween,
  isFinitePoint,
  type IsoTimestamp,
  type PixelPoint,
} from "./common";

export type ShotSource = "automatic" | "manual";

/** A confirmed impact. Candidates remain separate analysis objects. */
export interface Shot {
  readonly id: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly captureId?: string;
  /** Immutable, monotonically increasing within the supplied shot sequence. */
  readonly number: number;
  /** Registered, full-resolution target coordinates. */
  readonly position: PixelPoint;
  readonly confirmedAt: IsoTimestamp;
  readonly baselineRevision: number;
  readonly source: ShotSource;
  readonly confidence?: number;
  readonly caliberDiameterInches?: number;
  readonly note?: string;
  readonly isColdBore: boolean;
  /** Global default; a group membership can independently exclude a shot. */
  readonly isFlyer: boolean;
}

export interface ConfirmShotInput {
  readonly id: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly captureId?: string;
  readonly position: PixelPoint;
  readonly confirmedAt: IsoTimestamp;
  readonly baselineRevision: number;
  readonly source: ShotSource;
  readonly confidence?: number;
  readonly caliberDiameterInches?: number;
  readonly note?: string;
  /** Defaults to true only for shot #1. */
  readonly isColdBore?: boolean;
  readonly isFlyer?: boolean;
}

export interface ConfirmedShotResult {
  readonly shot: Shot;
  readonly shots: readonly Shot[];
}

function assertValidShotNumber(number: number): void {
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError("Shot numbers must be positive integers");
  }
}

/** Uses max+1 so deleting a shot never silently renumbers later shots. */
export function nextShotNumber(
  shots: readonly Pick<Shot, "number">[],
): number {
  const numbers = new Set<number>();
  let maximum = 0;
  for (const shot of shots) {
    assertValidShotNumber(shot.number);
    if (numbers.has(shot.number)) {
      throw new RangeError(`Duplicate shot number: ${shot.number}`);
    }
    numbers.add(shot.number);
    maximum = Math.max(maximum, shot.number);
  }
  return maximum + 1;
}

function validateConfirmShotInput(input: ConfirmShotInput): void {
  if (!input.id.trim() || !input.sessionId.trim() || !input.targetId.trim()) {
    throw new RangeError("Shot id, sessionId, and targetId are required");
  }
  if (!isFinitePoint(input.position)) {
    throw new RangeError("Shot position must be finite");
  }
  if (!Number.isInteger(input.baselineRevision) || input.baselineRevision < 1) {
    throw new RangeError("baselineRevision must be a positive integer");
  }
  if (
    input.confidence !== undefined &&
    (!Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1)
  ) {
    throw new RangeError("confidence must be between zero and one");
  }
  if (
    input.caliberDiameterInches !== undefined &&
    (!Number.isFinite(input.caliberDiameterInches) ||
      input.caliberDiameterInches <= 0)
  ) {
    throw new RangeError("caliberDiameterInches must be positive");
  }
}

/** Confirms and appends a shot without mutating or renumbering existing shots. */
export function appendConfirmedShot(
  existing: readonly Shot[],
  input: ConfirmShotInput,
): ConfirmedShotResult {
  validateConfirmShotInput(input);
  if (existing.some((shot) => shot.id === input.id)) {
    throw new RangeError(`Duplicate shot id: ${input.id}`);
  }

  const number = nextShotNumber(existing);
  const shot: Shot = Object.freeze({
    ...input,
    number,
    position: Object.freeze({ ...input.position }),
    isColdBore: input.isColdBore ?? number === 1,
    isFlyer: input.isFlyer ?? false,
  });
  return Object.freeze({
    shot,
    shots: Object.freeze([...existing, shot]),
  });
}

export function setShotFlyer(
  shots: readonly Shot[],
  shotId: string,
  isFlyer: boolean,
): readonly Shot[] {
  let found = false;
  const updated = shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    found = true;
    return Object.freeze({ ...shot, isFlyer });
  });
  if (!found) throw new RangeError(`Unknown shot id: ${shotId}`);
  return Object.freeze(updated);
}

/** Assigns zero or one cold-bore shot while preserving shot numbers. */
export function setColdBoreShot(
  shots: readonly Shot[],
  shotId: string | undefined,
): readonly Shot[] {
  if (shotId !== undefined && !shots.some((shot) => shot.id === shotId)) {
    throw new RangeError(`Unknown shot id: ${shotId}`);
  }
  return Object.freeze(
    shots.map((shot) =>
      shot.isColdBore === (shot.id === shotId)
        ? shot
        : Object.freeze({ ...shot, isColdBore: shot.id === shotId }),
    ),
  );
}

export interface ShotGroupMembership {
  readonly shotId: string;
  readonly excludeFromStatistics: boolean;
}

export interface ShotGroup {
  readonly id: string;
  readonly sessionId: string;
  readonly targetId: string;
  /** Examples: Load A, Load B, Cold Bore. */
  readonly label: string;
  readonly color?: string;
  readonly members: readonly ShotGroupMembership[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export function shotsIncludedInGroup(
  group: ShotGroup,
  shots: readonly Shot[],
  includeFlyers = false,
): readonly Shot[] {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const seen = new Set<string>();
  const selected: Shot[] = [];
  for (const member of group.members) {
    if (seen.has(member.shotId)) {
      throw new RangeError(`Duplicate group member: ${member.shotId}`);
    }
    seen.add(member.shotId);
    const shot = byId.get(member.shotId);
    if (!shot) throw new RangeError(`Unknown group shot id: ${member.shotId}`);
    if (
      includeFlyers ||
      (!shot.isFlyer && !member.excludeFromStatistics)
    ) {
      selected.push(shot);
    }
  }
  return Object.freeze(selected);
}

export interface LocatedCandidate {
  readonly id: string;
  readonly position: PixelPoint;
  readonly confidence?: number;
}

export interface KnownShotLocation {
  readonly id: string;
  readonly position: PixelPoint;
}

export interface DuplicateCandidate<TCandidate extends LocatedCandidate> {
  readonly candidate: TCandidate;
  readonly distancePixels: number;
  readonly matchedKnownShotId?: string;
  readonly matchedCandidateId?: string;
}

export interface ShotDeduplicationResult<TCandidate extends LocatedCandidate> {
  readonly accepted: readonly TCandidate[];
  readonly duplicates: readonly DuplicateCandidate<TCandidate>[];
}

interface IndexedCandidate<TCandidate> {
  readonly candidate: TCandidate;
  readonly index: number;
}

/**
 * Removes candidates already represented by known shots, then clusters new
 * candidates within the same radius. The highest-confidence candidate wins;
 * ties retain detection order. Inputs and accepted candidates are not mutated.
 */
export function deduplicateShotCandidates<TCandidate extends LocatedCandidate>(
  candidates: readonly TCandidate[],
  knownShots: readonly KnownShotLocation[],
  radiusPixels: number,
): ShotDeduplicationResult<TCandidate> {
  if (!Number.isFinite(radiusPixels) || radiusPixels < 0) {
    throw new RangeError("radiusPixels must be a non-negative finite number");
  }
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidateIds.has(candidate.id)) {
      throw new RangeError(`Duplicate candidate id: ${candidate.id}`);
    }
    candidateIds.add(candidate.id);
    if (!isFinitePoint(candidate.position)) {
      throw new RangeError(`Candidate ${candidate.id} has a non-finite position`);
    }
  }

  const duplicates: DuplicateCandidate<TCandidate>[] = [];
  const unmatched: IndexedCandidate<TCandidate>[] = [];
  candidates.forEach((candidate, index) => {
    let nearest: KnownShotLocation | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const shot of knownShots) {
      const distance = distanceBetween(candidate.position, shot.position);
      if (distance < nearestDistance) {
        nearest = shot;
        nearestDistance = distance;
      }
    }
    if (nearest && nearestDistance <= radiusPixels) {
      duplicates.push({
        candidate,
        distancePixels: nearestDistance,
        matchedKnownShotId: nearest.id,
      });
    } else {
      unmatched.push({ candidate, index });
    }
  });

  const ranked = [...unmatched].sort((left, right) => {
    const scoreDifference =
      (right.candidate.confidence ?? 0) - (left.candidate.confidence ?? 0);
    return scoreDifference || left.index - right.index;
  });
  const acceptedRanked: IndexedCandidate<TCandidate>[] = [];
  for (const entry of ranked) {
    let nearestAccepted: IndexedCandidate<TCandidate> | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const accepted of acceptedRanked) {
      const distance = distanceBetween(
        entry.candidate.position,
        accepted.candidate.position,
      );
      if (distance < nearestDistance) {
        nearestAccepted = accepted;
        nearestDistance = distance;
      }
    }
    if (nearestAccepted && nearestDistance <= radiusPixels) {
      duplicates.push({
        candidate: entry.candidate,
        distancePixels: nearestDistance,
        matchedCandidateId: nearestAccepted.candidate.id,
      });
    } else {
      acceptedRanked.push(entry);
    }
  }

  const accepted = acceptedRanked
    .sort((left, right) => left.index - right.index)
    .map(({ candidate }) => candidate);
  const inputOrder = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  duplicates.sort(
    (left, right) =>
      (inputOrder.get(left.candidate.id) ?? 0) -
      (inputOrder.get(right.candidate.id) ?? 0),
  );
  return Object.freeze({
    accepted: Object.freeze(accepted),
    duplicates: Object.freeze(
      duplicates.map((duplicate) => Object.freeze(duplicate)),
    ),
  });
}

