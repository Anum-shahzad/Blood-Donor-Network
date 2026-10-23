// Unit accounting for blood requests — the single place that defines how many
// units a request still needs.
//
//   required   = requests.units_needed
//   donated    = SUM(confirmed_units) of responses with status 'donated'
//   committed  = SUM(committed_units) of responses with status 'accepted' or
//                'claimed' (promised, or claimed and awaiting the requester's
//                confirmation — NOT donated, never counted as donated until
//                the requester confirms; the units stay held meanwhile)
//   remaining  = required - donated          (what is still outstanding)
//   open       = remaining - committed       (what a new donor may still take)
//
// A cancelled / failed / declined response is in none of the sums, so its
// units become available again automatically.

// Select-list fragment; the request table must be aliased `r`.
export const UNIT_PROGRESS_COLUMNS_SQL = `
  COALESCE((SELECT SUM(rr.confirmed_units) FROM request_responses rr
             WHERE rr.request_id = r.id AND rr.status = 'donated'), 0) AS units_donated,
  COALESCE((SELECT SUM(rr.committed_units) FROM request_responses rr
             WHERE rr.request_id = r.id AND rr.status IN ('accepted', 'claimed')), 0) AS units_committed`;

// WHERE fragment: the request still has units nobody has donated or promised.
export const OPEN_UNITS_CONDITION_SQL = `
  r.units_needed > (
    SELECT COALESCE(SUM(CASE WHEN rr.status = 'donated' THEN rr.confirmed_units
                             WHEN rr.status IN ('accepted', 'claimed') THEN rr.committed_units
                             ELSE 0 END), 0)
      FROM request_responses rr WHERE rr.request_id = r.id)`;

export function computeUnitProgress({ units_needed, units_donated = 0, units_committed = 0 }) {
  const required = Number(units_needed) || 0;
  const donated = Number(units_donated) || 0;
  const committed = Number(units_committed) || 0;
  const remaining = Math.max(0, required - donated);
  const open = Math.max(0, remaining - committed);
  return { required, donated, committed, remaining, open };
}

// Adds the unit fields to a request row selected with UNIT_PROGRESS_COLUMNS_SQL.
export function withUnitProgress(row) {
  if (!row) return row;
  const p = computeUnitProgress(row);
  return {
    ...row,
    units_required: p.required,
    units_donated: p.donated,
    units_committed: p.committed,
    units_remaining: p.remaining,
    units_open: p.open,
  };
}

// Reads the totals on a connection that already holds the request row lock,
// so the numbers cannot change underneath the decision being made.
export async function loadUnitProgress(conn, requestId, unitsNeeded) {
  const [rows] = await conn.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'donated' THEN confirmed_units ELSE 0 END), 0) AS units_donated,
       COALESCE(SUM(CASE WHEN status IN ('accepted', 'claimed') THEN committed_units ELSE 0 END), 0) AS units_committed
     FROM request_responses WHERE request_id = ?`,
    [requestId]
  );
  return computeUnitProgress({
    units_needed: unitsNeeded,
    units_donated: rows[0]?.units_donated,
    units_committed: rows[0]?.units_committed,
  });
}

// The status a live request should have for the given progress.
//   all units donated        -> fulfilled
//   some donor committed     -> donor_accepted
//   nobody committed         -> matched (open for more donors)
export function requestStatusForProgress(progress) {
  if (progress.required > 0 && progress.donated >= progress.required) return 'fulfilled';
  if (progress.committed > 0) return 'donor_accepted';
  return 'matched';
}

const SETTLEABLE_STATUSES = ['verified', 'matched', 'donor_accepted'];

// Recomputes progress under the caller's request lock and moves the request to
// the matching status. Terminal / pending requests are never rewritten.
export async function settleRequestStatus(conn, request) {
  const progress = await loadUnitProgress(conn, request.id, request.units_needed);
  if (!SETTLEABLE_STATUSES.includes(request.status)) {
    return { progress, status: request.status };
  }
  const status = requestStatusForProgress(progress);
  if (status !== request.status) {
    const [updated] = await conn.query('UPDATE requests SET status = ? WHERE id = ? AND status = ?', [
      status,
      request.id,
      request.status,
    ]);
    if (updated.affectedRows !== 1) {
      const err = new Error('Request was updated by someone else — please refresh and try again');
      err.status = 409;
      throw err;
    }
  }
  return { progress, status };
}
