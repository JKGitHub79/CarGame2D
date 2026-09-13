/* Keyboard state. Arrow keys steer, space accelerates. */
(function (NS) {
  'use strict';

  const held = Object.create(null);
  const pressedThisFrame = Object.create(null);

  const WATCHED = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    Space: 'accel', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
    KeyP: 'pause', KeyR: 'restart', Enter: 'start'
  };

  window.addEventListener('keydown', function (e) {
    const action = WATCHED[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    if (!held[action]) pressedThisFrame[action] = true;
    held[action] = true;
  }, { passive: false });

  window.addEventListener('keyup', function (e) {
    const action = WATCHED[e.code];
    if (!action) return;
    e.preventDefault();
    held[action] = false;
  }, { passive: false });

  // Losing focus mid-corner should not leave the throttle pinned.
  window.addEventListener('blur', function () {
    for (const k in held) held[k] = false;
  });

  NS.input = {
    isDown: (action) => !!held[action],
    /* True only on the frame the key went down; consumed by endFrame(). */
    wasPressed: (action) => !!pressedThisFrame[action],
    endFrame: function () {
      for (const k in pressedThisFrame) pressedThisFrame[k] = false;
    }
  };
})(window.SPRINT);
