// Two noisy scans of one terrain. Scan B starts rotated and offset, then is
// pulled onto scan A in a few discrete steps, like iterations of a
// registration algorithm.
(function () {
  var canvas = document.getElementById("cloud");
  var replayBtn = document.getElementById("replay");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COBALT = "44, 77, 203";
  var MARKER = "227, 166, 0";
  var N = 3400;

  // Deterministic random so the scene looks the same on every load.
  var seed = 310197;
  function rand() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  function gauss() { return (rand() + rand() + rand() - 1.5) * 0.8; }

  function height(x, y) {
    return 0.55 * Math.sin(1.7 * x + 0.6) * Math.cos(1.3 * y)
         + 0.28 * Math.sin(3.1 * x - 2.0 * y)
         + 0.12 * Math.cos(5.2 * y + x);
  }

  function scan(noise) {
    var pts = [];
    for (var i = 0; i < N; i++) {
      var x = (rand() * 2 - 1) * 2.2;
      var y = (rand() * 2 - 1) * 1.7;
      pts.push([x + gauss() * noise, y + gauss() * noise, height(x, y) + gauss() * noise * 1.4]);
    }
    return pts;
  }

  var scanA = scan(0.012);
  var scanB = scan(0.012);

  // Start pose of scan B: rotation about z plus a translation.
  var START = { yaw: 0.62, dx: 0.9, dy: -0.55, dz: 0.5 };

  var progress = 0;          // 0 = misaligned, 1 = registered
  var startTime = 0;
  var DURATION = 4200;
  var STEPS = 7;             // discrete "iterations"
  var pointerX = 0, pointerY = 0;
  var camYawBase = 0.5;
  var w = 0, h = 0, dpr = 1;

  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function steppedProgress(t) {
    // Mostly smooth, with a visible snap per iteration.
    var s = t * STEPS;
    var i = Math.floor(s);
    var f = s - i;
    var step = (i + ease(Math.min(1, f * 1.6))) / STEPS;
    return Math.min(1, step);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(p, yaw, pitch, scale, cx, cy) {
    var cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    var x = p[0] * cyaw - p[1] * syaw;
    var y = p[0] * syaw + p[1] * cyaw;
    var z = p[2];
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var y2 = y * cp - z * sp;
    var z2 = y * sp + z * cp;
    var persp = 1 / (1 + y2 * 0.12);
    return [cx + x * scale * persp, cy - z2 * scale * persp, persp];
  }

  function posed(p, k) {
    // k = 1 means fully misaligned, 0 means registered.
    var a = START.yaw * k;
    var c = Math.cos(a), s = Math.sin(a);
    return [
      p[0] * c - p[1] * s + START.dx * k,
      p[0] * s + p[1] * c + START.dy * k,
      p[2] + START.dz * k
    ];
  }

  function draw(now) {
    ctx.clearRect(0, 0, w, h);

    var narrow = w < 760;
    var scale = narrow ? w * 0.12 : Math.min(w, h * 1.5) * 0.105;
    var cx = narrow ? w * 0.52 : w * 0.7;
    var cy = narrow ? h * 0.7 : h * 0.46;
    var yaw = camYawBase + now * 0.00007 + pointerX * 0.25;
    var pitch = 1.0 + pointerY * 0.12;

    var k = 1 - progress;
    var drawn = [
      { pts: scanA, color: COBALT, k: 0 },
      { pts: scanB, color: MARKER, k: k }
    ];

    for (var d = 0; d < drawn.length; d++) {
      var set = drawn[d];
      for (var i = 0; i < set.pts.length; i++) {
        var p = set.k ? posed(set.pts[i], set.k) : set.pts[i];
        var q = project(p, yaw, pitch, scale, cx, cy);
        var size = 1.3 + q[2] * 0.9;
        ctx.fillStyle = "rgba(" + set.color + "," + (0.35 + q[2] * 0.35).toFixed(2) + ")";
        ctx.fillRect(q[0] - size / 2, q[1] - size / 2, size, size);
      }
    }
  }

  var raf = 0;
  function frame(now) {
    if (!startTime) startTime = now;
    var t = Math.min(1, (now - startTime) / DURATION);
    progress = steppedProgress(t);
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    cancelAnimationFrame(raf);
    startTime = 0;
    progress = 0;
    if (reduceMotion) {
      progress = 1;
      draw(0);
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", function () {
    resize();
    if (reduceMotion) draw(0);
  });

  window.addEventListener("pointermove", function (e) {
    pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
    pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
    if (reduceMotion) draw(0);
  }, { passive: true });

  // Stop drawing when the hero is off screen.
  if ("IntersectionObserver" in window && !reduceMotion) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function (n) {
          // Keep the registered state; only resume rotation.
          startTime = startTime || n;
          frame(n);
        });
      } else {
        cancelAnimationFrame(raf);
      }
    }).observe(canvas);
  }

  if (replayBtn) replayBtn.addEventListener("click", play);

  resize();
  play();
})();
