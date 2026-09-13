/* Race loop and state machine. Physics runs on a fixed 120 Hz step so the
 * handling feels identical regardless of the display's refresh rate. */
(function (NS) {
  'use strict';

  const { clamp, makeRandom } = NS.util;
  const track = NS.track;
  const input = NS.input;
  const render = NS.render;

  const FIXED_DT = 1 / 120;
  const MAX_STEPS = 6;
  const TOTAL_LAPS = 3;
  const COUNTDOWN = 3.6;

  const ENTRIES = [
    { name: 'YOU',     color: '#e34b3f', trim: '#ffd9d3', isPlayer: true,  skill: 1.00 },
    { name: 'Vega',    color: '#31b5c9', trim: '#d3f4f9', skill: 0.965 },
    { name: 'Marlow',  color: '#f0c231', trim: '#fff3cf', skill: 0.945 },
    { name: 'Kestrel', color: '#9b6de8', trim: '#e6dcff', skill: 0.925 }
  ];

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.width = canvas.width;
      this.height = canvas.height;
      this.totalLaps = TOTAL_LAPS;

      this.background = render.makeLayer(this.width, this.height);
      this.marks = render.makeLayer(this.width, this.height);
      this.paintBackground();

      this.seed = 20260913;
      this.reset();

      this.lastFrame = performance.now();
      this.accumulator = 0;
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    paintBackground() {
      const ctx = this.background.getContext('2d');
      render.paintGrass(ctx, this.width, this.height, makeRandom(99));
      render.paintTrack(ctx);
      this.scenery = render.buildScenery(this.width, this.height, makeRandom(1234));
      render.paintScenery(ctx, this.scenery, makeRandom(4321));
      render.paintStartLine(ctx);
    }

    reset() {
      const rng = makeRandom(this.seed);
      this.seed = (this.seed * 1103515245 + 12345) >>> 0;

      this.marks.getContext('2d').clearRect(0, 0, this.width, this.height);

      // Two-by-two grid, staggered behind the start line like the real thing.
      this.cars = ENTRIES.map(function (entry, i) {
        const behind = 30 + Math.floor(i / 2) * 52;
        const lane = (i % 2 === 0 ? -1 : 1) * track.halfWidth * 0.44;
        const slot = track.lanePoint(track.startS - behind, lane);
        const car = new NS.Car({
          name: entry.name, color: entry.color, trim: entry.trim,
          isPlayer: entry.isPlayer, skill: entry.skill,
          x: slot.x, y: slot.y, heading: slot.heading, startBehind: behind
        });
        if (!entry.isPlayer) car.ai = new NS.Driver(car, rng);
        return car;
      });

      this.player = this.cars.find(function (c) { return c.isPlayer; });
      this.raceTime = 0;
      this.countdown = COUNTDOWN;
      this.state = 'countdown';
      this.finishOrder = [];
      this.markFade = 0;
    }

    standings() {
      return this.cars.slice().sort(function (a, b) {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.raceDistance - a.raceDistance;
      });
    }

    positionOf(car) {
      return this.standings().indexOf(car) + 1;
    }

    playerControls() {
      const steer = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      const throttle = input.isDown('accel') || input.isDown('up') ? 1 : 0;
      const braking = input.isDown('down') ? 1 : 0;
      return [steer, throttle, braking];
    }

    step(dt) {
      if (this.state === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.state = 'racing';
          this.countdown = 0;
        }
        // Engines idle on the grid: no control input, no movement.
        for (const car of this.cars) car.applyControls(0, 0, 0);
        return;
      }

      if (this.state !== 'racing') return;

      this.raceTime += dt;

      const [steer, throttle, braking] = this.player.finished
        ? [0, 0, 0]
        : this.playerControls();
      this.player.applyControls(steer, throttle, braking);

      for (const car of this.cars) {
        if (car.ai) car.ai.update(dt, this.cars);
        car.step(dt, this.raceTime);
        NS.resolveScenery(car, this.scenery);
        NS.clampToArena(car, this.width, this.height);
      }

      NS.resolveCollisions(this.cars);

      for (const car of this.cars) {
        if (!car.finished && car.lap >= this.totalLaps) {
          car.finished = true;
          car.finishTime = this.raceTime;
          this.finishOrder.push(car);
        }
      }

      // The race is done once the player takes the flag, or once everyone has.
      const allDone = this.cars.every(function (c) { return c.finished; });
      if (this.player.finished || allDone) this.state = 'finished';
    }

    frame(now) {
      const elapsed = Math.min((now - this.lastFrame) / 1000, 0.25);
      this.lastFrame = now;

      if (input.wasPressed('restart')) this.reset();
      if (input.wasPressed('pause')) {
        if (this.state === 'racing') this.state = 'paused';
        else if (this.state === 'paused') this.state = 'racing';
      }
      input.endFrame();

      this.accumulator += elapsed;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
        this.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS) this.accumulator = 0;  // drop the backlog

      this.draw(now / 1000);
      requestAnimationFrame(this.frame);
    }

    draw(t) {
      const ctx = this.ctx;
      const marksCtx = this.marks.getContext('2d');

      if (this.state === 'racing') {
        for (const car of this.cars) render.stampMarks(marksCtx, car);

        // Fade the rubber slowly so the layer never saturates.
        this.markFade++;
        if (this.markFade >= 40) {
          this.markFade = 0;
          marksCtx.save();
          marksCtx.globalCompositeOperation = 'destination-out';
          marksCtx.fillStyle = 'rgba(0,0,0,0.05)';
          marksCtx.fillRect(0, 0, this.width, this.height);
          marksCtx.restore();
        }
      }

      ctx.drawImage(this.background, 0, 0);
      ctx.drawImage(this.marks, 0, 0);

      // Draw the player last so it is never hidden under a rival.
      for (const car of this.cars) if (!car.isPlayer) render.drawCar(ctx, car, false);
      render.drawCar(ctx, this.player, false);
      if (this.state !== 'finished') render.drawPlayerMarker(ctx, this.player, t);

      render.drawHud(ctx, this);
      render.drawOverlay(ctx, this);
    }
  }

  window.addEventListener('load', function () {
    const canvas = document.getElementById('screen');
    window.SPRINT.game = new Game(canvas);
  });

  NS.Game = Game;
})(window.SPRINT);
