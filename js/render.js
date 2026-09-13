/* All drawing. The track and grass are rendered once into an offscreen
 * canvas; only cars, skid marks and HUD are redrawn each frame. */
(function (NS) {
  'use strict';

  const { clamp, formatTime, ordinal, TAU } = NS.util;
  const track = NS.track;

  const GRASS = '#3a7a3f';
  const ASPHALT = '#4a4e57';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function makeLayer(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function centrelinePath(ctx) {
    const pts = track.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function paintGrass(ctx, w, h, rng) {
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, w, h);

    // Broad mown bands, then speckle for texture.
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < h; y += 56) ctx.fillRect(0, y, w, 28);

    for (let i = 0; i < 2600; i++) {
      const x = rng() * w, y = rng() * h;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, 2, 2);
    }
  }

  function paintTrack(ctx) {
    const wide = track.halfWidth * 2;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Soft shadow under the road edge, then white kerb, then red dashes on
    // top of it: the dash pattern reads as alternating kerbing on both sides.
    centrelinePath(ctx);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = wide + 22;
    ctx.stroke();

    centrelinePath(ctx);
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = wide + 16;
    ctx.stroke();

    // Butt caps matter here: with round caps each dash is extended by half the
    // (very wide) stroke and the pattern merges into one solid red band.
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.setLineDash([26, 26]);
    centrelinePath(ctx);
    ctx.strokeStyle = '#c9343a';
    ctx.lineWidth = wide + 16;
    ctx.stroke();
    ctx.restore();

    centrelinePath(ctx);
    ctx.strokeStyle = ASPHALT;
    ctx.lineWidth = wide;
    ctx.stroke();

    // Faint asphalt mottling so the surface is not a flat slab of grey.
    ctx.save();
    centrelinePath(ctx);
    ctx.lineWidth = wide;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.setLineDash([90, 60]);
    ctx.stroke();
    ctx.restore();

    // Dashed centre line.
    ctx.save();
    ctx.setLineDash([18, 26]);
    centrelinePath(ctx);
    ctx.strokeStyle = 'rgba(235,235,215,0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }


  function drawTree(ctx, x, y, r, tint, rng) {
    const palettes = [
      ['#24512a', '#2e6a33', '#38803d'],
      ['#1f4a26', '#2a6130', '#33763a'],
      ['#2a5a2c', '#357036', '#408943']
    ];
    const shades = palettes[tint % palettes.length];

    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.4, y + r * 0.5, r * 1.0, r * 0.72, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#4a3826';
    ctx.fillRect(x - 2, y, 4, r * 0.6);

    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = shades[i];
      const a = (i / 3) * TAU + r;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.22, y + Math.sin(a) * r * 0.22 - r * 0.12,
        r * (0.92 - i * 0.16), 0, TAU);
      ctx.fill();
    }
  }

  function drawTyreStack(ctx, x, y, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.3, y + r * 0.35, r * 1.1, r * 0.85, 0, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#1c1d21', '#26282e', '#303239'][i];
      ctx.beginPath();
      ctx.arc(x, y - i * 1.6, r - i * 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#4a4e57';
    ctx.beginPath();
    ctx.arc(x, y - 3.2, r * 0.34, 0, TAU);
    ctx.fill();
  }

  /* Trackside furniture. Tyre stacks line the outside of the quickest
   * corners the way they would on a real circuit, and trees are grouped into
   * copses rather than sprinkled evenly, so the grass reads as scenery
   * instead of noise. Everything keeps well clear of the racing surface. */
  function buildScenery(w, h, rng) {
    const pts = track.points;
    const n = track.count;
    const placed = [];

    function clearOfTrack(x, y, margin) {
      return x > 14 && y > 14 && x < w - 14 && y < h - 14 &&
        track.project(x, y, -1).distance > track.halfWidth + margin;
    }

    function free(x, y, gap) {
      return !placed.some(function (p) { return Math.hypot(p.x - x, p.y - y) < gap; });
    }

    // --- Tyre barriers on the outside of the sharpest corners.
    const AHEAD = 7;                       // ~63px of centreline
    const bendAt = [];
    for (let i = 0; i < n; i++) {
      bendAt.push(NS.util.wrapAngle(pts[(i + AHEAD) % n].heading - pts[i].heading));
    }

    let i = 0;
    while (i < n) {
      if (Math.abs(bendAt[i]) < 0.20) { i++; continue; }
      // Walk the whole corner, then hug its outside edge with stacks.
      const sign = Math.sign(bendAt[i]);
      let j = i;
      while (j < n && Math.sign(bendAt[j]) === sign && Math.abs(bendAt[j]) > 0.12) j++;
      if (j - i >= 6) {
        // Guard the apex only: a barrier running the whole corner would ring
        // most of the lap in tyres.
        let peak = i;
        for (let k = i; k < j; k++) if (Math.abs(bendAt[k]) > Math.abs(bendAt[peak])) peak = k;
        for (let k = peak - 6; k <= peak + 6; k += 2) {
          const idx = ((k % n) + n) % n;
          const p = track.lanePoint(pts[idx].s, -sign * (track.halfWidth + 22));
          if (clearOfTrack(p.x, p.y, 16) && free(p.x, p.y, 13)) {
            placed.push({ x: p.x, y: p.y, kind: 'tyre', r: 7.5 });
          }
        }
      }
      i = j + 1;
    }

    // --- Copses of trees in the open grass, well back from the kerbs.
    for (let attempt = 0, copses = 0; attempt < 500 && copses < 8; attempt++) {
      const cx = 30 + rng() * (w - 60);
      const cy = 30 + rng() * (h - 60);
      if (!clearOfTrack(cx, cy, 62) || !free(cx, cy, 104)) continue;
      copses++;
      const trees = 3 + Math.floor(rng() * 4);
      for (let t = 0; t < trees; t++) {
        const x = cx + (rng() - 0.5) * 58;
        const y = cy + (rng() - 0.5) * 44;
        if (!clearOfTrack(x, y, 46) || !free(x, y, 15)) continue;
        placed.push({ x: x, y: y, kind: 'tree', r: 12 + rng() * 8, tint: Math.floor(rng() * 3) });
      }
    }

    // Sorted back to front so overlapping canopies layer correctly.
    placed.sort(function (a, b) { return a.y - b.y; });

    // Solid radius for collision: a tyre stack blocks its full footprint, a
    // tree only its trunk, so clipping a canopy edge does not stop you dead.
    for (const p of placed) p.solid = p.kind === 'tyre' ? p.r : p.r * 0.42;
    return placed;
  }

  function paintScenery(ctx, placed, rng) {
    for (const p of placed) {
      if (p.kind === 'tyre') drawTyreStack(ctx, p.x, p.y, p.r);
      else drawTree(ctx, p.x, p.y, p.r, p.tint, rng);
    }
  }

  function paintStartLine(ctx) {
    const p = track.pointAt(track.startS);
    const w = track.halfWidth * 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading);
    const cell = w / 8;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 ? '#f2f2f2' : '#22242b';
        ctx.fillRect(row * cell - cell, col * cell - w / 2, cell, cell);
      }
    }
    ctx.restore();
  }

  function drawCar(ctx, car, dimmed) {
    const spec = NS.CAR_SPEC;
    const L = spec.length, W = spec.width;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    if (dimmed) ctx.globalAlpha = 0.45;

    // Drop shadow, offset slightly so cars read as sitting above the tarmac.
    ctx.save();
    ctx.translate(2.5, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, -L / 2, -W / 2, L, W, 4);
    ctx.fill();
    ctx.restore();

    // Wheels: the front pair turns with the steering input.
    ctx.fillStyle = '#15161a';
    const wheelW = 8, wheelH = 4.5;
    for (const [wx, wy, turn] of [
      [L * 0.3, -W / 2, true], [L * 0.3, W / 2, true],
      [-L * 0.3, -W / 2, false], [-L * 0.3, W / 2, false]
    ]) {
      ctx.save();
      ctx.translate(wx, wy);
      if (turn) ctx.rotate(car.steer * 0.5);
      ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
      ctx.restore();
    }

    // Body.
    ctx.fillStyle = car.color;
    roundRect(ctx, -L / 2, -W / 2, L, W, 4.5);
    ctx.fill();

    // Nose highlight and rear wing.
    ctx.fillStyle = car.trim;
    ctx.fillRect(L / 2 - 5, -W / 2 + 1.5, 3.5, W - 3);
    ctx.fillRect(-L / 2 + 1, -W / 2 - 1.5, 3.5, W + 3);

    // Cockpit.
    ctx.fillStyle = 'rgba(15,20,35,0.85)';
    roundRect(ctx, -3.5, -W / 2 + 3, 9, W - 6, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(3, -W / 2 + 3.5, 2, W - 7);

    ctx.restore();
  }

  function drawPlayerMarker(ctx, car, t) {
    const bob = Math.sin(t * 5) * 1.6;
    ctx.save();
    ctx.translate(car.x, car.y - 24 + bob);
    ctx.fillStyle = '#ffe14d';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(-6, -3);
    ctx.lineTo(6, -3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* Skid marks accumulate on their own layer and fade slowly, so the track
   * gradually shows where the racing line actually is. */
  function stampMarks(ctx, car) {
    const spec = NS.CAR_SPEC;
    const sliding = car.slip > 78;
    const kicking = !car.onRoad && car.speed() > 40;
    if (!sliding && !kicking) return;

    const alpha = clamp((sliding ? car.slip / 900 : 0.16), 0, 0.3);
    ctx.fillStyle = car.onRoad
      ? 'rgba(20,20,24,' + alpha.toFixed(3) + ')'
      : 'rgba(74,58,36,' + alpha.toFixed(3) + ')';

    const nx = Math.cos(car.heading), ny = Math.sin(car.heading);
    for (const side of [-1, 1]) {
      const px = car.x - nx * spec.length * 0.3 - ny * side * spec.width * 0.5;
      const py = car.y - ny * spec.length * 0.3 + nx * side * spec.width * 0.5;
      ctx.fillRect(px - 1.6, py - 1.6, 3.2, 3.2);
    }
  }

  function panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(12,14,20,0.62)';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawHud(ctx, game) {
    const player = game.player;
    const W = game.width;

    ctx.save();
    ctx.textBaseline = 'top';

    // Lap / position.
    panel(ctx, 12, 12, 172, 60);
    ctx.fillStyle = '#9fb0cc';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.fillText('LAP', 26, 22);
    ctx.fillText('POS', 112, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.fillText(Math.min(player.lap + 1, game.totalLaps) + '/' + game.totalLaps, 26, 38);
    ctx.fillText(ordinal(game.positionOf(player)), 112, 38);

    // Timing.
    panel(ctx, W - 196, 12, 184, 60);
    ctx.fillStyle = '#9fb0cc';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.fillText('TIME', W - 182, 22);
    ctx.fillText('BEST LAP', W - 182, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(game.raceTime), W - 24, 18);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(formatTime(player.bestLap), W - 24, 42);
    ctx.textAlign = 'left';

    // Running order.
    const order = game.standings();
    const boardH = 22 + order.length * 20;
    panel(ctx, 12, game.height - boardH - 12, 196, boardH);
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#9fb0cc';
    ctx.fillText('RUNNING ORDER', 26, game.height - boardH - 2);
    order.forEach(function (car, i) {
      const y = game.height - boardH + 16 + i * 20;
      ctx.fillStyle = car.color;
      roundRect(ctx, 26, y + 2, 10, 10, 2);
      ctx.fill();
      ctx.fillStyle = car.isPlayer ? '#ffe14d' : '#dde4f0';
      ctx.font = (car.isPlayer ? 'bold ' : '') + '13px "Trebuchet MS", sans-serif';
      ctx.fillText((i + 1) + '. ' + car.name, 44, y);
      ctx.fillStyle = '#8d9bb5';
      ctx.font = '12px monospace';
      ctx.fillText('L' + Math.min(car.lap + 1, game.totalLaps), 168, y + 1);
    });

    // Speedometer bar.
    const sp = clamp(player.speed() / NS.CAR_SPEC.maxSpeed, 0, 1);
    const barW = 150;
    panel(ctx, W - 196, game.height - 52, 184, 40);
    ctx.fillStyle = '#9fb0cc';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.fillText('SPEED', W - 182, game.height - 46);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, W - 182, game.height - 30, barW, 10, 5);
    ctx.fill();
    const grad = ctx.createLinearGradient(W - 182, 0, W - 182 + barW, 0);
    grad.addColorStop(0, '#54d17a');
    grad.addColorStop(0.65, '#ffd24a');
    grad.addColorStop(1, '#ff5d4a');
    ctx.fillStyle = grad;
    roundRect(ctx, W - 182, game.height - 30, Math.max(4, barW * sp), 10, 5);
    ctx.fill();
    if (!player.onRoad) {
      ctx.fillStyle = '#ffbe3d';
      ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
      ctx.fillText('OFF TRACK', W - 182, game.height - 48);
    }

    ctx.restore();
  }

  function centreText(ctx, text, x, y, font, fill, stroke) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (stroke) {
      ctx.lineWidth = 6;
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawOverlay(ctx, game) {
    const cx = game.width / 2, cy = game.height / 2;

    if (game.state === 'countdown') {
      const remaining = Math.ceil(game.countdown);
      const label = remaining > 0 ? String(remaining) : 'GO!';
      const phase = 1 - (game.countdown - Math.floor(game.countdown));
      const scale = 1 + (1 - phase) * 0.45;
      ctx.save();
      ctx.translate(cx, cy - 40);
      ctx.scale(scale, scale);
      centreText(ctx, label, 0, 0, 'bold 92px "Trebuchet MS", sans-serif',
        remaining > 0 ? '#ffe14d' : '#6bf08a', 'rgba(0,0,0,0.7)');
      ctx.restore();
      return;
    }

    if (game.state === 'paused') {
      ctx.fillStyle = 'rgba(8,10,16,0.6)';
      ctx.fillRect(0, 0, game.width, game.height);
      centreText(ctx, 'PAUSED', cx, cy - 16, 'bold 56px "Trebuchet MS", sans-serif', '#ffffff', 'rgba(0,0,0,0.7)');
      centreText(ctx, 'P to resume  ·  R to restart', cx, cy + 34,
        '18px "Trebuchet MS", sans-serif', '#c2ccdd');
      return;
    }

    if (game.state === 'finished') {
      ctx.fillStyle = 'rgba(8,10,16,0.72)';
      ctx.fillRect(0, 0, game.width, game.height);

      const order = game.standings();
      const playerPos = order.indexOf(game.player) + 1;
      centreText(ctx, playerPos === 1 ? 'YOU WIN!' : 'RACE OVER', cx, 128,
        'bold 54px "Trebuchet MS", sans-serif', playerPos === 1 ? '#ffe14d' : '#ffffff', 'rgba(0,0,0,0.7)');
      centreText(ctx, 'You finished ' + ordinal(playerPos) + ' of ' + order.length, cx, 176,
        '20px "Trebuchet MS", sans-serif', '#c2ccdd');

      const top = 220, rowH = 38, boxW = 460;
      ctx.save();
      panel(ctx, cx - boxW / 2, top - 34, boxW, rowH * order.length + 44);
      ctx.textBaseline = 'middle';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.fillStyle = '#9fb0cc';
      ctx.fillText('POS   DRIVER', cx - boxW / 2 + 24, top - 14);
      ctx.textAlign = 'right';
      ctx.fillText('RESULT        BEST LAP', cx + boxW / 2 - 24, top - 14);
      ctx.textAlign = 'left';

      order.forEach(function (car, i) {
        const y = top + i * rowH + 14;
        ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
        ctx.fillStyle = car.isPlayer ? '#ffe14d' : '#dde4f0';
        ctx.fillText(ordinal(i + 1), cx - boxW / 2 + 24, y);
        ctx.fillStyle = car.color;
        roundRect(ctx, cx - boxW / 2 + 74, y - 6, 12, 12, 3);
        ctx.fill();
        ctx.fillStyle = car.isPlayer ? '#ffe14d' : '#dde4f0';
        ctx.font = (car.isPlayer ? 'bold ' : '') + '16px "Trebuchet MS", sans-serif';
        ctx.fillText(car.name, cx - boxW / 2 + 94, y);

        ctx.textAlign = 'right';
        ctx.font = '14px monospace';
        ctx.fillStyle = '#c2ccdd';
        // Rivals still circulating when the player takes the flag have not
        // retired, so report how far they got rather than calling it a DNF.
        ctx.fillText(car.finished
          ? formatTime(car.finishTime)
          : (car.raceDistance / track.length).toFixed(2) + ' laps',
          cx + boxW / 2 - 130, y);
        ctx.fillStyle = '#8d9bb5';
        ctx.fillText(formatTime(car.bestLap), cx + boxW / 2 - 24, y);
        ctx.textAlign = 'left';
      });
      ctx.restore();

      centreText(ctx, 'Press R for another race', cx, game.height - 56,
        '20px "Trebuchet MS", sans-serif', '#ffffff');
      return;
    }
  }

  NS.render = { makeLayer, paintGrass, paintTrack, buildScenery, paintScenery, paintStartLine, drawCar, drawPlayerMarker, stampMarks, drawHud, drawOverlay };
})(window.SPRINT);
