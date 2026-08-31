function timestampMillis(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sessionId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function shouldAcceptDetection(
  candidate,
  previous,
  retiredSessionIds = new Set()
) {
  const candidateSession = sessionId(candidate.sessionId);
  if (candidateSession && retiredSessionIds.has(candidateSession)) return false;
  if (!previous) return true;

  const previousSession = sessionId(previous.sessionId);
  if (candidateSession && previousSession && candidateSession !== previousSession) {
    // A producer session change is the only supported sequence-reset signal.
    // The stateful tracker below retires the old session after accepting it.
    return true;
  }

  // Once the producer supplies a session, do not let an ambiguous legacy
  // event without one roll the display back. Moving from legacy events to a
  // session-aware producer is accepted as a protocol upgrade.
  if (previousSession && !candidateSession) return false;
  if (candidateSession && !previousSession) return true;

  if (
    Number.isFinite(candidate.sequence) &&
    Number.isFinite(previous.sequence)
  ) {
    return candidate.sequence > previous.sequence;
  }

  const candidateTime = timestampMillis(candidate.timestamp);
  const previousTime = timestampMillis(previous.timestamp);

  if (candidateTime !== null && previousTime !== null && candidateTime !== previousTime) {
    return candidateTime > previousTime;
  }

  // If the producer supplies no ordering metadata, retain arrival-order
  // behavior instead of discarding otherwise valid messages.
  return true;
}

export function createDetectionOrderTracker() {
  let latest = null;
  const retiredSessionIds = new Set();

  return {
    accept(candidate) {
      if (!shouldAcceptDetection(candidate, latest, retiredSessionIds)) {
        return false;
      }

      const previousSession = sessionId(latest?.sessionId);
      const candidateSession = sessionId(candidate.sessionId);
      if (
        previousSession &&
        candidateSession &&
        previousSession !== candidateSession
      ) {
        retiredSessionIds.add(previousSession);
      }

      latest = candidate;
      return true;
    },

    reset() {
      latest = null;
      retiredSessionIds.clear();
    }
  };
}
