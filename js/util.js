/* Shared namespace and small math helpers. */
window.SPRINT = window.SPRINT || {};

(function (NS) {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* Wraps an angle to (-PI, PI] so steering errors never take the long way round. */
  function wrapAngle(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
  }

  /* Deterministic PRNG: the same seed always yields the same race. */
  function makeRandom(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '--:--.--';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function ordinal(n) {
    const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th'
      : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
    return n + suffix;
  }

  NS.util = { TAU, clamp, lerp, wrapAngle, dist, makeRandom, formatTime, ordinal };
})(window.SPRINT);
