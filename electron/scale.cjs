// How big the desktop app draws its interface on a screen, for the "Auto" interface size.
// Measured in the screen's own points (after Windows' or macOS's display scaling), so a 4K screen
// set to 150% scaling counts as 2560 × 1440. Uses the shorter of the height and 10/16 of the
// width, so a tablet, a portrait monitor or an ultra-wide screen gets a size that still fits.
//   small tablet ~ 90%   laptop 100%   1080p 110%   1440p 125%   4K 150%   5K 175%   8K 250%
const POINTS = [
  [720, 0.9],
  [900, 1],
  [1080, 1.1],
  [1440, 1.25],
  [2160, 1.5],
  [2880, 1.75],
  [4320, 2.5],
];
const MIN = 0.9, MAX = 3;

function autoScale(width, height) {
  const h = Math.min(height, width * 0.625);
  if (h <= POINTS[0][0]) return MIN;
  for (let i = 1; i < POINTS.length; i++) {
    const [h0, z0] = POINTS[i - 1], [h1, z1] = POINTS[i];
    if (h <= h1) return Math.round((z0 + ((h - h0) / (h1 - h0)) * (z1 - z0)) * 20) / 20;
  }
  // Beyond 8K: keep growing at the same rate, up to 300%.
  const [h0, z0] = POINTS[POINTS.length - 2], [h1, z1] = POINTS[POINTS.length - 1];
  return Math.min(MAX, Math.round((z1 + ((h - h1) / (h1 - h0)) * (z1 - z0)) * 20) / 20);
}

// The fixed sizes offered in Settings and stepped through with Ctrl + and Ctrl −.
const SIZES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

module.exports = { autoScale, SIZES };
