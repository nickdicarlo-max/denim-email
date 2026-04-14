/**
 * Case lifecycle: urgency decay and next-action-date computation.
 * Pure functions -- zero I/O, no Date.now(), no console.log.
 */

type ActionStatusInput = "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED";

export interface ActionDateInput {
  status: ActionStatusInput;
  dueDate: Date | null;
  eventStartTime: Date | null;
}

/**
 * Compute the earliest actionable date across all PENDING actions.
 * For each PENDING action, takes MIN(dueDate, eventStartTime).
 * Returns the earliest such date, or null if no PENDING actions have dates.
 */
export function computeNextActionDate(actions: ActionDateInput[]): Date | null {
  let earliest: Date | null = null;

  for (const action of actions) {
    if (action.status !== "PENDING") continue;

    const candidates: Date[] = [];
    if (action.dueDate) candidates.push(action.dueDate);
    if (action.eventStartTime) candidates.push(action.eventStartTime);

    for (const date of candidates) {
      if (earliest === null || date < earliest) {
        earliest = date;
      }
    }
  }

  return earliest;
}

export interface CaseDecayActionInput {
  id: string;
  status: ActionStatusInput;
  dueDate: Date | null;
  eventStartTime: Date | null;
  eventEndTime: Date | null;
}

export interface CaseDecayInput {
  caseStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  caseUrgency: string;
  actions: CaseDecayActionInput[];
  lastEmailDate: Date;
}

export interface CaseDecayResult {
  updatedUrgency: string;
  updatedStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  expiredActionIds: string[];
  nextActionDate: Date | null;
  changed: boolean;
}

/**
 * Compute urgency decay for a case based on its actions and the current time.
 * Expires PENDING actions whose dates have passed, recalculates urgency tier
 * from the nearest upcoming action, and resolves cases with no remaining actions.
 *
 * Pure function -- no I/O, no Date.now(). Takes `now` as explicit parameter.
 */
export function computeCaseDecay(input: CaseDecayInput, now: Date): CaseDecayResult {
  if (input.caseStatus === "RESOLVED") {
    return {
      updatedUrgency: input.caseUrgency,
      updatedStatus: "RESOLVED",
      expiredActionIds: [],
      nextActionDate: null,
      changed: false,
    };
  }

  const expiredActionIds: string[] = [];

  for (const action of input.actions) {
    if (action.status !== "PENDING") continue;
    const actionDate = action.eventEndTime ?? action.eventStartTime ?? action.dueDate;
    if (actionDate && actionDate < now) {
      expiredActionIds.push(action.id);
    }
  }

  const stillPending = input.actions.filter(
    (a) => a.status === "PENDING" && !expiredActionIds.includes(a.id),
  );

  const futureDates: Date[] = [];
  for (const action of stillPending) {
    if (action.dueDate && action.dueDate >= now) futureDates.push(action.dueDate);
    if (action.eventStartTime && action.eventStartTime >= now) futureDates.push(action.eventStartTime);
  }
  futureDates.sort((a, b) => a.getTime() - b.getTime());
  const nearest = futureDates[0] ?? null;

  let updatedUrgency = input.caseUrgency;
  let updatedStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED" = input.caseStatus;

  if (stillPending.length === 0 && (expiredActionIds.length > 0 || input.actions.some((a) => a.status === "DONE"))) {
    updatedUrgency = "NO_ACTION";
    updatedStatus = "RESOLVED";
  } else if (nearest) {
    const hoursUntil = (nearest.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil <= 48) updatedUrgency = "IMMINENT";
    else if (hoursUntil <= 168) updatedUrgency = "THIS_WEEK";
    else updatedUrgency = "UPCOMING";
  }

  const nextActionDate = computeNextActionDate(
    stillPending.map((a) => ({
      status: a.status,
      dueDate: a.dueDate,
      eventStartTime: a.eventStartTime,
    })),
  );

  const changed =
    updatedUrgency !== input.caseUrgency ||
    updatedStatus !== input.caseStatus ||
    expiredActionIds.length > 0;

  return { updatedUrgency, updatedStatus, expiredActionIds, nextActionDate, changed };
}
