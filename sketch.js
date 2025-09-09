// Cosmic Conductor - Barebones Particle Flocking
// Optimized particle system focused on performance

// Core particle system
let particles = [];
let numParticles = 100; // Start with fewer particles
let particleSize = 2;

// Background visual layers
let bgGradientTime = 0;
let planetsBg = [];
let nebulaBlobs = [];

// Flow-field bodies (dust + planets)
let bodies = [];
let numSmallBodies = 320; // particle-like dust
let numLargeBodies = 8;   // planetary sized bodies

// Perlin flow field
let flowFieldScale = 60; // grid cell size (px)
let flowCols = 0;
let flowRows = 0;
let flowField = [];
let flowZ = 0;         // time component for evolving field
let flowZInc = 0.0025; // field evolution speed

// Mouse attractor/repulsor pulse
let attractor = { active: false, x: 0, y: 0, strength: 0, life: 0 };

// Mouse motion dynamics (speed-based behavior)
let mouseSpeedSmoothed = 0;
let slowSpeedThreshold = 3;   // px/frame
let fastSpeedThreshold = 12;  // px/frame
let mouseInfluenceBaseRadius = 220; // pixels

// Debug options
let showMotionDebug = false; // Toggle motion visualization
let showBaselineDiff = false; // Show baseline vs current frame difference
let useHotspotAttraction = false; // Camera hotspots disabled (we use mouse now)

// Motion detection (adaptive baseline)
let baselineFrame;
let diffFrame; // for baseline diff visualization
let motionThreshold = 200; // initial
let thresholdScale = 2.0; // multiplier applied live
let motionMap; // Uint8Array at video resolution
let motionMapWidth = 0;
let motionMapHeight = 0;
let motionCountLast = 0;
let motionPixels = []; // canvas-sized debug/attraction map (populated by detectMotion)
let forceFieldRadius = 100;
let baselineUpdateRate = 0.05; // How much to blend new frame into baseline (0.5% per frame)

// Auto-calibration system
let isCalibrating = false;
let calibrationStartTime = 0;
let calibrationDuration = 8000; // 8 seconds
let calibrationSamples = [];
let autoThresholdScale = 2.0;
let baseMotionLevel = 0;
let ambientNoiseLevel = 0;
let lightingStability = 1.0;

// Sensitivity slider and controls
let sensitivityMode = 'auto'; // 'auto', 'manual'
let userSensitivity = 0.5; // 0-1 range
let sensitivitySlider = null;
let sensitivityUI = null;
let modeButton = null;
let statusDiv = null;

// Load user preferences
function loadUserPreferences() {
  try {
    let savedMode = localStorage.getItem('cosmic-sensitivity-mode');
    let savedValue = localStorage.getItem('cosmic-sensitivity-value');
    
    if (savedMode) sensitivityMode = savedMode;
    if (savedValue) userSensitivity = parseFloat(savedValue);
  } catch (e) {
    console.log('Unable to load preferences:', e);
  }
}

// Save user preferences
function saveUserPreferences() {
  try {
    localStorage.setItem('cosmic-sensitivity-mode', sensitivityMode);
    localStorage.setItem('cosmic-sensitivity-value', userSensitivity.toString());
  } catch (e) {
    console.log('Unable to save preferences:', e);
  }
}

// Hotspot attraction parameters
let hotspotInfluenceRadius = 280; // px - wider grip for smoother capture
let hotspotAttractionStrength = 0.12; // base spring strength
let hotspotInnerRadius = 28; // smaller soft core so they stay inside
let hotspotMaxForce = 0.4; // allow stronger net force before clamp
let hotspotBlendCount = 3; // consider N nearest hotspots
let hotspotSwirlStrength = 0.1; // baseline swirl
let hotspotDamping = 0.08; // damp radial velocity so particles settle, not jitter
let orbitSwirlBase = 0.22; // swirl strength near center
let orbitSwirlMin = 0.06; // swirl strength near edge
let orbitJitter = 0.03; // subtle variation to avoid lockstep
let hotspotUpdateModulo = 2; // update particle attraction every N frames
let maxActiveHotspots = 16; // cap hotspots considered globally per frame

// Speed damping near hotspots to make attraction more visible
let hotspotSpeedDamping = 0.35; // how much to slow down near hotspots (0=no slowdown, 1=full stop)
let hotspotDampingRadius = 180; // radius within which to apply speed damping
let hotspotCoreSpeedLimit = 1.5; // maximum speed when very close to hotspot center

// Hotspots prepared per frame for fast lookup
let activeHotspots = [];

// Motion tracking
let motionHotspots = []; // Areas of significant frame change
let hotspotThreshold = 50; // Lower threshold for easier detection
let motionGridSize = 60; // grid size for hotspot aggregation (lower = more cells)
let minHotspotSize = 5; // Minimum number of motion pixels to form a hotspot

// Detection throttling (debug vs attraction)
let detectionIntervalDebug = 4;     // frames between detections when debug ON (~15 Hz)
let detectionIntervalHotspot = 10;  // when only attraction is ON (~6 Hz)
let detectionStepDebug = 4;         // pixel sampling step in debug
let detectionStepHotspot = 6;       // coarser sampling when only attraction

// Reusable hotspot grid buffers (to reduce GC churn)
let hotspotGridCols = 0;
let hotspotGridRows = 0;
let cellTotalMotionF32 = null; // Float32Array
let cellPixelCountU16 = null;  // Uint16Array
let cellMaxMotionF32 = null;   // Float32Array

function ensureHotspotGrid() {
  const gridSize = motionGridSize;
  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);
  if (cols !== hotspotGridCols || rows !== hotspotGridRows || !cellTotalMotionF32) {
    hotspotGridCols = cols;
    hotspotGridRows = rows;
    cellTotalMotionF32 = new Float32Array(cols * rows);
    cellPixelCountU16 = new Uint16Array(cols * rows);
    cellMaxMotionF32 = new Float32Array(cols * rows);
  } else {
    cellTotalMotionF32.fill(0);
    cellPixelCountU16.fill(0);
    cellMaxMotionF32.fill(0);
  }
}

function cleanupAfterDebug() {
  // Clear heavy debug buffers to help GC and restore performance
  if (motionPixels && motionPixels.length) motionPixels.fill(0);
  previousMotionPixels = [];
  motionVectors = [];
  // Keep hotspots if attraction is enabled; otherwise clear
  if (!useHotspotAttraction) {
    motionHotspots = [];
    activeHotspots = [];
  }
}

// Motion vectors (temporary direction indicators for fast motion)
let motionVectors = [];
let previousMotionPixels = []; // previous frame's motion map (canvas-sized)
let vectorDecay = 0.90; // how quickly vectors fade
let vectorLifetime = 24; // frames vectors remain visible
let vectorGridSize = 60; // cell size for computing coarse flow
let vectorMinCellCount = 10; // minimum active pixels in cell to consider
let fastMotionSpeed = 4; // px/frame required to spawn vector

// Webcam
let videoCapture;
let videoReady = false;
let cameraError = null;
let cameraPermissionDenied = false;

function setup() {
  // Minimal canvas setup for maximum performance
  pixelDensity(1);
  frameRate(60); // Higher framerate for smooth flocking
  let canvas = createCanvas(windowWidth, windowHeight);
  
  // Essential optimizations only
  canvas.parent('canvas-container');
  canvas.canvas.willReadFrequently = true;
  colorMode(HSB, 360, 255, 255); // HSB for simple color variation
  // Custom cursor: hide system cursor and disable right-click menu on canvas
  noCursor();
  if (canvas && canvas.elt) {
    canvas.elt.oncontextmenu = (e) => { e.preventDefault(); return false; };
  }

  // Initialize flow field and bodies
  initFlowField();
  initBodies();

  // Initialize background elements
  initBackgroundElements();

  // Initialize background elements
  // (We keep these for a beautiful luminous scene)
}

// Removed background initialization - focusing on particles only

// Initialize background visual elements (planets and nebula blobs)
function initBackgroundElements() {
  bgGradientTime = random(1000);

  // Create background planets (large, slow, low-alpha) - ensure 2-3 planets, no rings
  planetsBg = [];
  const base = min(width, height);
  const numPlanets = Math.floor(random(2, 4)); // Ensure 2-3 planets
  for (let i = 0; i < numPlanets; i++) {
    const radius = base * random(0.18, 0.34);
    const orbitRadius = base * random(0.35, 0.75);
    const speed = random(0.00006, 0.00018) * (random(1) < 0.5 ? -1 : 1);
    const angle = random(TAU);
    const hue = random(200, 320) + i * random(-40, 40);
    const sat = random(120, 180);
    const bri = random(110, 180);
    planetsBg.push({
      orbitCenter: createVector(width * 0.5 + random(-base * 0.1, base * 0.1), height * 0.5 + random(-base * 0.1, base * 0.1)),
      orbitRadius,
      angle,
      speed,
      radius,
      hue,
      sat,
      bri,
      ring: true, // Always have rings for visual interest
      ringTilt: random(-PI/5, PI/5),
      ringAlpha: random(30, 70),
      phase: random(TAU)
    });
  }

  // Create nebula blobs
  nebulaBlobs = [];
  const numBlobs = 6;
  for (let i = 0; i < numBlobs; i++) {
    const r = base * random(0.25, 0.5);
    nebulaBlobs.push({
      x: random(width),
      y: random(height),
      baseRadius: r,
      hue: (random(180, 300) + i * 12) % 360,
      alpha: random(30, 70),
      driftX: random(-0.08, 0.08),
      driftY: random(-0.04, 0.04),
      wobbleSpeed: random(0.0005, 0.0012),
      wobbleAmp: random(0.04, 0.12)
    });
  }
}

// Completely clears the canvas pixel buffer (avoids cumulative blending artifacts)
function hardClearCanvas() {
  push();
  const ctx = drawingContext;
  // Reset any transforms before clearing
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  pop();
}

// Custom cursor: soft nebula around the pointer
function drawCustomCursor() {
  const x = mouseX;
  const y = mouseY;
  if (x < 0 || y < 0 || x > width || y > height) return;
  push();
  noStroke();
  const hue = (220 + 40 * sin(millis() * 0.0015)) % 360;
  // outer glow
  fill(hue, 120, 200, 24);
  circle(x, y, 42);
  // mid glow
  fill((hue + 30) % 360, 160, 255, 40);
  circle(x, y, 28);
  // core
  fill((hue + 60) % 360, 200, 255, 120);
  circle(x, y, 8);
  pop();
}

// Convert p5 color to rgba() string for Canvas gradients
function colorToRgba(c) {
  const r = red(c) | 0;
  const g = green(c) | 0;
  const b = blue(c) | 0;
  const a = (alpha(c) / 255).toFixed(3);
  return `rgba(${r},${g},${b},${a})`;
}

// Draw a smooth linear gradient background that evolves over time
function drawBackgroundGradient() {
  bgGradientTime += 0.0025;
  const t = bgGradientTime;
  const h1 = (220 + 40 * sin(t * 0.6)) % 360;
  const h2 = (300 + 50 * cos(t * 0.4)) % 360;
  const c1 = color(h1, 120, 40 + 10 * sin(t * 0.7), 255);
  const c2 = color(h2, 120, 20 + 8 * cos(t * 0.5), 255);

  push();
  noStroke();
  const ctx = drawingContext;
  // Slowly rotate gradient direction over time
  const ang = t * 0.15;
  const rr = max(width, height);
  const x1 = width * 0.5 + cos(ang) * rr;
  const y1 = height * 0.5 + sin(ang) * rr;
  const x2 = width * 0.5 - cos(ang) * rr;
  const y2 = height * 0.5 - sin(ang) * rr;
  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  grad.addColorStop(0, colorToRgba(c1));
  grad.addColorStop(1, colorToRgba(c2));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  pop();
}

// Helper: fill a circle with a radial gradient
function fillCircleRadialGradient(x, y, radius, innerC, outerC, innerOffset = 0.25) {
  const ctx = drawingContext;
  const grad = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.25, radius * innerOffset, x, y, radius);
  grad.addColorStop(0, colorToRgba(innerC));
  grad.addColorStop(1, colorToRgba(outerC));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

// Draw large, slow-moving background planets
function drawBackgroundPlanets() {
  push();
  noStroke();
  for (let p of planetsBg) {
    p.angle += p.speed;
    const px = p.orbitCenter.x + cos(p.angle) * p.orbitRadius;
    const py = p.orbitCenter.y + sin(p.angle) * p.orbitRadius;

    // Gentle breathing radius change
    const t = millis() * 0.001;
    const breath = 1 + 0.025 * sin(t * 0.4 + p.phase);
    const pr = p.radius * breath;

    // Planet body with soft highlight
    const inner = color(p.hue, p.sat, min(255, p.bri + 30), 120);
    const outer = color(p.hue, p.sat * 0.8, p.bri * 0.5, 90);
    fillCircleRadialGradient(px, py, pr, inner, outer, 0.15);

    // Subtle atmosphere glow
    push();
    stroke(p.hue, p.sat, 220, 30);
    strokeWeight(4);
    noFill();
    circle(px, py, pr * 2.1);
    pop();

    // Planet rings - always draw rings for visual interest
    if (p.ring) {
      push();
      translate(px, py);
      rotate(p.ringTilt + 0.08 * sin(t * 0.3 + p.phase));
      stroke(p.hue, 80, 220, p.ringAlpha);
      noFill();
      strokeWeight(2);
      ellipse(0, 0, pr * 2.6, pr * 1.1);
      strokeWeight(1);
      stroke(p.hue, 60, 180, p.ringAlpha * 0.7);
      ellipse(0, 0, pr * 2.2, pr * 0.9);
      pop();
    }
  }
  pop();
}

// Draw drifting nebula blobs using radial gradients
function drawNebulaBlobs() {
  push();
  for (let b of nebulaBlobs) {
    // Wobble radius
    const wobble = 1 + b.wobbleAmp * sin(millis() * b.wobbleSpeed + b.x * 0.01 + b.y * 0.01);
    const r = b.baseRadius * wobble;

    // Drift plus tiny center swirl to keep it alive
    const cx = width * 0.5, cy = height * 0.5;
    const dx = b.x - cx, dy = b.y - cy;
    const dist = max(1, sqrt(dx * dx + dy * dy));
    const tx = -dy / dist; // tangential direction (perpendicular)
    const ty = dx / dist;
    const swirlSpeed = 0.03; // px/frame
    b.x += b.driftX + tx * swirlSpeed;
    b.y += b.driftY + ty * swirlSpeed;
    if (b.x < -r) b.x = width + r;
    if (b.x > width + r) b.x = -r;
    if (b.y < -r) b.y = height + r;
    if (b.y > height + r) b.y = -r;

    // Multi-layered gradient for depth
    const inner = color((b.hue + 10) % 360, 180, 200, b.alpha);
    const mid = color((b.hue + 40) % 360, 140, 120, b.alpha * 0.8);
    const outer = color((b.hue + 60) % 360, 90, 60, b.alpha * 0.5);

    // Draw three concentric gradients for a richer nebula
    fillCircleRadialGradient(b.x - r * 0.08, b.y - r * 0.08, r * 0.85, inner, mid, 0.08);
    fillCircleRadialGradient(b.x, b.y, r, mid, outer, 0.12);
    fillCircleRadialGradient(b.x + r * 0.05, b.y + r * 0.03, r * 1.15, outer, color((b.hue + 80) % 360, 60, 30, b.alpha * 0.35), 0.2);
  }
  pop();
}

// Flow field utilities
function initFlowField() {
  flowCols = ceil(width / flowFieldScale);
  flowRows = ceil(height / flowFieldScale);
  flowZ = random(1000);
}

function updateFlowField() {
  flowZ += flowZInc;
}

function sampleFlowAt(x, y) {
  const nx = x / flowFieldScale;
  const ny = y / flowFieldScale;
  const n = noise(nx, ny, flowZ);
  const angle = n * TAU * 2.0; // broad directional variety
  return p5.Vector.fromAngle(angle);
}

// Bodies system
class Body {
  constructor(x, y, isLarge = false) {
    this.pos = createVector(x, y);
    this.prev = this.pos.copy();
    this.vel = p5.Vector.random2D().mult(0.5);
    this.acc = createVector(0, 0);
    this.isLarge = isLarge;
    this.size = isLarge ? random(10, 26) : random(1.6, 3.4);
    this.maxSpeed = isLarge ? random(0.8, 1.6) : random(1.8, 3.2);
    this.maxForce = isLarge ? 0.035 : 0.065;
    const baseHue = random([200, 220, 260, 300, 320]);
    this.hue = (baseHue + random(-24, 24)) % 360;
    this.alpha = isLarge ? 120 : 180;
  }

  applyForce(f) { this.acc.add(f); }

  followFlow() {
    const dir = sampleFlowAt(this.pos.x, this.pos.y);
    const desired = p5.Vector.mult(dir, this.maxSpeed);
    const steer = p5.Vector.sub(desired, this.vel).limit(this.maxForce);
    this.applyForce(steer);
  }

  applyAttractor() {
    if (!attractor.active || attractor.strength === 0) return;
    const dx = attractor.x - this.pos.x;
    const dy = attractor.y - this.pos.y;
    const d = max(1, sqrt(dx * dx + dy * dy));
    const radius = this.isLarge ? 280 : 200;
    if (d > radius * 1.5) return;
    const dir = createVector(dx / d, dy / d);
    const t = 1 - min(d / radius, 1);
    const falloff = t * t * (3 - 2 * t);
    const influence = (this.isLarge ? 0.35 : 0.55) * attractor.strength;
    const radial = p5.Vector.mult(dir, influence * falloff);
    // Keep motion graceful: only a fraction of current speed redirected
    this.applyForce(radial.limit(this.maxForce * 1.6));
  }

  applyMouseDynamics() {
    // Influence radius expands slightly with speed for dramatic flings
    const radius = mouseInfluenceBaseRadius * (1 + constrain((mouseSpeedSmoothed - slowSpeedThreshold) / (fastSpeedThreshold * 1.5), 0, 1));
    const dx = mouseX - this.pos.x;
    const dy = mouseY - this.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) return;
    const d = sqrt(d2);
    if (d > radius) return;

    const dir = createVector(dx / d, dy / d);
    const t = 1 - min(d / radius, 1);
    const falloff = t * t * (3 - 2 * t);

    if (mouseSpeedSmoothed <= slowSpeedThreshold) {
      // Slow movement: gentle attraction like guiding dust
      const k = this.isLarge ? 0.04 : 0.08;
      const f = p5.Vector.mult(dir, k * falloff);
      this.applyForce(f.limit(this.maxForce));
    } else if (mouseSpeedSmoothed >= fastSpeedThreshold) {
      // Fast movement: fling away (repulsive impulse) proportional to speed
      const repelStrength = map(mouseSpeedSmoothed, fastSpeedThreshold, fastSpeedThreshold * 2.5, 0.6, 1.8, true);
      const away = p5.Vector.mult(dir, -repelStrength * falloff);
      this.applyForce(away.limit(this.maxForce * 3));
    } else {
      // Mid range: mostly follow with slight outward turbulence
      const followFactor = map(mouseSpeedSmoothed, slowSpeedThreshold, fastSpeedThreshold, 0.08, 0.02, true);
      const f = p5.Vector.mult(dir, followFactor * falloff);
      const jitter = p5.Vector.random2D().mult(0.04 * falloff);
      f.add(jitter);
      this.applyForce(f.limit(this.maxForce * 1.2));
    }
  }

  update() {
    this.prev.set(this.pos);
    // Gentle per-body noise drift for living feel
    const jitter = noise(this.pos.x * 0.005, this.pos.y * 0.005, frameCount * 0.01) - 0.5;
    this.applyForce(p5.Vector.random2D().mult(jitter * (this.isLarge ? 0.02 : 0.04)));

    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
  }

  display() {
    if (this.isLarge) {
      noStroke();
      // soft glow
      fill(this.hue, 140, 220, 26);
      circle(this.pos.x, this.pos.y, this.size * 3.2);
      fill(this.hue, 160, 240, 46);
      circle(this.pos.x, this.pos.y, this.size * 2.2);
      // core
      fill(this.hue, 180, 255, 120);
      circle(this.pos.x, this.pos.y, this.size);
      // subtle ring
      stroke(this.hue, 120, 220, 40);
      strokeWeight(1);
      noFill();
      rotate(0);
      ellipse(this.pos.x, this.pos.y, this.size * 2.8, this.size * 1.4);
    } else {
      // dust glow
      noStroke();
      fill(this.hue, 140, 255, 24);
      circle(this.pos.x, this.pos.y, this.size * 2.0);
      fill(this.hue, 180, 255, this.alpha);
      circle(this.pos.x, this.pos.y, this.size);
    }
  }

  isOffscreen() {
    const m = 12;
    return this.pos.x < -m || this.pos.x > width + m || this.pos.y < -m || this.pos.y > height + m;
  }
}

function spawnBody(isLarge = false) {
  const edge = floor(random(4));
  let x, y;
  if (edge === 0) { x = random(width); y = -10; }
  else if (edge === 1) { x = width + 10; y = random(height); }
  else if (edge === 2) { x = random(width); y = height + 10; }
  else { x = -10; y = random(height); }
  const b = new Body(x, y, isLarge);
  // Nudge along local flow so it enters nicely
  const dir = sampleFlowAt(x, y);
  b.vel = dir.mult(b.maxSpeed * random(0.6, 1.0));
  return b;
}

function initBodies() {
  bodies = [];
  for (let i = 0; i < numSmallBodies; i++) bodies.push(spawnBody(false));
  for (let i = 0; i < numLargeBodies; i++) bodies.push(spawnBody(true));
}

function initializeCamera() {
  
  
  // Reset camera state
  videoReady = false;
  cameraError = null;
  cameraPermissionDenied = false;
  
  try {
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraError = 'Camera not supported by this browser';
      
      return;
    }

    const constraints = {
      video: { 
        width: { ideal: 320, max: 640 }, 
        height: { ideal: 240, max: 480 }, 
        facingMode: 'user'
      },
      audio: false
    };
    
    
    
    // First test getUserMedia directly to catch permission errors
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        
        
        // Now create p5 capture
        videoCapture = createCapture(constraints, videoSuccess);
        
        if (videoCapture && videoCapture.elt) {
          videoCapture.size(320, 240);
          videoCapture.hide();
          videoCapture.elt.setAttribute('playsinline', '');
          videoCapture.elt.muted = true;
          videoCapture.elt.autoplay = true;
          
          videoCapture.elt.addEventListener('loadeddata', () => {
            
            // Create baseline and diff frames that MATCH THE VIDEO RESOLUTION
            baselineFrame = createImage(videoCapture.width, videoCapture.height);
            diffFrame = createImage(videoCapture.width, videoCapture.height);
            motionMapWidth = videoCapture.width;
            motionMapHeight = videoCapture.height;
            motionMap = new Uint8Array(motionMapWidth * motionMapHeight);
            // Seed baseline with the first frame to avoid garbage
            videoCapture.loadPixels();
            baselineFrame.loadPixels();
            for (let i = 0; i < baselineFrame.pixels.length; i++) {
              baselineFrame.pixels[i] = videoCapture.pixels[i] || 0;
            }
            baselineFrame.updatePixels();
            videoReady = true;
          });
          
          videoCapture.elt.addEventListener('canplay', () => {
            
            videoReady = true;
          });
          
          videoCapture.elt.addEventListener('error', (e) => {
            
            cameraError = 'Video element error';
          });
        }
        
        // Stop the test stream
        stream.getTracks().forEach(track => track.stop());
      })
      .catch(error => {
        
        handleCameraError(error);
      });
      
  } catch (error) {
    
    cameraError = 'Camera initialization failed: ' + error.message;
  }
}

function handleCameraError(error) {
  
  
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    cameraPermissionDenied = true;
    cameraError = 'Camera permission denied. Please allow camera access and refresh.';
  } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    cameraError = 'No camera device found.';
  } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    cameraError = 'Camera is being used by another application.';
  } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
    cameraError = 'Camera constraints not supported.';
  } else {
    cameraError = 'Camera access failed: ' + (error.message || error.name || 'Unknown error');
  }
}

function videoSuccess(stream) {
  
  videoReady = true;
  cameraError = null;
  cameraPermissionDenied = false;
  
  // Start auto-calibration when camera is ready
  startAutoCalibration();
}

function draw() {
  // Clear frame fully
  hardClearCanvas();

  // Space background
  blendMode(BLEND);
  drawBackgroundGradient();
  drawBackgroundPlanets();
  drawNebulaBlobs();

  // Update flow field
  updateFlowField();

  // Update smoothed mouse speed
  const dx = (movedX || 0);
  const dy = (movedY || 0);
  const instSpeed = sqrt(dx * dx + dy * dy);
  mouseSpeedSmoothed = lerp(mouseSpeedSmoothed, instSpeed, 0.15);

  // Update attractor pulse
  if (attractor.active) {
    if (!mouseIsPressed) {
      attractor.life = max(0, attractor.life - 1);
      if (attractor.life === 0) attractor.active = false;
      attractor.strength *= 0.96;
      if (abs(attractor.strength) < 0.02) attractor.strength = 0;
    } else {
      attractor.x = mouseX;
      attractor.y = mouseY;
    }
  }

  // Bodies update/render
  push();
  blendMode(ADD);
  for (let i = bodies.length - 1; i >= 0; i--) {
    let b = bodies[i];
    b.followFlow();
    b.applyMouseDynamics();
    b.applyAttractor();
    b.update();
    b.display();
    if (b.isOffscreen()) {
      bodies.splice(i, 1);
      bodies.push(spawnBody(b.isLarge));
    }
  }
  pop();

  // Custom nebulous cursor
  drawCustomCursor();

  drawInstructions();
}

// Mouse interaction: left click = attract, right click = repel
function mousePressed() {
  attractor.active = true;
  attractor.x = mouseX;
  attractor.y = mouseY;
  const isRight = mouseButton === RIGHT;
  const isMiddle = mouseButton === CENTER;
  attractor.strength = (isRight || isMiddle) ? -1 : 1; // negative = repulse
  attractor.life = 60; // frames to linger
  return false; // prevent default context menu on right click in some hosts
}

function mouseReleased() {
  // Let the pulse fade instead of hard stop
  attractor.life = 30;
}

// Keyboard controls for debugging
function keyPressed() {
  if (key === 'c' || key === 'C') {
    // Re-initialize bodies
    initBodies();
  } else if (key === ' ') {
    // Spawn a large body at mouse
    bodies.push(new Body(mouseX, mouseY, true));
  }
}

function retryCamera() {
  // Stop existing camera if any
  if (videoCapture && videoCapture.elt) {
    if (videoCapture.elt.srcObject) {
      videoCapture.elt.srcObject.getTracks().forEach(track => track.stop());
    }
    videoCapture.elt.srcObject = null;
    videoCapture.remove();
  }
  
  // Reset variables
  videoCapture = null;
  videoReady = false;
  cameraError = null;
  cameraPermissionDenied = false;
  
  // Small delay to ensure cleanup
  setTimeout(() => {
    initializeCamera();
  }, 100);
}

// Minimal, high-performance particle class
class Particle {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.vel = createVector(random(-1, 1), random(-1, 1));
    this.acc = createVector(0, 0);
    this.maxSpeed = 5;
    this.maxForce = 0.05;

    // Fixed flocking parameters for consistency
    this.separationRadius = 25;
    this.alignmentRadius = 50;
    this.cohesionRadius = 50;

    // Simple visual properties
    this.hue = random(360); // Use HSB for simple color variation
  }

  // Flocking behavior - simplified
  flock(particles) {
    let sep = this.separate(particles);
    let ali = this.align(particles);
    let coh = this.cohesion(particles);

    // Weight the forces
    sep.mult(1.5);
    ali.mult(1.0);
    coh.mult(1.0);

    // Apply forces
    this.applyForce(sep);
    this.applyForce(ali);
    this.applyForce(coh);
  }

  // Separation - steer to avoid crowding local flockmates (subsampled)
  separate(particles) {
    let steer = createVector(0, 0);
    let count = 0;

    // Sample every 2nd neighbor for performance
    for (let i = 0; i < particles.length; i += 2) {
      let other = particles[i];
      let d = p5.Vector.dist(this.pos, other.pos);
      if (d > 0 && d < this.separationRadius) {
        let diff = p5.Vector.sub(this.pos, other.pos);
        diff.normalize();
        diff.div(d); // Weight by distance
        steer.add(diff);
        count++;
      }
    }

    if (count > 0) {
      steer.div(count);
    }

    if (steer.mag() > 0) {
      steer.normalize();
      steer.mult(this.maxSpeed);
      steer.sub(this.vel);
      steer.limit(this.maxForce);
    }

    return steer;
  }

  // Alignment - steer towards the average heading of neighbors (subsampled)
  align(particles) {
    let sum = createVector(0, 0);
    let count = 0;

    for (let i = 0; i < particles.length; i += 3) {
      let other = particles[i];
      let d = p5.Vector.dist(this.pos, other.pos);
      if (d > 0 && d < this.alignmentRadius) {
        sum.add(other.vel);
        count++;
      }
    }

    if (count > 0) {
      sum.div(count);
      sum.normalize();
      sum.mult(this.maxSpeed);
      let steer = p5.Vector.sub(sum, this.vel);
      steer.limit(this.maxForce);
      return steer;
    }

    return createVector(0, 0);
  }

  // Cohesion - steer to move toward the average position of neighbors (subsampled)
  cohesion(particles) {
    let sum = createVector(0, 0);
    let count = 0;

    for (let i = 0; i < particles.length; i += 3) {
      let other = particles[i];
      let d = p5.Vector.dist(this.pos, other.pos);
      if (d > 0 && d < this.cohesionRadius) {
        sum.add(other.pos);
        count++;
      }
    }

    if (count > 0) {
      sum.div(count);
      return this.seek(sum);
    }

    return createVector(0, 0);
  }

  seek(target) {
    let desired = p5.Vector.sub(target, this.pos);
    desired.normalize();
    desired.mult(this.maxSpeed);
    let steer = p5.Vector.sub(desired, this.vel);
    steer.limit(this.maxForce);
    return steer;
  }

  // Attraction to motion hotspots (blend of nearest hotspots with soft core)
  applyHotspotAttractionFast() {
    if (!activeHotspots || activeHotspots.length === 0) return;

    // Gather nearby hotspots
    let nearby = [];
    // Loop through capped, pre-sorted hotspots
    for (let h of activeHotspots) {
      // Mirror-aware dx: hotspots are placed in screen coords already mirrored
      let dx = h.x - this.pos.x;
      let dy = h.y - this.pos.y;
      let d = sqrt(dx * dx + dy * dy);
      if (d <= hotspotInfluenceRadius) {
        nearby.push({ h, d, dx, dy });
      }
    }
    if (nearby.length === 0) return;

    // Sort by distance; use top N
    nearby.sort((a, b) => a.d - b.d);
    let count = hotspotBlendCount < nearby.length ? hotspotBlendCount : nearby.length;

    let totalForce = createVector(0, 0);
    for (let i = 0; i < count; i++) {
      let { h, d, dx, dy } = nearby[i];
      if (d < 1) continue;

      // Radial attraction with soft-core repulsion near the center
      let dir = createVector(dx / d, dy / d);
      let intensity = h.intensity || 1;

      // Falloff: smoothstep on (d / R)
      let t = 1 - d / hotspotInfluenceRadius;
      if (t < 0) t = 0;
      let falloff = t * t * (3 - 2 * t); // smoothstep

      // Soft core: repel within inner radius
      let core = 0;
      if (d < hotspotInnerRadius) {
        core = -((hotspotInnerRadius - d) / hotspotInnerRadius);
      }

      // Swirl: tangential orbit to keep motion lively
      // Stronger swirl near center, gentle near edge
      let swirlT = orbitSwirlMin + (orbitSwirlBase - orbitSwirlMin) * falloff;
      let tangent = createVector(-dir.y, dir.x); // rotate 90 deg
      tangent.mult((hotspotSwirlStrength + swirlT) * (1 + random(-orbitJitter, orbitJitter)));

      // Stronger radial pull that increases when already inside the hotspot
      let insideBoost = d < hotspotInfluenceRadius * 0.5 ? 1.4 : 1.0;
      let radialStrength = hotspotAttractionStrength * falloff * intensity * insideBoost;
      let radial = p5.Vector.mult(dir, radialStrength + core);

      let force = p5.Vector.add(radial, tangent);
      totalForce.add(force);
    }

    // Limit the net hotspot force so flocking still matters
    // Damp radial component of current velocity to keep graceful motion
    // Project velocity onto dir and damp that component only (spring-damper feel)
    let velAlong = p5.Vector.dot(this.vel, totalForce.copy().normalize());
    if (velAlong > 0) {
      totalForce.sub(totalForce.copy().normalize().mult(velAlong * hotspotDamping));
    }
    if (totalForce.magSq() > hotspotMaxForce * hotspotMaxForce) totalForce.limit(hotspotMaxForce);
    this.applyForce(totalForce);
  }

  // Apply speed damping when near hotspots to make attraction more visible
  applyHotspotSpeedDamping() {
    if (!useHotspotAttraction || !activeHotspots || activeHotspots.length === 0) return;
    
    let totalDamping = 0;
    let closestDistance = Infinity;
    
    // Check distance to all active hotspots
    for (let h of activeHotspots) {
      let dx = h.x - this.pos.x;
      let dy = h.y - this.pos.y;
      let distance = sqrt(dx * dx + dy * dy);
      
      if (distance < hotspotDampingRadius) {
        // Calculate damping based on distance (closer = more damping)
        let dampingFactor = 1 - (distance / hotspotDampingRadius);
        dampingFactor = dampingFactor * dampingFactor; // Quadratic falloff
        
        // Weight by hotspot intensity
        let intensity = h.intensity || 1;
        let normalizedIntensity = min(intensity / 100, 1.5); // normalize and cap
        
        totalDamping += dampingFactor * normalizedIntensity;
        closestDistance = min(closestDistance, distance);
      }
    }
    
    if (totalDamping > 0) {
      // Cap total damping to prevent particles from stopping completely
      totalDamping = min(totalDamping, hotspotSpeedDamping);
      
      // Apply damping to velocity
      let dampingMultiplier = 1 - totalDamping;
      this.vel.mult(dampingMultiplier);
      
      // Extra speed limiting when very close to hotspot centers
      if (closestDistance < hotspotInnerRadius * 2) {
        let currentSpeed = this.vel.mag();
        if (currentSpeed > hotspotCoreSpeedLimit) {
          this.vel.normalize();
          this.vel.mult(hotspotCoreSpeedLimit);
        }
      }
    }
  }

  applyForce(force) {
    this.acc.add(force);
  }

  update() {
    this.vel.add(this.acc);
    
    // Apply hotspot speed damping before limiting speed
    this.applyHotspotSpeedDamping();
    
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);

    // Wrap around edges
    if (this.pos.x > width) this.pos.x = 0;
    if (this.pos.x < 0) this.pos.x = width;
    if (this.pos.y > height) this.pos.y = 0;
    if (this.pos.y < 0) this.pos.y = height;
  }

  display() {
    // Triangular particle (works well with ADD blend mode)
    push();
    translate(this.pos.x, this.pos.y);
    
    // Rotate triangle based on velocity direction for dynamic look
    let angle = atan2(this.vel.y, this.vel.x);
    rotate(angle);
    
    // Draw glowing triangle
    fill(this.hue, 255, 200, 120);
    stroke(this.hue, 255, 255, 180);
    strokeWeight(1);
    
    let size = particleSize * 3; // Make triangles bigger
    triangle(size, 0, -size/2, -size/2, -size/2, size/2);
    pop();
  }
}

// Background functions removed - focusing on particle performance

// Slowly adaptive baseline that adjusts to lighting changes
function updateAdaptiveBaseline() {
  if (!videoReady || !videoCapture) return;

  // Ensure frames exist and match the video resolution
  if (!baselineFrame || baselineFrame.width !== videoCapture.width || baselineFrame.height !== videoCapture.height) {
    baselineFrame = createImage(videoCapture.width, videoCapture.height);
    baselineFrame.copy(videoCapture, 0, 0, videoCapture.width, videoCapture.height, 0, 0, videoCapture.width, videoCapture.height);
  }

  // Ensure frames exist and match the video resolution
  if (!baselineFrame || baselineFrame.width !== videoCapture.width || baselineFrame.height !== videoCapture.height) {
    baselineFrame = createImage(videoCapture.width, videoCapture.height);
    baselineFrame.copy(videoCapture, 0, 0, videoCapture.width, videoCapture.height, 0, 0, videoCapture.width, videoCapture.height);
  }

  videoCapture.loadPixels();
  baselineFrame.loadPixels();

  // Blend current frame into baseline very slowly
  for (let i = 0; i < baselineFrame.pixels.length; i++) {
    let currentValue = videoCapture.pixels[i];
    let baselineValue = baselineFrame.pixels[i];
    
    // Weighted average: baseline = baseline * (1 - rate) + current * rate
    baselineFrame.pixels[i] = baselineValue * (1 - baselineUpdateRate) + currentValue * baselineUpdateRate;
  }
  
  baselineFrame.updatePixels();
}

// Manual baseline update (for B key)
function updateBaselineFrame() {
  if (videoReady && videoCapture) {
    videoCapture.loadPixels();
    baselineFrame.copy(videoCapture, 0, 0, videoCapture.width, videoCapture.height, 0, 0, videoCapture.width, videoCapture.height);
    

    // Also reset motion pixels to avoid ghosting
    if (motionPixels && motionPixels.length) motionPixels.fill(0);
    motionHotspots = [];
  }
}

// Edge-based motion detection - more robust to lighting and auto-exposure
function detectMotion(stepOverride) {
  if (!videoReady || !videoCapture) return;

  videoCapture.loadPixels();
  baselineFrame.loadPixels();

  // Clear motion pixels (canvas-sized debug map)
  if (!motionPixels || motionPixels.length !== width * height) {
    motionPixels = new Array(width * height).fill(0);
  } else {
    motionPixels.fill(0);
  }

  let step = stepOverride || 4; // sampling step
  let totalMotionCount = 0;
  let sampleCount = 0;

  // Prepare reusable hotspot aggregation grid
  ensureHotspotGrid();
  const gridSize = motionGridSize;
  const cols = hotspotGridCols;
  const rows = hotspotGridRows;

  for (let x = step; x < videoCapture.width - step; x += step) {
    for (let y = step; y < videoCapture.height - step; y += step) {
      let index = (x + y * videoCapture.width) * 4;

      // Check if index is valid
      if (index >= videoCapture.pixels.length) continue;

      // Calculate edge strength for current frame
      let currEdge = calculateEdgeStrength(videoCapture.pixels, x, y, videoCapture.width);
      
      // Calculate edge strength for baseline frame
      let baseEdge = calculateEdgeStrength(baselineFrame.pixels, x, y, videoCapture.width);

      // Motion is change in edge patterns, not absolute color changes
      let edgeDiff = abs(currEdge - baseEdge);

      // Also check local texture change (neighboring pixel relationships)
      let textureChange = calculateTextureChange(videoCapture.pixels, baselineFrame.pixels, x, y, videoCapture.width);

      // Combine edge and texture changes
      let motionValue = (edgeDiff * 0.7 + textureChange * 0.3);

      // Adaptive threshold based on local contrast
      let localContrast = calculateLocalContrast(videoCapture.pixels, x, y, videoCapture.width);
      let adaptiveThreshold = map(localContrast, 0, 100, 5, 25); // Lower threshold for low contrast areas

      // Only register as motion if above adaptive threshold
      if (motionValue > adaptiveThreshold * thresholdScale) {
        // Write to canvas-sized debug map (scaled, MIRRORED horizontally)
        let canvasX = width - 1 - ((x * width / videoCapture.width) | 0);
        let canvasY = (y * height / videoCapture.height) | 0;
        let motionIndex = canvasX + canvasY * width;
        if (motionIndex >= 0 && motionIndex < motionPixels.length) {
          motionPixels[motionIndex] = motionValue;
          totalMotionCount++;

          // Aggregate into grid cell
          const c = Math.floor(canvasX / gridSize);
          const r = Math.floor(canvasY / gridSize);
          const ci = c + r * cols;
          cellTotalMotionF32[ci] += motionValue;
          cellPixelCountU16[ci]++;
          if (motionValue > cellMaxMotionF32[ci]) cellMaxMotionF32[ci] = motionValue;
        }
      }

      sampleCount++;
    }
  }

  // Log motion info occasionally
  if (frameCount % 120 === 0 && sampleCount > 0) { // Every 2 seconds
    let motionPercentage = (totalMotionCount / sampleCount) * 100;
    
  }

  // Build hotspot list from aggregated grid (single pass)
  const hotspots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = c + r * cols;
      const count = cellPixelCountU16[ci];
      const maxM = cellMaxMotionF32[ci];
      if (count >= minHotspotSize && maxM > hotspotThreshold) {
        const avgMotion = cellTotalMotionF32[ci] / count;
        hotspots.push({
          x: c * gridSize + gridSize / 2,
          y: r * gridSize + gridSize / 2,
          intensity: avgMotion,
          size: count,
          maxMotion: maxM
        });
      }
    }
  }

  // Prefer stronger hotspots first
  hotspots.sort((a, b) => b.intensity - a.intensity);
  motionHotspots = hotspots;
  activeHotspots = hotspots.length > maxActiveHotspots ? hotspots.slice(0, maxActiveHotspots) : hotspots;
}

// Calculate edge strength using simple gradient
function calculateEdgeStrength(pixels, x, y, width) {
  let centerIndex = (x + y * width) * 4;
  let rightIndex = ((x + 1) + y * width) * 4;
  let downIndex = (x + (y + 1) * width) * 4;

  if (rightIndex >= pixels.length || downIndex >= pixels.length) return 0;

  // Get grayscale values
  let centerGray = (pixels[centerIndex] + pixels[centerIndex + 1] + pixels[centerIndex + 2]) / 3;
  let rightGray = (pixels[rightIndex] + pixels[rightIndex + 1] + pixels[rightIndex + 2]) / 3;
  let downGray = (pixels[downIndex] + pixels[downIndex + 1] + pixels[downIndex + 2]) / 3;

  // Calculate gradients
  let gradX = abs(rightGray - centerGray);
  let gradY = abs(downGray - centerGray);

  return sqrt(gradX * gradX + gradY * gradY);
}

// Calculate texture change by comparing pixel relationships
function calculateTextureChange(currPixels, basePixels, x, y, width) {
  let totalChange = 0;
  let count = 0;

  // Check 3x3 neighborhood
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      let neighborX = x + dx;
      let neighborY = y + dy;

      if (neighborX >= 0 && neighborX < width && neighborY >= 0) {
        let centerIndex = (x + y * width) * 4;
        let neighborIndex = (neighborX + neighborY * width) * 4;

        if (neighborIndex < currPixels.length && centerIndex < currPixels.length) {
          // Current frame relationship
          let currCenter = (currPixels[centerIndex] + currPixels[centerIndex + 1] + currPixels[centerIndex + 2]) / 3;
          let currNeighbor = (currPixels[neighborIndex] + currPixels[neighborIndex + 1] + currPixels[neighborIndex + 2]) / 3;
          let currRelation = currCenter - currNeighbor;

          // Baseline frame relationship
          let baseCenter = (basePixels[centerIndex] + basePixels[centerIndex + 1] + basePixels[centerIndex + 2]) / 3;
          let baseNeighbor = (basePixels[neighborIndex] + basePixels[neighborIndex + 1] + basePixels[neighborIndex + 2]) / 3;
          let baseRelation = baseCenter - baseNeighbor;

          // Change in relationship
          totalChange += abs(currRelation - baseRelation);
          count++;
        }
      }
    }
  }

  return count > 0 ? totalChange / count : 0;
}

// Calculate local contrast to adapt threshold
function calculateLocalContrast(pixels, x, y, width) {
  let values = [];

  // Sample 3x3 neighborhood
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      let sampleX = x + dx;
      let sampleY = y + dy;

      if (sampleX >= 0 && sampleX < width && sampleY >= 0) {
        let index = (sampleX + sampleY * width) * 4;
        if (index < pixels.length) {
          let gray = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          values.push(gray);
        }
      }
    }
  }

  if (values.length < 2) return 0;

  // Calculate standard deviation as measure of local contrast
  let mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  let variance = values.reduce((sum, val) => sum + (val - mean) * (val - mean), 0) / values.length;
  
  return sqrt(variance);
}

// Calculate motion hotspots (areas of significant change)
// Calculate motion hotspots (areas of significant frame change)
function calculateMotionHotspots() {
  motionHotspots = [];

  // Simple approach: find areas with significant motion
  let minHotspotSize = 5; // Minimum number of motion pixels to form a hotspot

  // Use a grid approach but much simpler
  let gridSize = 50; // Size of each hotspot area

  for (let gridX = 0; gridX < width; gridX += gridSize) {
    for (let gridY = 0; gridY < height; gridY += gridSize) {

      let totalMotion = 0;
      let pixelCount = 0;
      let maxMotion = 0;

      // Check all pixels in this grid cell
      for (let x = gridX; x < min(gridX + gridSize, width); x++) {
        for (let y = gridY; y < min(gridY + gridSize, height); y++) {
          let index = x + y * width;
          if (index < motionPixels.length) {
            let motionValue = motionPixels[index];
            if (motionValue > 0) {
              totalMotion += motionValue;
              pixelCount++;
              if (motionValue > maxMotion) maxMotion = motionValue;
            }
          }
        }
      }

      // Create hotspot if there's significant motion
      if (pixelCount >= minHotspotSize && maxMotion > hotspotThreshold) {
        let avgMotion = totalMotion / pixelCount;
        motionHotspots.push({
          x: gridX + gridSize/2,
          y: gridY + gridSize/2,
          intensity: avgMotion,
          size: pixelCount,
          maxMotion: maxMotion
        });
      }
    }
  }
}

// Calculate motion vectors based on motion shift between consecutive frames
function calculateMotionVectors() {
  // Decay existing vectors and remove expired
  for (let i = motionVectors.length - 1; i >= 0; i--) {
    let v = motionVectors[i];
    v.magnitude *= vectorDecay;
    v.life -= 1;
    if (v.life <= 0 || v.magnitude < 0.5) motionVectors.splice(i, 1);
  }

  // Ensure previousMotionPixels exists and is canvas-sized
  if (!previousMotionPixels.length || previousMotionPixels.length !== width * height) {
    previousMotionPixels = new Array(width * height).fill(0);
  }

  // Coarse grid to detect local flow
  let cols = ceil(width / vectorGridSize);
  let rows = ceil(height / vectorGridSize);
  let cellData = new Array(cols * rows).fill(null).map(() => ({
    x: 0, y: 0, dx: 0, dy: 0, count: 0
  }));

  // Sample a subset of pixels for efficiency
  const step = 4;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      let idx = x + y * width;
      if (motionPixels[idx] <= motionThreshold) continue;

      // Search small neighborhood in previous map to estimate shift
      let bestDx = 0, bestDy = 0, bestVal = 0;
      for (let dy = -8; dy <= 8; dy += 4) {
        for (let dx = -8; dx <= 8; dx += 4) {
          let px = x + dx, py = y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          let pIdx = px + py * width;
          let val = previousMotionPixels[pIdx] || 0;
          if (val > bestVal) { bestVal = val; bestDx = dx; bestDy = dy; }
        }
      }

      if (bestVal > motionThreshold) {
        // Register flow into cell
        let c = floor(x / vectorGridSize);
        let r = floor(y / vectorGridSize);
        let ci = c + r * cols;
        let cell = cellData[ci];
        cell.x += x; cell.y += y; cell.dx += -bestDx; cell.dy += -bestDy; // direction where current moved from
        cell.count++;
      }
    }
  }

  // Convert cells to vectors
  for (let i = 0; i < cellData.length; i++) {
    let cell = cellData[i];
    if (cell.count >= vectorMinCellCount) {
      let cx = cell.x / cell.count;
      let cy = cell.y / cell.count;
      let dx = cell.dx / cell.count;
      let dy = cell.dy / cell.count;
      let mag = sqrt(dx * dx + dy * dy);
      if (mag >= fastMotionSpeed) {
        motionVectors.push({ x: cx, y: cy, dx, dy, magnitude: mag, life: vectorLifetime });
      }
    }
  }

  // Store current motion map for next frame comparison
  previousMotionPixels = motionPixels.slice();
}

// Draw motion vectors as arrows
function drawMotionVectors() {
  push();
  stroke(120, 180, 255, 200);
  fill(120, 180, 255, 200);
  strokeWeight(3);

  for (let v of motionVectors) {
    let len = constrain(v.magnitude, 8, 40);
    let endX = v.x + (v.dx) * 0.5;
    let endY = v.y + (v.dy) * 0.5;
    line(v.x, v.y, endX, endY);

    // Arrow head
    push();
    translate(endX, endY);
    let angle = atan2(v.dy, v.dx);
    rotate(angle);
    triangle(0, 0, -8, -4, -8, 4);
    pop();
  }

  pop();
}


// Draw motion hotspots as glowing circles
function drawMotionHotspots() {
  push();
    noFill();

  for (let hotspot of motionHotspots) {
    let alpha = map(hotspot.intensity, hotspotThreshold, 200, 40, 200);
    let size = map(hotspot.size, 1, 40, 18, 80);

    // Attraction radius preview (thin ring)
    stroke(120, 200, 120, 40);
    strokeWeight(1);
    circle(hotspot.x, hotspot.y, hotspotInfluenceRadius * 2);

    // Pulsing green core
    stroke(120, 255, 120, alpha);
    strokeWeight(3);
    circle(hotspot.x, hotspot.y, size + sin(millis() * 0.01) * 10);

    // Inner dot
    fill(120, 255, 120, alpha);
    noStroke();
    circle(hotspot.x, hotspot.y, 2);
  }

  pop();
}



// Draw baseline vs current frame difference for debugging - FIXED coordinate mapping
function drawBaselineDifference() {
  if (!videoReady || !videoCapture) return;

  // Make sure pixels are loaded
  videoCapture.loadPixels();
  baselineFrame.loadPixels();
  loadPixels();

  // Clear the canvas first
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0;     // R
    pixels[i + 1] = 0; // G
    pixels[i + 2] = 0; // B
    pixels[i + 3] = 255; // Alpha
  }

  // Sample directly from video resolution to avoid coordinate issues
  let stepX = max(1, floor(videoCapture.width / 200)); // Sample ~200 points horizontally
  let stepY = max(1, floor(videoCapture.height / 150)); // Sample ~150 points vertically

  for (let videoX = 0; videoX < videoCapture.width; videoX += stepX) {
    for (let videoY = 0; videoY < videoCapture.height; videoY += stepY) {
      let videoIndex = (videoX + videoY * videoCapture.width) * 4;

      // Check bounds
      if (videoIndex >= 0 && videoIndex + 2 < videoCapture.pixels.length && 
          videoIndex + 2 < baselineFrame.pixels.length) {
        
        // Get current and baseline colors
        let currR = videoCapture.pixels[videoIndex];
        let currG = videoCapture.pixels[videoIndex + 1];
        let currB = videoCapture.pixels[videoIndex + 2];

        let baseR = baselineFrame.pixels[videoIndex];
        let baseG = baselineFrame.pixels[videoIndex + 1];
        let baseB = baselineFrame.pixels[videoIndex + 2];

        // Calculate difference
        let diff = abs(currR - baseR) + abs(currG - baseG) + abs(currB - baseB);

        // Map to canvas coordinates
        let canvasX = floor(videoX * (width / videoCapture.width));
        let canvasY = floor(videoY * (height / videoCapture.height));

        // Ensure canvas coordinates are valid
        if (canvasX >= 0 && canvasX < width && canvasY >= 0 && canvasY < height) {
          // Draw difference as grayscale (brighter = more difference)
          let brightness = constrain(diff, 0, 255);
          let pixelIndex = (canvasX + canvasY * width) * 4;

          if (pixelIndex >= 0 && pixelIndex + 2 < pixels.length) {
            pixels[pixelIndex] = brightness;     // R
            pixels[pixelIndex + 1] = brightness; // G
            pixels[pixelIndex + 2] = brightness; // B
            pixels[pixelIndex + 3] = 200;        // Alpha

            // Fill in some neighboring pixels for better visibility
            for (let dx = 0; dx < 3 && canvasX + dx < width; dx++) {
              for (let dy = 0; dy < 3 && canvasY + dy < height; dy++) {
                let fillIndex = ((canvasX + dx) + (canvasY + dy) * width) * 4;
                if (fillIndex >= 0 && fillIndex + 2 < pixels.length) {
                  pixels[fillIndex] = brightness;
                  pixels[fillIndex + 1] = brightness;
                  pixels[fillIndex + 2] = brightness;
                  pixels[fillIndex + 3] = 150;
                }
              }
            }
          }
        }
      }
    }
  }

  updatePixels();
}

// Draw motion as colored pixels in background for debugging
function drawMotionDebug() {
  loadPixels();

  for (let i = 0; i < motionPixels.length; i++) {
    if (motionPixels[i] > motionThreshold) {
      let x = i % width;
      let y = floor(i / width);
      let pixelIndex = (x + y * width) * 4;

      // Draw motion as red pixels
      pixels[pixelIndex] = 255;     // R
      pixels[pixelIndex + 1] = 0;   // G
      pixels[pixelIndex + 2] = 0;   // B
      pixels[pixelIndex + 3] = 120; // Alpha
    }
  }

  updatePixels();
}





// Instructions with camera status
function drawInstructions() {
  push();
  textAlign(LEFT);
  textSize(12);
  
  // Controls & info
  fill(255);
  textAlign(LEFT);
  text("Mouse: Left = attract • Right/Middle = repel", 10, 22);
  text("Speed: slow = follow • fast = fling", 10, 40);
  text("Space: spawn large body • C: re-seed bodies", 10, 58);

  // Performance info
  textAlign(RIGHT);
  fill(200);
  text(`FPS: ${nf(frameRate(), 0, 1)} | Bodies: ${bodies.length}`, width - 10, 22);
  text(`Mouse speed: ${mouseSpeedSmoothed.toFixed(1)} | Flow z: ${flowZ.toFixed(2)}`, width - 10, 40);
  
  pop();
}

// Auto-calibration system
function startAutoCalibration() {
  if (!videoReady) return;
  
  isCalibrating = true;
  calibrationStartTime = millis();
  calibrationSamples = [];
  console.log('🎯 Starting auto-calibration...');
}

function updateAutoCalibration() {
  if (!isCalibrating || !videoReady) return;
  
  let elapsed = millis() - calibrationStartTime;
  
  if (elapsed > calibrationDuration) {
    // Calibration complete - analyze samples
    finishAutoCalibration();
    return;
  }
  
  // Collect samples during calibration
  if (frameCount % 10 === 0) { // Sample every 10 frames
    let sample = {
      motionLevel: getOverallMotionLevel(),
      contrast: getAverageContrast(),
      noiseLevel: getNoiseLevel(),
      time: elapsed
    };
    calibrationSamples.push(sample);
  }
}

function finishAutoCalibration() {
  isCalibrating = false;
  
  if (calibrationSamples.length < 5) {
    console.log('⚠️ Insufficient calibration data, using defaults');
    return;
  }
  
  // Analyze collected samples
  let avgMotion = calibrationSamples.reduce((sum, s) => sum + s.motionLevel, 0) / calibrationSamples.length;
  let avgContrast = calibrationSamples.reduce((sum, s) => sum + s.contrast, 0) / calibrationSamples.length;
  let avgNoise = calibrationSamples.reduce((sum, s) => sum + s.noiseLevel, 0) / calibrationSamples.length;
  
  // Determine environment type and optimal sensitivity
  baseMotionLevel = avgMotion;
  ambientNoiseLevel = avgNoise;
  lightingStability = avgContrast / 100; // normalize
  
  // Calculate optimal threshold scale
  if (avgMotion < 5 && avgNoise < 10) {
    // Very quiet environment - higher sensitivity
    autoThresholdScale = 0.8;
  } else if (avgMotion > 50 || avgNoise > 30) {
    // Very active/noisy environment - lower sensitivity
    autoThresholdScale = 3.5;
  } else if (avgContrast < 20) {
    // Low contrast/poor lighting - adjust sensitivity
    autoThresholdScale = 1.2;
  } else {
    // Normal environment
    autoThresholdScale = 2.0;
  }
  
  // Apply auto-calibration if in auto mode
  if (sensitivityMode === 'auto') {
    thresholdScale = autoThresholdScale;
  }
  
  console.log(`✅ Auto-calibration complete! Environment: Motion=${avgMotion.toFixed(1)}, Contrast=${avgContrast.toFixed(1)}, Noise=${avgNoise.toFixed(1)}`);
  console.log(`🎯 Recommended sensitivity: ${autoThresholdScale.toFixed(2)}`);
}

function getOverallMotionLevel() {
  if (!motionPixels || motionPixels.length === 0) return 0;
  
  let motionCount = 0;
  let totalMotion = 0;
  
  for (let i = 0; i < motionPixels.length; i += 10) { // Sample subset
    if (motionPixels[i] > 0) {
      motionCount++;
      totalMotion += motionPixels[i];
    }
  }
  
  return motionCount > 0 ? totalMotion / motionCount : 0;
}

function getAverageContrast() {
  if (!videoCapture || !videoReady) return 50;
  
  videoCapture.loadPixels();
  let contrastSum = 0;
  let samples = 0;
  
  // Sample contrast from various points
  for (let x = 10; x < videoCapture.width - 10; x += 20) {
    for (let y = 10; y < videoCapture.height - 10; y += 20) {
      let contrast = calculateLocalContrast(videoCapture.pixels, x, y, videoCapture.width);
      contrastSum += contrast;
      samples++;
    }
  }
  
  return samples > 0 ? contrastSum / samples : 50;
}

function getNoiseLevel() {
  if (!videoCapture || !baselineFrame || !videoReady) return 0;
  
  videoCapture.loadPixels();
  baselineFrame.loadPixels();
  
  let noiseSum = 0;
  let samples = 0;
  
  // Sample noise from stable areas (areas with low motion)
  for (let x = 0; x < videoCapture.width; x += 15) {
    for (let y = 0; y < videoCapture.height; y += 15) {
      let index = (x + y * videoCapture.width) * 4;
      if (index + 2 < videoCapture.pixels.length && index + 2 < baselineFrame.pixels.length) {
        let currGray = (videoCapture.pixels[index] + videoCapture.pixels[index + 1] + videoCapture.pixels[index + 2]) / 3;
        let baseGray = (baselineFrame.pixels[index] + baselineFrame.pixels[index + 1] + baselineFrame.pixels[index + 2]) / 3;
        let diff = abs(currGray - baseGray);
        
        // Only count as noise if it's small, consistent change
        if (diff > 2 && diff < 15) {
          noiseSum += diff;
          samples++;
        }
      }
    }
  }
  
  return samples > 0 ? noiseSum / samples : 0;
}

// Sensitivity UI functions
function createSensitivityUI() {
  // Create UI container
  sensitivityUI = createDiv('');
  sensitivityUI.id('sensitivity-ui');
  sensitivityUI.style('position', 'fixed');
  sensitivityUI.style('top', '10px');
  sensitivityUI.style('right', '10px');
  sensitivityUI.style('background', 'rgba(0, 0, 0, 0.8)');
  sensitivityUI.style('padding', '15px');
  sensitivityUI.style('border-radius', '8px');
  sensitivityUI.style('color', 'white');
  sensitivityUI.style('font-family', 'monospace');
  sensitivityUI.style('font-size', '12px');
  sensitivityUI.style('min-width', '200px');
  sensitivityUI.style('z-index', '1000');
  
  // Mode toggle button
  modeButton = createButton('Auto Mode');
  modeButton.parent(sensitivityUI);
  modeButton.style('margin-bottom', '10px');
  modeButton.style('width', '100%');
  modeButton.style('background', '#4CAF50');
  modeButton.style('color', 'white');
  modeButton.style('border', 'none');
  modeButton.style('padding', '8px');
  modeButton.style('border-radius', '4px');
  modeButton.style('cursor', 'pointer');
  modeButton.mousePressed(() => {
    sensitivityMode = sensitivityMode === 'auto' ? 'manual' : 'auto';
    saveUserPreferences();
    updateSensitivityDisplay();
  });
  
  // Sensitivity slider
  let sliderLabel = createDiv('Manual Sensitivity:');
  sliderLabel.parent(sensitivityUI);
  sliderLabel.style('margin-bottom', '5px');
  
  sensitivitySlider = createSlider(0, 1, userSensitivity, 0.01);
  sensitivitySlider.parent(sensitivityUI);
  sensitivitySlider.style('width', '100%');
  sensitivitySlider.style('margin-bottom', '10px');
  
  sensitivitySlider.input(() => {
    userSensitivity = sensitivitySlider.value();
    if (sensitivityMode === 'manual') {
      // Convert 0-1 range to threshold scale (inverted - higher slider = more sensitive)
      thresholdScale = map(userSensitivity, 0, 1, 4.0, 0.5);
    }
    saveUserPreferences();
    updateSensitivityDisplay();
  });
  
  // Status display
  statusDiv = createDiv('');
  statusDiv.parent(sensitivityUI);
  statusDiv.id('sensitivity-status');
  
  updateSensitivityDisplay();
}

function updateSensitivityDisplay() {
  if (!sensitivityUI || !modeButton || !statusDiv) return;
  
  if (sensitivityMode === 'auto') {
    modeButton.html('🤖 Auto Mode');
    modeButton.style('background', '#4CAF50');
    sensitivitySlider.attribute('disabled', true);
    
    if (isCalibrating) {
      let progress = ((millis() - calibrationStartTime) / calibrationDuration * 100).toFixed(0);
      statusDiv.html(`Calibrating... ${progress}%<br/>Please move naturally`);
    } else {
      statusDiv.html(`Auto Sensitivity: ${autoThresholdScale.toFixed(2)}<br/>Environment adapted`);
    }
  } else {
    modeButton.html('👤 Manual Mode');
    modeButton.style('background', '#FF9800');
    sensitivitySlider.removeAttribute('disabled');
    
    let sensitivityLabel = userSensitivity < 0.3 ? 'Low' : userSensitivity < 0.7 ? 'Medium' : 'High';
    statusDiv.html(`Manual: ${sensitivityLabel}<br/>Scale: ${thresholdScale.toFixed(2)}`);
  }
}

function toggleSensitivityUI() {
  if (!sensitivityUI) return;
  
  let currentDisplay = sensitivityUI.style('display');
  if (currentDisplay === 'none') {
    sensitivityUI.style('display', 'block');
  } else {
    sensitivityUI.style('display', 'none');
  }
}

// Handle window resizing
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  // Recreate background and flow field
  initBackgroundElements();
  initFlowField();
  initBodies();
}
