// View-model helpers for the signed-in dashboard. Pure functions so they can be
// unit tested without a database or a renderer.

const SUBJECTS = [
  {
    key: 'physics',
    label: 'Physics',
    color: '#0ea5e9',
    href: '/train/Physics/chooseUnits',
  },
  {
    key: 'chemistry',
    label: 'Chemistry',
    color: '#f59e0b',
    href: '/train/Chemistry/chooseUnits',
  },
  {
    key: 'biology',
    label: 'Biology',
    color: '#22c55e',
    href: '/train/Biology/chooseUnits',
  },
  {
    key: 'ess',
    label: 'Earth & Space',
    color: '#a855f7',
    href: '/train/ESS/chooseUnits',
  },
  { key: 'usabo', label: 'USABO', color: '#dc2626', href: '/usaboHomepage' },
];

const SPARK_POINTS = 30;

/**
 * SVG polyline points for a small trend chart. Returns null when there is
 * nothing meaningful to draw (fewer than two finite values).
 */
function sparkline(values, { width = 120, height = 36, pad = 3 } = {}) {
  const series = (values || [])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .slice(-SPARK_POINTS);
  if (series.length < 2) {
    return null;
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = (width - 2 * pad) / (series.length - 1);
  const coords = series.map((v, i) => {
    const x = pad + i * step;
    // a flat series is drawn mid-height rather than on the floor
    const y =
      max === min
        ? height / 2
        : height - pad - ((v - min) / span) * (height - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
  return {
    points: coords.map((c) => c.join(',')).join(' '),
    last: coords[coords.length - 1],
    width,
    height,
    change: series[series.length - 1] - series[0],
    samples: series.length,
  };
}

/** One card per subject: rating, trend and where to train. */
function ratingCards(user) {
  const ratings = (user && user.rating) || {};
  const tracker = (user && user.stats && user.stats.ratingTracker) || {};
  return SUBJECTS.map((s) => {
    const rating = Number(ratings[s.key]);
    const rated = Number.isFinite(rating) && rating > 0;
    return {
      ...s,
      rated,
      rating: rated ? Math.round(rating) : null,
      trend: rated ? sparkline(tracker[s.key]) : null,
    };
  });
}

/** Percent of the way to the next level, clamped to 0-100. */
function levelProgress(experience) {
  if (!experience || !experience.totalToNext) {
    return 0;
  }
  const pct = (100 * experience.remainder) / experience.totalToNext;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

module.exports = { SUBJECTS, sparkline, ratingCards, levelProgress };
