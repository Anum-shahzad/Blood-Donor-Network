// Ranks a pre-filtered set of compatible, available donor candidates for a
// request. Blood-type compatibility is decided upstream by compatibility.js
// and the SQL query that selects candidates — this module only handles
// eligibility (3-month cooldown) and ranking among already-compatible donors.
//
// This returns potential matches, not medical guarantees. Final eligibility
// and screening always happen at the donation facility.

const DONATION_COOLDOWN_MONTHS = 3;
const RECENCY_MAX_POINTS = 50;
const CITY_MATCH_POINTS = 30;
const VERIFIED_POINTS = 20;

function monthsSince(dateStr) {
  if (!dateStr) return null;
  const donated = new Date(dateStr);
  const now = new Date();
  return (now - donated) / (1000 * 60 * 60 * 24 * 30);
}

function isEligibleByRecency(lastDonationDate) {
  const months = monthsSince(lastDonationDate);
  return months === null || months >= DONATION_COOLDOWN_MONTHS;
}

function sameCity(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function scoreCandidate(donor, request) {
  const reasons = [];
  let score = 0;

  if (sameCity(donor.city, request.city)) {
    score += CITY_MATCH_POINTS;
    reasons.push('Same city as the request');
  }

  if (donor.is_blood_group_verified) {
    score += VERIFIED_POINTS;
    reasons.push('Blood group verified');
  }

  const months = monthsSince(donor.last_donation_date);
  if (months === null) {
    score += RECENCY_MAX_POINTS;
    reasons.push('No prior donation on record');
  } else {
    const cappedMonths = Math.min(months, 12);
    const recencyPoints = Math.round((cappedMonths / 12) * RECENCY_MAX_POINTS);
    score += recencyPoints;
    reasons.push(`Eligible — last donated ${Math.floor(months)} month(s) ago`);
  }

  return {
    donor_id: donor.id,
    name: donor.name,
    city: donor.city,
    blood_group: donor.blood_group,
    is_blood_group_verified: Boolean(donor.is_blood_group_verified),
    last_donation_date: donor.last_donation_date,
    score,
    reasons,
  };
}

// candidates must already be: compatible blood group + is_available = true.
// This function only removes donors still inside the 3-month cooldown and
// ranks the rest — deterministic, no randomness, explainable score.
export function rankDonorCandidates(candidates, request) {
  return candidates
    .filter((donor) => isEligibleByRecency(donor.last_donation_date))
    .map((donor) => scoreCandidate(donor, request))
    .sort((a, b) => b.score - a.score);
}

export { DONATION_COOLDOWN_MONTHS };
