// Plain-Node self-check for the distance rules. Run: npm run test:geo
import {
  checkRadius, cityCenter, haversineKm, parseCoordinates, resolvePoint,
} from './geo.js';

let failed = 0;
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failed += 1;
}

const sukkur = { city: 'Sukkur' };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// distances between city centres
const km = (a, b) => haversineKm(resolvePoint({ city: a }), resolvePoint({ city: b }));
check('Sukkur -> Rohri is a few km', km('Sukkur', 'Rohri') > 2 && km('Sukkur', 'Rohri') < 8);
check('Sukkur -> Karachi is about 370 km in a straight line', near(km('Sukkur', 'Karachi'), 370, 40));

// the bug from the screenshot: Sukkur donor, Karachi request
for (const radius of [2, 10, 25, 100]) {
  check(`Karachi request is hidden from a Sukkur donor at ${radius} km`,
    checkRadius({ donor: sukkur, request: { city: 'Karachi' }, radiusKm: radius }).ok === false);
}

// radius is really used
check('Rohri request hidden at 2 km', checkRadius({ donor: sukkur, request: { city: 'Rohri' }, radiusKm: 2 }).ok === false);
check('Rohri request shown at 10 km', checkRadius({ donor: sukkur, request: { city: 'Rohri' }, radiusKm: 10 }).ok === true);
check('same-city request shown at 2 km', checkRadius({ donor: sukkur, request: { city: ' sukkur ' }, radiusKm: 2 }).ok === true);

// GPS beats city, and is not "approximate"
const gps = checkRadius({
  donor: { latitude: 27.7052, longitude: 68.8574, city: 'Sukkur' },
  request: { latitude: 27.7152, longitude: 68.8574, city: 'Sukkur' },
  radiusKm: 2,
});
check('GPS to GPS ~1.1 km is inside 2 km', gps.ok && gps.km > 0.9 && gps.km < 1.4 && gps.approximate === false);
const far = checkRadius({
  donor: { latitude: 27.7052, longitude: 68.8574, city: 'Sukkur' },
  request: { latitude: 27.7952, longitude: 68.8574, city: 'Sukkur' },
  radiusKm: 2,
});
check('GPS to GPS ~10 km is outside 2 km even in the same city', far.ok === false);
check('city-level distances are flagged approximate',
  checkRadius({ donor: sukkur, request: { city: 'Rohri' }, radiusKm: 10 }).approximate === true);

// unknown places fall back to the city name
check('unknown city, same name -> shown', checkRadius({ donor: { city: 'Smallville' }, request: { city: 'smallville' }, radiusKm: 2 }).ok === true);
check('unknown city, different name -> hidden', checkRadius({ donor: { city: 'Smallville' }, request: { city: 'Sukkur' }, radiusKm: 25 }).ok === false);
check('missing city on the donor -> hidden', checkRadius({ donor: {}, request: { city: 'Sukkur' }, radiusKm: 25 }).ok === false);

// bad / missing radius uses the 10 km default instead of showing everything
check('radius 0 falls back to 10 km (Rohri shown)', checkRadius({ donor: sukkur, request: { city: 'Rohri' }, radiusKm: 0 }).ok === true);
check('radius 0 falls back to 10 km (Karachi hidden)', checkRadius({ donor: sukkur, request: { city: 'Karachi' }, radiusKm: 0 }).ok === false);

// city lookup
check('"Sukkur, Sindh" resolves', cityCenter('Sukkur, Sindh') !== null);
check('unknown city resolves to null', cityCenter('Nowhere') === null);

// coordinate parsing
check('both empty is fine', parseCoordinates('', undefined).none === true);
check('valid pair parses', parseCoordinates('27.7', '68.8').latitude === 27.7);
check('one missing is rejected', parseCoordinates('27.7', '').ok === false);
check('latitude 91 is rejected', parseCoordinates(91, 10).ok === false);
check('longitude 181 is rejected', parseCoordinates(10, 181).ok === false);
check('text is rejected', parseCoordinates('abc', '10').ok === false);

console.log(failed === 0 ? '\nAll geo self-checks passed.' : `\n${failed} geo self-check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
