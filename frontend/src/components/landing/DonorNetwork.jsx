// Decorative donor <-> recipient network for the hero. Pure SVG + CSS (see the
// .lp-net-* rules in landing.css): thin links, small nodes, and a few short
// dashes that travel slowly along the links. It is aria-hidden, ignores the
// pointer, and carries no data -- it only suggests connection, not live activity.
const HUB = [760, 350];
const NODES = [
  [470, 210], [585, 505], [650, 135], [905, 165],
  [985, 335], [900, 560], [1090, 470], [1125, 215], [430, 395],
];
// [from, to] pairs; index -1 is the hub. Cross links keep it from looking like a star.
const LINKS = [
  [-1, 0], [-1, 1], [-1, 2], [-1, 3], [-1, 4], [-1, 5], [-1, 8],
  [4, 6], [4, 7], [3, 7], [1, 5], [0, 2],
];
const at = (i) => (i === -1 ? HUB : NODES[i]);

export default function DonorNetwork() {
  return (
    <svg
      className="lp-network"
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {LINKS.map(([a, b], i) => {
        const [x1, y1] = at(a);
        const [x2, y2] = at(b);
        return (
          <g key={i}>
            <line className="lp-net-line" x1={x1} y1={y1} x2={x2} y2={y2} />
            {i % 2 === 0 && (
              <line
                className="lp-net-pulse"
                x1={x1} y1={y1} x2={x2} y2={y2}
                pathLength="100"
                style={{ '--nd': `${(i * 1.15).toFixed(2)}s` }}
              />
            )}
          </g>
        );
      })}
      {NODES.map(([cx, cy], i) => (
        <circle key={i} className="lp-net-node" cx={cx} cy={cy} r="4.5" />
      ))}
      <circle className="lp-net-ring" cx={HUB[0]} cy={HUB[1]} r="9" />
      <circle className="lp-net-hub" cx={HUB[0]} cy={HUB[1]} r="7" />
    </svg>
  );
}
