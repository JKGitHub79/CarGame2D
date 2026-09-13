/* Opponent drivers: aim at a point down the road, lift for corners, and
 * wander onto slightly different lines so the pack does not drive as one. */
(function (NS) {
  'use strict';

  const { clamp, wrapAngle } = NS.util;
  const track = NS.track;

  class Driver {
    constructor(car, rng) {
      this.car = car;
      this.rng = rng;
      this.lane = (rng() - 0.5) * track.halfWidth * 0.9;  // preferred line offset
      this.laneTarget = this.lane;
      this.laneTimer = 0;
      this.reverseFor = 0;
      this.wobble = rng() * 6.28;
    }

    update(dt, cars) {
      const car = this.car;
      const speed = car.speed();

      // Drift the racing line around every few seconds.
      this.laneTimer -= dt;
      if (this.laneTimer <= 0) {
        this.laneTimer = 1.6 + this.rng() * 2.4;
        this.laneTarget = (this.rng() - 0.5) * track.halfWidth * 1.1;
      }
      this.lane += (this.laneTarget - this.lane) * clamp(dt * 0.8, 0, 1);

      // Back out of scenery instead of grinding against it forever.
      if (this.reverseFor > 0) {
        this.reverseFor -= dt;
        const target = track.pointAt(car.s + 60);
        const away = wrapAngle(Math.atan2(target.y - car.y, target.x - car.x) - car.heading);
        car.applyControls(away > 0 ? -1 : 1, 0, 1);
        return;
      }
      if (car.stuckFor > 1.4) {
        this.reverseFor = 0.8;
        car.stuckFor = 0;
        return;
      }

      // Aim further ahead the faster we are going.
      const lookahead = 34 + speed * 0.46;
      this.wobble += dt * 1.7;
      const laneNow = this.lane + Math.sin(this.wobble) * 4;
      const aim = track.lanePoint(car.s + lookahead, laneNow);

      let steerError = wrapAngle(Math.atan2(aim.y - car.y, aim.x - car.x) - car.heading);

      // Nudge around a car directly ahead rather than rear-ending it.
      for (const other of cars) {
        if (other === car) continue;
        const dx = other.x - car.x, dy = other.y - car.y;
        const d = Math.hypot(dx, dy);
        if (d > 70) continue;
        const rel = wrapAngle(Math.atan2(dy, dx) - car.heading);
        if (Math.abs(rel) < 0.7) steerError += (rel > 0 ? -1 : 1) * (70 - d) / 70 * 0.8;
      }

      const steer = clamp(steerError * 2.4, -1, 1);

      // Corner radar: how much the road bends over the next stretch.
      const bend = track.curvatureAhead(car.s, 40 + speed * 0.4);
      let targetSpeed = NS.CAR_SPEC.maxSpeed * car.skill * clamp(1.14 - bend * 0.34, 0.45, 1);
      if (!car.onRoad) targetSpeed = NS.CAR_SPEC.offRoadSpeed;

      // Steer back to the tarmac hard if we have run wide.
      const wide = Math.abs(car.offset) - track.halfWidth;
      if (wide > 0) targetSpeed *= 0.8;

      let throttle = 0, braking = 0;
      if (speed < targetSpeed) throttle = 1;
      else if (speed > targetSpeed * 1.12) braking = 0.7;

      car.applyControls(steer, throttle, braking);
    }
  }

  NS.Driver = Driver;
})(window.SPRINT);
