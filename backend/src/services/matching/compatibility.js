// Blood-type compatibility — the single source of truth for donor/recipient
// logic. Nothing outside this file should encode compatibility rules.
//
// Maps each donor blood group to the list of recipient blood groups it can
// safely donate to (standard ABO/Rh whole-blood compatibility).
const DONOR_TO_RECIPIENTS = {
  'O-':  ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'], // universal donor
  'O+':  ['O+', 'A+', 'B+', 'AB+'],
  'A-':  ['A-', 'A+', 'AB-', 'AB+'],
  'A+':  ['A+', 'AB+'],
  'B-':  ['B-', 'B+', 'AB-', 'AB+'],
  'B+':  ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'], // can only give to other AB+
};

export const ALL_BLOOD_GROUPS = Object.keys(DONOR_TO_RECIPIENTS);

// Given a recipient's blood group, return every donor blood group that can
// safely give to them.
export function getCompatibleDonorGroups(requestedBloodGroup) {
  const donors = Object.entries(DONOR_TO_RECIPIENTS)
    .filter(([, recipients]) => recipients.includes(requestedBloodGroup))
    .map(([donorGroup]) => donorGroup);

  if (donors.length === 0) {
    throw new Error(`Unknown or unsupported blood group: ${requestedBloodGroup}`);
  }
  return donors;
}

// Given a specific donor and recipient, return whether that donation is safe.
export function canDonorGiveToRecipient(donorGroup, recipientGroup) {
  const recipients = DONOR_TO_RECIPIENTS[donorGroup];
  if (!recipients) {
    throw new Error(`Unknown donor blood group: ${donorGroup}`);
  }
  return recipients.includes(recipientGroup);
}
