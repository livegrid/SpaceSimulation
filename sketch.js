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

// Debug options
let showMotionDebug = false; // Toggle motion visualization
let showBaselineDiff = false; // Show baseline vs current frame difference
let useHotspotAttraction = true; // Enable camera hotspots

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

  // Initialize webcam
  initializeCamera();

  // Create simple particles
  for (let i = 0; i < numParticles; i++) {
    particles.push(new Particle(width/2, height/2));
  }

  // Initialize background elements
  initBackgroundElements();

  // Initialize motion detection map lazily when video is ready
}

// Removed background initialization - focusing on particles only

// Initialize background visual elements (planets and nebula blobs)
function initBackgroundElements() {
  bgGradientTime = random(1000);

  // Create background planets (large, slow, low-alpha)
  planetsBg = [];
  const base = min(width, height);
  const numPlanets = 3;
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
      ring: random(1) < 0.6,
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

    // Optional ring
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
}

function draw() {
  // Draw camera feed as background if available
  if (videoReady && videoCapture) {
    // Scale and draw the camera feed to fit the canvas
    push();
    tint(255, 255, 255, 22); // Keep camera extremely subtle behind visuals
    
    // Calculate scaling to fit camera feed to canvas while maintaining aspect ratio
    let videoAspect = videoCapture.width / videoCapture.height;
    let canvasAspect = width / height;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    if (videoAspect > canvasAspect) {
      // Video is wider than canvas
      drawHeight = height;
      drawWidth = height * videoAspect;
      drawX = (width - drawWidth) / 2;
      drawY = 0;
    } else {
      // Video is taller than canvas
      drawWidth = width;
      drawHeight = width / videoAspect;
      drawX = 0;
      drawY = (height - drawHeight) / 2;
    }
    
    // Mirror horizontally by drawing with negative width
    push();
    translate(drawX + drawWidth, 0);
    scale(-1, 1);
    // image(videoCapture, 0, drawY, drawWidth, drawHeight);
    pop();
    pop();
  } else {
    // Fallback to black background if no camera
    background(0);
  }
  // background(0);

  // Hard clear to fully remove any previous frame content (prevents lingering trails)
  hardClearCanvas();

  // Dynamic space background layers (always behind particles)
  blendMode(BLEND); // ensure normal compositing for background paint
  drawBackgroundGradient();
  if (!showMotionDebug) {
    drawBackgroundPlanets();
    drawNebulaBlobs();
  }

  // Throttle baseline adaption to reduce per-frame cost
  if (videoReady && videoCapture && frameCount > 60 && frameCount % 10 === 0) { // ~6 Hz
    updateAdaptiveBaseline();
  }

  // Process motion detection only when needed (debug or attraction) and throttled
  if (videoReady && videoCapture && (showMotionDebug || useHotspotAttraction)) {
    const detectEvery = showMotionDebug ? detectionIntervalDebug : detectionIntervalHotspot;
    const sampleStep = showMotionDebug ? detectionStepDebug : detectionStepHotspot;
    if (frameCount % detectEvery === 0) {
      detectMotion(sampleStep);
    }
    // calculateMotionVectors();

    // Debug logging every 30 frames (about 0.5 second at 60fps)
    if (frameCount % 30 === 0) {
      
    }
  }

  // Show motion detection debug if enabled
  if (showMotionDebug) {
    if (showBaselineDiff) {
      if (frameCount % 4 === 0) drawBaselineDifference();
    } else {
      if (frameCount % 4 === 0) drawMotionDebug();
      drawMotionHotspots();
      // drawMotionVectors();
    }
  }

  // Core particle system
  push();
  blendMode(ADD); // Make particles glow over background
  for (let particle of particles) {
    particle.flock(particles);             // Flocking behavior
    if (useHotspotAttraction && (frameCount + (particle.pos.x | 0)) % hotspotUpdateModulo === 0) {
      particle.applyHotspotAttractionFast();
    }
    particle.update();
    particle.display();
  }
  pop();

  // Show camera status and instructions
  drawInstructions();
}

// Mouse click to add a particle for testing
function mousePressed() {
  particles.push(new Particle(mouseX, mouseY));
}

// Keyboard controls for debugging
function keyPressed() {
  if (key === 'r' || key === 'R') {
    // Retry camera initialization
    
    retryCamera();
  } else if (key === 'c' || key === 'C') {
    // Clear all particles
    particles = [];
  } else if (key === ' ') {
    // Add random particle
    particles.push(new Particle(random(width), random(height)));
  } else if (key === 'd' || key === 'D') {
    // Toggle motion debug visualization
    showMotionDebug = !showMotionDebug;
    if (!showMotionDebug) {
      cleanupAfterDebug();
    }
  } else if (key === 'f' || key === 'F') {
    // Toggle baseline difference view
    if (showMotionDebug) {
      showBaselineDiff = !showBaselineDiff;
      
    }
  } else if (key === 'b' || key === 'B') {
    // Force update baseline frame
    updateBaselineFrame();
    
  } else if (key === '1') {
    // Slower baseline adaptation
    baselineUpdateRate = max(0.001, baselineUpdateRate * 0.5);
    
  } else if (key === '2') {
    // Faster baseline adaptation
    baselineUpdateRate = min(0.02, baselineUpdateRate * 2);
    
  } else if (key === '-' || key === '_') {
    // Raise threshold (less sensitive)
    thresholdScale = min(5.0, thresholdScale * 1.15);
  } else if (key === '=' || key === '+') {
    // Lower threshold (more sensitive)
    thresholdScale = max(0.2, thresholdScale / 1.15);
  } else if (key === 'h' || key === 'H') {
    useHotspotAttraction = !useHotspotAttraction;
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

  applyForce(force) {
    this.acc.add(force);
  }

  update() {
    this.vel.add(this.acc);
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
    // Glowing stardust point (works well with ADD blend mode)
    stroke(this.hue, 255, 200, 160);
    strokeWeight(particleSize + 0.3);
    point(this.pos.x, this.pos.y);
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
  
  // Camera status
  fill(255);
  if (videoReady && videoCapture) {
    fill(0, 255, 0); // Green for camera working
    text("📹 Camera: ACTIVE", 10, 25);
    fill(255);
    text(`Video: ${videoCapture.width}x${videoCapture.height}`, 10, 45);
  } else if (cameraError) {
    fill(255, 0, 0); // Red for error
    text("📹 Camera: ERROR - " + cameraError, 10, 25);
  } else {
    fill(255, 255, 0); // Yellow for loading
    text("📹 Camera: LOADING...", 10, 25);
  }
  
  // Controls
  fill(255);
  textAlign(CENTER);
  text("Controls: D debug • F diff • B baseline • 1/2 baseline speed • +/- sensitivity • H hotspot • C clear • R retry cam", width / 2, height - 20);
  
  // Performance info and motion stats
  textAlign(RIGHT);
  fill(200);
  text(`FPS: ${nf(frameRate(), 0, 1)} | Particles: ${particles.length}`, width - 10, 25);
      if (showMotionDebug) {
      fill(120, 255, 120);
      let debugMode = showBaselineDiff ? "BASELINE DIFF" : "MOTION PIXELS";
      text(`${debugMode} | Hotspots: ${motionHotspots.length}`, width - 10, 45);
      fill(200);
      text(`Baseline rate: ${(baselineUpdateRate * 1000).toFixed(1)}/1000`, width - 10, 65);
      if (showBaselineDiff) {
        text("⚫ Grayscale: Frame difference | 🟢 Green: Hotspots", width - 10, 85);
      } else {
        text("🔴 Red: Motion pixels | 🟢 Green: Hotspots", width - 10, 85);
      }
    }
  
  pop();
}

// Handle window resizing
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  // Reinitialize motion detection
  // Do NOT recreate baselineFrame here (keep video resolution). Just clear motion buffer.
  motionPixels = new Array(width * height).fill(0);

  // Reset particles to new canvas size
  particles = [];
  for (let i = 0; i < numParticles; i++) {
    particles.push(new Particle(random(width), random(height)));
  }

  // Recreate background elements so sizes follow new viewport
  initBackgroundElements();
}
