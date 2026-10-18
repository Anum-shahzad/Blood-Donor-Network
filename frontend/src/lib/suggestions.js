// Suggestion helpers for the request form's autocomplete fields.
// Data lives in ../data/*.json so it can be extended without touching code.
import hospitalsByCity from '../data/hospitals.json';
import diagnoses from '../data/diagnoses.json';

const MAX_SUGGESTIONS = 8;

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Lookup is keyed by normalised city name, so "karachi " and "Karachi" match.
const hospitalIndex = new Map(
  Object.entries(hospitalsByCity).map(([city, names]) => [normalize(city), names])
);

// Best matches first: name starts with the text, then a word in the name
// starts with it, then the text appears anywhere in the name.
function rankMatches(items, query) {
  const q = normalize(query);
  if (!q) return items.slice(0, MAX_SUGGESTIONS);
  const starts = [];
  const wordStarts = [];
  const contains = [];
  for (const item of items) {
    const n = normalize(item);
    if (n.startsWith(q)) starts.push(item);
    else if (n.split(/[\s(/&-]+/).some((w) => w.startsWith(q))) wordStarts.push(item);
    else if (n.includes(q)) contains.push(item);
  }
  return [...starts, ...wordStarts, ...contains].slice(0, MAX_SUGGESTIONS);
}

// True when we hold hospital data for this city (used for the empty-state text).
export function hasHospitalsForCity(city) {
  return hospitalIndex.has(normalize(city));
}

// Hospitals for the selected city only. Unknown city -> no suggestions, so a
// hospital from another city can never be offered.
export function suggestHospitals(city, query) {
  const list = hospitalIndex.get(normalize(city));
  return list ? rankMatches(list, query) : [];
}

export function suggestDiagnoses(query) {
  return rankMatches(diagnoses, query);
}
