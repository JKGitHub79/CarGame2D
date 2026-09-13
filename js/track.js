/* Track geometry: a closed Catmull-Rom loop resampled to evenly spaced points.
 * The same polyline drives rendering, the on-track test, AI targeting and lap
 * progress, so what you see is exactly what the physics uses. */
(function (NS) {
  'use strict';

  const { clamp } = NS.util;

  // Circuit control points, in canvas space (1000 x 620).
  const CONTROL = [
    [120, 330], [152, 172], [330, 96], [540, 212], [742, 96],
    [900, 202], [906, 400], [764, 520], [520, 548], [300, 524], [140, 470]
  ];

  const ROAD_HALF_WIDTH = 57;   // asphalt reaches this far either side of the centreline
  const SAMPLE_SPACING = 9;     // resampled centreline resolution, in pixels

  const CANVAS_W = 1000;
  const CANVAS_H = 620;
  const EDGE_MARGIN = 34;       // grass to leave between the painted road and the canvas edge
  const PAINT_REACH = 11;       // widest stroke drawn beyond the asphalt (the road shadow)

  /* Scales the control points so the road — at whatever width is configured —
   * still fits the canvas with a margin, then centres it. Without this a wider
   * road runs off the edge, and cars get stopped by the arena wall while they
   * are still on the tarmac. Only ever shrinks, so a narrow road keeps the
   * circuit exactly as it was laid out. */
  function fitToCanvas(points, halfWidth) {
    const xs = points.map(function (p) { return p[0]; });
    const ys = points.map(function (p) { return p[1]; });
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);

    const reach = halfWidth + PAINT_REACH + EDGE_MARGIN;
    const availX = CANVAS_W - reach * 2;
    const availY = CANVAS_H - reach * 2;
    const scale = Math.min(availX / (maxX - minX), availY / (maxY - minY), 1);

    const spanX = (maxX - minX) * scale, spanY = (maxY - minY) * scale;
    const offX = (CANVAS_W - spanX) / 2, offY = (CANVAS_H - spanY) / 2;

    return points.map(function (p) {
      return [offX + (p[0] - minX) * scale, offY + (p[1] - minY) * scale];
    });
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
    ];
  }

  function build() {
    const control = fitToCanvas(CONTROL, ROAD_HALF_WIDTH);
    const n = control.length;
    const dense = [];

    // Dense spline sampling first; spacing here is uneven, so we resample below.
    for (let i = 0; i < n; i++) {
      const p0 = control[(i - 1 + n) % n];
      const p1 = control[i];
      const p2 = control[(i + 1) % n];
      const p3 = control[(i + 2) % n];
      for (let k = 0; k < 40; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 40));
    }
    dense.push(dense[0].slice());

    // Walk the dense curve and drop a point every SAMPLE_SPACING pixels.
    const pts = [];
    let carry = 0;
    for (let i = 0; i < dense.length - 1; i++) {
      const [ax, ay] = dense[i];
      const [bx, by] = dense[i + 1];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg <= 1e-9) continue;
      let travelled = carry;
      while (travelled < seg) {
        const t = travelled / seg;
        pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
        travelled += SAMPLE_SPACING;
      }
      carry = travelled - seg;
    }

    const count = pts.length;
    let length = 0;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % count];
      a.s = length;                       // arc length at this point
      a.len = Math.hypot(b.x - a.x, b.y - a.y);
      a.dx = a.len ? (b.x - a.x) / a.len : 1;
      a.dy = a.len ? (b.y - a.y) / a.len : 0;
      a.heading = Math.atan2(a.dy, a.dx);
      length += a.len;
    }

    return { points: pts, count, length, halfWidth: ROAD_HALF_WIDTH };
  }

  const track = build();

  /* Projects a world point onto the centreline.
   * `hint` is the previously matched segment index; supplying it turns the
   * search into a cheap local scan instead of a full sweep of the loop. */
  function project(x, y, hint) {
    const pts = track.points;
    const n = track.count;
    let from = 0, to = n;

    if (hint >= 0) { from = hint - 14; to = hint + 15; }

    let best = Infinity, bestIdx = 0, bestT = 0;
    for (let k = from; k < to; k++) {
      const i = ((k % n) + n) % n;
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const abx = b.x - a.x, aby = b.y - a.y;
      const lenSq = abx * abx + aby * aby;
      const t = lenSq ? clamp(((x - a.x) * abx + (y - a.y) * aby) / lenSq, 0, 1) : 0;
      const px = a.x + abx * t, py = a.y + aby * t;
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d < best) { best = d; bestIdx = i; bestT = t; }
    }

    const a = pts[bestIdx];
    const dist = Math.sqrt(best);
    // Signed offset: positive to the right of the direction of travel.
    const side = (y - a.y) * a.dx - (x - a.x) * a.dy;

    return {
      index: bestIdx,
      distance: dist,
      offset: side >= 0 ? dist : -dist,
      s: a.s + a.len * bestT,
      onRoad: dist <= track.halfWidth
    };
  }

  /* Centreline point a given arc length along the loop (wraps automatically). */
  function pointAt(s) {
    const n = track.count;
    let d = s % track.length;
    if (d < 0) d += track.length;
    let i = Math.floor(d / (track.length / n));
    i = ((i % n) + n) % n;
    // Arc length is near-uniform but not exact; nudge to the right segment.
    while (track.points[i].s > d && i > 0) i--;
    while (i < n - 1 && track.points[i].s + track.points[i].len < d) i++;
    const a = track.points[i];
    const t = a.len ? clamp((d - a.s) / a.len, 0, 1) : 0;
    return {
      x: a.x + a.dx * a.len * t,
      y: a.y + a.dy * a.len * t,
      heading: a.heading,
      index: i
    };
  }

  /* Absolute heading change over the next `ahead` pixels: the AI's corner radar. */
  function curvatureAhead(s, ahead) {
    const here = pointAt(s).heading;
    const there = pointAt(s + ahead).heading;
    return Math.abs(NS.util.wrapAngle(there - here));
  }

  /* World position `offset` pixels to the right of the centreline at arc
   * length s. Right-handed in screen space (y grows downward), matching the
   * sign that project() reports, so the two can be used interchangeably. */
  function lanePoint(s, offset) {
    const p = pointAt(s);
    return {
      x: p.x - Math.sin(p.heading) * offset,
      y: p.y + Math.cos(p.heading) * offset,
      heading: p.heading
    };
  }

  NS.track = {
    data: track,
    points: track.points,
    count: track.count,
    length: track.length,
    halfWidth: track.halfWidth,
    startS: 0,
    project, pointAt, lanePoint, curvatureAhead
  };
})(window.SPRINT);
