// Blood-type compatibility helper for frontend widgets & dashboard filters
// Matches backend/src/services/matching/compatibility.js exactly.

export const DONOR_TO_RECIPIENTS = {
  'O-':  ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'], // universal donor
  'O+':  ['O+', 'A+', 'B+', 'AB+'],
  'A-':  ['A-', 'A+', 'AB-', 'AB+'],
  'A+':  ['A+', 'AB+'],
  'B-':  ['B-', 'B+', 'AB-', 'AB+'],
  'B+':  ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};

export const ALL_BLOOD_GROUPS = Object.keys(DONOR_TO_RECIPIENTS);

export function getCompatibleDonorGroups(requestedBloodGroup) {
  const donors = Object.entries(DONOR_TO_RECIPIENTS)
    .filter(([, recipients]) => recipients.includes(requestedBloodGroup))
    .map(([donorGroup]) => donorGroup);

  return donors.length > 0 ? donors : ['O-', requestedBloodGroup];
}

export function canDonorGiveToRecipient(donorGroup, recipientGroup) {
  const recipients = DONOR_TO_RECIPIENTS[donorGroup];
  if (!recipients) return false;
  return recipients.includes(recipientGroup);
}
