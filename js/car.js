/* Arcade car physics: grip is finite, so hard turns slide and grass is slow. */
(function (NS) {
  'use strict';

  const { clamp, wrapAngle, TAU } = NS.util;
  const track = NS.track;

  const SPEC = {
    maxSpeed: 335,        // px/s on asphalt
    maxReverse: 95,
    accel: 300,           // px/s^2
    brake: 430,
    turnRate: 3.0,        // rad/s at full steering authority
    rollDrag: 0.7,        // 1/s, always-on velocity decay
    grip: 5.0,            // 1/s, how fast sideways slide is scrubbed off
    offRoadSpeed: 145,
    offRoadDrag: 3.4,
    offRoadGrip: 3.0,
    radius: 13,
    length: 30,
    width: 16
  };

  class Car {
    constructor(opts) {
      this.name = opts.name;
      this.color = opts.color;
      this.trim = opts.trim;
      this.isPlayer = !!opts.isPlayer;
      this.skill = opts.skill || 1;      // AI pace multiplier; 1 for the player
      this.ai = null;

      this.reset(opts.x, opts.y, opts.heading, opts.startBehind || 0);
    }

    reset(x, y, heading, startBehind) {
      this.x = x;
      this.y = y;
      this.heading = heading;
      this.vx = 0;
      this.vy = 0;
      this.steer = 0;              // -1..1, smoothed for the wheel graphics
      this.throttle = 0;
      this.braking = 0;

      const p = track.project(x, y, -1);
      this.segment = p.index;
      this.s = p.s;
      this.offset = p.offset;
      this.onRoad = p.onRoad;

      this.startBehind = startBehind;  // px from the grid slot to the start line
      this.travelled = 0;              // signed distance covered along the loop
      this.lap = 0;                    // laps completed
      this.lapTimes = [];
      this.lapStart = 0;
      this.bestLap = Infinity;
      this.finished = false;
      this.finishTime = 0;
      this.slip = 0;
      this.stuckFor = 0;
    }

    /* Distance covered measured from the start line: the single source of
     * truth for both lap counting and race position. Because it accumulates
     * frame to frame, cutting the loop backwards can never gain a lap. */
    get raceDistance() {
      return this.travelled - this.startBehind;
    }

    applyControls(steer, throttle, braking) {
      this.steerInput = clamp(steer, -1, 1);
      this.throttle = clamp(throttle, 0, 1);
      this.braking = clamp(braking, 0, 1);
    }

    step(dt, raceTime) {
      const spec = SPEC;
      const onRoad = this.onRoad;

      // Smooth the steering input so taps do not snap the car sideways.
      this.steer += (this.steerInput - this.steer) * clamp(dt * 12, 0, 1);

      const speed = Math.hypot(this.vx, this.vy);
      const fwdX = Math.cos(this.heading), fwdY = Math.sin(this.heading);
      const forwardSpeed = this.vx * fwdX + this.vy * fwdY;

      // A stationary car cannot turn; a flat-out one turns a little less.
      const authority = clamp(speed / 55, 0, 1) * (1 - 0.3 * clamp(speed / spec.maxSpeed, 0, 1));
      const direction = forwardSpeed < -1 ? -1 : 1;
      this.heading = (this.heading + this.steer * spec.turnRate * authority * direction * dt) % TAU;

      // Re-decompose against the NEW heading: whatever velocity is now
      // sideways is the slide, and it decays at the grip rate.
      const nx = Math.cos(this.heading), ny = Math.sin(this.heading);
      let vf = this.vx * nx + this.vy * ny;
      let vl = -this.vx * ny + this.vy * nx;

      const maxSpeed = (onRoad ? spec.maxSpeed : spec.offRoadSpeed) * this.skill;
      const accel = spec.accel * (onRoad ? 1 : 0.5) * this.skill;

      if (this.throttle > 0 && vf < maxSpeed) vf += accel * this.throttle * dt;
      if (this.braking > 0) {
        if (vf > 0) vf = Math.max(0, vf - spec.brake * this.braking * dt);
        else vf = Math.max(-spec.maxReverse, vf - spec.accel * 0.7 * this.braking * dt);
      }

      vf -= vf * (onRoad ? spec.rollDrag : spec.offRoadDrag) * dt;
      vf = clamp(vf, -spec.maxReverse, maxSpeed);
      vl *= Math.exp(-(onRoad ? spec.grip : spec.offRoadGrip) * dt);

      this.slip = Math.abs(vl);
      this.vx = nx * vf - ny * vl;
      this.vy = ny * vf + nx * vl;

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      this.updateProgress(dt, raceTime);
    }

    updateProgress(dt, raceTime) {
      const half = track.length / 2;
      const p = track.project(this.x, this.y, this.segment);

      let ds = p.s - this.s;
      if (ds > half) ds -= track.length;        // wrapped backwards over the line
      else if (ds < -half) ds += track.length;  // wrapped forwards over the line

      this.travelled += ds;
      this.s = p.s;
      this.segment = p.index;
      this.offset = p.offset;
      this.onRoad = p.onRoad;

      // The grid sits behind the line, so the first crossing (raceDistance 0)
      // starts lap 1 rather than completing it.
      const lapsDone = Math.max(0, Math.floor(this.raceDistance / track.length));
      if (lapsDone > this.lap) {
        const lapTime = raceTime - this.lapStart;
        this.lapTimes.push(lapTime);
        if (lapTime < this.bestLap) this.bestLap = lapTime;
        this.lapStart = raceTime;
        this.lap = lapsDone;
      }

      if (Math.hypot(this.vx, this.vy) < 25) this.stuckFor += dt;
      else this.stuckFor = 0;
    }

    speed() {
      return Math.hypot(this.vx, this.vy);
    }
  }

  /* Cars are circles for collision purposes: cheap, stable, and forgiving
   * enough that a nudge pushes you wide instead of pinning you to a rival. */
  function resolveCollisions(cars) {
    const r = SPEC.radius;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= r * 2 || d === 0) {
          if (d !== 0) continue;
          dx = 0.1; dy = 0; d = 0.1;
        }
        const nx = dx / d, ny = dy / d;
        const overlap = (r * 2 - d) * 0.5;

        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;

        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) continue;                 // already separating
        const impulse = -(1 + 0.35) * rel * 0.5;
        a.vx -= nx * impulse; a.vy -= ny * impulse;
        b.vx += nx * impulse; b.vy += ny * impulse;
      }
    }
  }

  /* Trackside furniture is solid: running wide into a tyre stack costs you
   * the corner rather than passing straight through it. */
  function resolveScenery(car, obstacles) {
    const r = SPEC.radius;
    for (const o of obstacles) {
      const dx = car.x - o.x, dy = car.y - o.y;
      const reach = r + o.solid;
      const d = Math.hypot(dx, dy);
      if (d >= reach || d === 0) continue;

      const nx = dx / d, ny = dy / d;
      car.x = o.x + nx * reach;
      car.y = o.y + ny * reach;

      const into = car.vx * nx + car.vy * ny;
      if (into < 0) {
        // Split into "driving at it" and "sliding past it". Only the first is
        // scrubbed; keeping most of the tangential speed lets a car glance off
        // and slide clear instead of sticking to the obstacle it nudged.
        const tx = -ny, ty = nx;
        const along = car.vx * tx + car.vy * ty;
        const bounce = -into * 0.35;
        const slide = along * 0.85;
        car.vx = nx * bounce + tx * slide;
        car.vy = ny * bounce + ty * slide;
      }
    }
  }

  /* The canvas edge is a hard barrier; the grass beyond the kerbs is not. */
  function clampToArena(car, w, h) {
    const r = SPEC.radius;
    if (car.x < r) { car.x = r; car.vx = Math.abs(car.vx) * 0.4; }
    if (car.x > w - r) { car.x = w - r; car.vx = -Math.abs(car.vx) * 0.4; }
    if (car.y < r) { car.y = r; car.vy = Math.abs(car.vy) * 0.4; }
    if (car.y > h - r) { car.y = h - r; car.vy = -Math.abs(car.vy) * 0.4; }
  }

  NS.Car = Car;
  NS.CAR_SPEC = SPEC;
  NS.resolveCollisions = resolveCollisions;
  NS.resolveScenery = resolveScenery;
  NS.clampToArena = clampToArena;
})(window.SPRINT);
