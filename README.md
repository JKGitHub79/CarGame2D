# Sprint Circuit

A 2D top-view arcade racer in the spirit of *Super Sprint*. One fixed screen, no
scrolling, four cars on a closed circuit — one of them yours.

## Running it

No build step and no server required. Open `index.html` in any modern browser.

```
git clone https://github.com/JKGitHub79/CarGame2D.git
cd CarGame2D
xdg-open index.html      # or: open index.html  /  just double-click it
```

The scripts are plain `<script>` tags rather than ES modules specifically so the
game runs straight off the filesystem without tripping over CORS.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` | Steer left / right |
| `Space` | Accelerate |
| `↓` | Brake, then reverse (for backing out of the scenery) |
| `P` | Pause |
| `R` | Restart |

`WASD` mirrors the arrow keys. Brake and reverse are beyond the classic
two-control scheme, but without them a car nosed into a tyre stack has no way
out.

## The race

Three laps, standing start from a 2x2 grid, against three AI drivers of
differing pace. Position, lap count, lap times and the running order are shown
live; the finishing order, total time and best lap are shown at the flag.

Rivals still circulating when you take the flag are ranked on distance covered
and reported as, say, `2.97 laps` — they have not retired, they just have not
finished.

## How it works

| File | Responsibility |
| --- | --- |
| `js/util.js` | Math helpers, seeded PRNG, formatting |
| `js/track.js` | Circuit geometry, projection, lap progress |
| `js/input.js` | Keyboard state |
| `js/car.js` | Vehicle physics, car-to-car and scenery collision |
| `js/ai.js` | Opponent drivers |
| `js/render.js` | All drawing |
| `js/game.js` | Race loop and state machine |

A few decisions worth knowing about if you want to change something:

**One source of truth for the track.** The circuit is a closed Catmull-Rom
spline through eleven control points, resampled to evenly spaced centreline
points. Rendering strokes that polyline; the on-track test, the AI's aim point
and lap progress all project onto the same polyline. The asphalt you can see is
exactly the asphalt the physics recognises.

**Lap counting can't be cheated.** Each car's progress is the *accumulated*
signed distance travelled along the centreline, not its current position. Going
backwards subtracts. Driving across the infield to the start line gains
nothing, because the distance was never covered. The grid sits behind the line,
so every car must cover the same distance for a lap to count.

**Grip is finite, and that's the whole game.** Velocity is decomposed against
the car's heading *after* it rotates, so whatever is left pointing sideways is a
slide, scrubbed off at the grip rate. Grip is tuned (5.0) so that holding
the throttle flat through every corner is genuinely slower than lifting: a
perfect line-follower that never lifts spends ~14% of the lap on the grass and
laps around 9.6s, while the AI field laps in 8.2–8.7s. If you raise `grip` in
`js/car.js`, flat-out becomes optimal and the driving stops mattering.

**The AI is tuned against that physics, not hand-waved.** Opponents aim at a
point down the road (further ahead the faster they go), read the upcoming
curvature to pick a corner speed, wander their racing line so the pack does not
drive as one, and reverse out if they beach themselves. Their cornering
constants were picked by sweeping the parameter space for the fastest
configuration that still stays under 3% off-track. Per-driver `skill` in
`js/game.js` scales pace to spread the field.

**Trackside furniture is solid.** Tyre stacks are placed on the outside of the
sharpest corners and trees in copses well back from the kerbs. Both collide —
tyre stacks on their full footprint, trees only on the trunk. Nothing is placed
within 40px of the racing surface, and every barrier has been verified
escapable in reverse.

## Verification

The physics and AI were validated headlessly (a 90s four-car race: lap times,
off-track share, NaN checks) and the full game in Chromium via Playwright:
countdown, a complete three-lap race, restart, pause/resume, no console errors,
a 75-second soak for stuck cars, and an escape test from all 28 tyre barriers.
