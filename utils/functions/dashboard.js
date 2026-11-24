// View-model helpers for the signed-in dashboard. Pure functions so they can be
// unit tested without a database or a renderer.

const SUBJECTS = [
  {
    key: 'physics',
    label: 'Physics',
    short: 'Physics',
    color: '#3558f0',
    href: '/train/Physics/chooseUnits',
  },
  {
    key: 'chemistry',
    label: 'Chemistry',
    short: 'Chemistry',
    color: '#e8731c',
    href: '/train/Chemistry/chooseUnits',
  },
  {
    key: 'biology',
    label: 'Biology',
    short: 'Biology',
    color: '#1fa06a',
    href: '/train/Biology/chooseUnits',
  },
  {
    key: 'ess',
    label: 'Earth & Space',
    short: 'ESS',
    color: '#9b5de5',
    href: '/train/ESS/chooseUnits',
  },
  {
    key: 'usabo',
    label: 'USABO',
    short: 'USABO',
    color: '#d6336c',
    href: '/usaboHomepage',
  },
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

const STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** Axis bounds on round numbers that contain [min, max], with 3-6 gridlines. */
function niceDomain(min, max) {
  const span = Math.max(max - min, 1);
  const step = STEPS.find((s) => span / s <= 5) || STEPS[STEPS.length - 1];
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi === lo) hi = lo + step;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, step, ticks };
}

/**
 * Keep labels at least `gap` apart (all values are percentages of the chart
 * height) while staying near where they want to be. Returns positions in the
 * same order as the input.
 */
function spreadLabels(positions, gap, lo = 0, hi = 100) {
  const order = positions
    .map((pos, index) => ({ pos, index }))
    .sort((a, b) => a.pos - b.pos);
  for (let i = 0; i < order.length; i += 1) {
    const min = i === 0 ? lo : order[i - 1].pos + gap;
    order[i].pos = Math.max(order[i].pos, min);
  }
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const max = i === order.length - 1 ? hi : order[i + 1].pos - gap;
    order[i].pos = Math.min(order[i].pos, max);
  }
  const out = new Array(positions.length);
  order.forEach((o) => {
    out[o.index] = o.pos;
  });
  return out;
}

/**
 * One shared chart of every subject's rating history, right-aligned so the
 * latest answer lines up across subjects. Coordinates are percentages, so the
 * template can draw lines in a stretched SVG and place text as HTML.
 */
function ratingChart(user, { points = 40, labelGap = 9 } = {}) {
  const ratings = (user && user.rating) || {};
  const tracker = (user && user.stats && user.stats.ratingTracker) || {};
  const rows = SUBJECTS.map((s) => {
    const values = (tracker[s.key] || [])
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .slice(-points);
    const rating = Number(ratings[s.key]);
    return {
      ...s,
      values,
      rated: Number.isFinite(rating) && rating > 0,
      rating,
    };
  }).filter((r) => r.rated);

  const plotted = rows.filter((r) => r.values.length >= 2);
  const unplotted = rows
    .filter((r) => r.values.length < 2)
    .map((r) => ({ key: r.key, label: r.label, rating: Math.round(r.rating) }));
  if (plotted.length === 0) {
    return { empty: true, series: [], ticks: [], unplotted };
  }

  const all = plotted.flatMap((r) => r.values);
  const domain = niceDomain(Math.min(...all), Math.max(...all));
  const longest = Math.max(...plotted.map((r) => r.values.length));
  const y = (v) =>
    Math.round((1 - (v - domain.lo) / (domain.hi - domain.lo)) * 1000) / 10;

  const series = plotted.map((r) => {
    const offset = longest - r.values.length;
    const coords = r.values.map((v, i) => [
      Math.round(((offset + i) / (longest - 1)) * 1000) / 10,
      y(v),
    ]);
    const last = r.values[r.values.length - 1];
    return {
      key: r.key,
      label: r.label,
      short: r.short,
      color: r.color,
      href: r.href,
      points: coords.map((c) => c.join(',')).join(' '),
      rating: Math.round(last),
      change: Math.round(last - r.values[0]),
      samples: r.values.length,
      endX: coords[coords.length - 1][0],
      endY: coords[coords.length - 1][1],
    };
  });
  const placed = spreadLabels(
    series.map((s) => s.endY),
    labelGap,
    2,
    98,
  );
  series.forEach((s, i) => {
    s.labelY = placed[i];
  });

  return {
    empty: false,
    series,
    unplotted,
    ticks: domain.ticks.map((value) => ({ value, y: y(value) })),
    answers: longest,
  };
}

module.exports = {
  SUBJECTS,
  sparkline,
  ratingCards,
  levelProgress,
  niceDomain,
  spreadLabels,
  ratingChart,
};
