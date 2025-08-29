// Space Simulation - p5.js
// Minimal space environment with webcam preview and audio input/output

let stars = [];
let planets = [];
let canvasWidth = 800;
let canvasHeight = 600;

// Webcam and Audio variables
let videoCapture;
let audioInput;
let audioLevel = 0;
let micEnabled = true;
let videoReady = false;
let cameraError = null;
let cameraPermissionDenied = false;

function setup() {
  let canvas = createCanvas(canvasWidth, canvasHeight);
  canvas.parent('canvas-container');

  // Initialize webcam with better error handling
  initializeCamera();

  // Initialize audio components (defer mic start until user interaction)
  try {
    audioInput = new p5.AudioIn();
    // do not start yet, wait for gesture
  } catch (error) {
    console.error('Audio initialization error:', error);
  }

  // Create stars
  for (let i = 0; i < 200; i++) {
    stars.push({
      x: random(width),
      y: random(height),
      brightness: random(100, 255),
      twinkleSpeed: random(0.01, 0.05)
    });
  }

  // Create some planets
  planets.push(new Planet(width * 0.2, height * 0.3, 30, color(255, 165, 0))); // Orange planet
  planets.push(new Planet(width * 0.8, height * 0.7, 25, color(135, 206, 235))); // Blue planet
  planets.push(new Planet(width * 0.6, height * 0.2, 20, color(255, 20, 147))); // Pink planet
}

function initializeCamera() {
  console.log('Initializing camera...');
  
  // Reset camera state
  videoReady = false;
  cameraError = null;
  cameraPermissionDenied = false;
  
  try {
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraError = 'Camera not supported by this browser';
      console.error(cameraError);
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
    
    console.log('Creating video capture with constraints:', constraints);
    
    // First test getUserMedia directly to catch permission errors
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        console.log('getUserMedia success, creating p5 capture');
        
        // Now create p5 capture
        videoCapture = createCapture(constraints, videoSuccess);
        
        if (videoCapture && videoCapture.elt) {
          videoCapture.size(320, 240);
          videoCapture.hide();
          videoCapture.elt.setAttribute('playsinline', '');
          videoCapture.elt.muted = true;
          videoCapture.elt.autoplay = true;
          
          videoCapture.elt.addEventListener('loadeddata', () => {
            console.log('Video loaded');
            videoReady = true;
          });
          
          videoCapture.elt.addEventListener('canplay', () => {
            console.log('Video can play');
            videoReady = true;
          });
          
          videoCapture.elt.addEventListener('error', (e) => {
            console.error('Video element error:', e);
            cameraError = 'Video element error';
          });
        }
        
        // Stop the test stream
        stream.getTracks().forEach(track => track.stop());
      })
      .catch(error => {
        console.error('getUserMedia error:', error);
        handleCameraError(error);
      });
      
  } catch (error) {
    console.error('Camera initialization error:', error);
    cameraError = 'Camera initialization failed: ' + error.message;
  }
}

function handleCameraError(error) {
  console.error('Camera access error:', error);
  
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
  console.log('Camera access granted successfully:', stream);
  videoReady = true;
  cameraError = null;
  cameraPermissionDenied = false;
}

function draw() {
  // Space background
  background(5, 5, 25);

  // Get audio level from p5.AudioIn (only if mic is enabled)
  if (micEnabled && audioInput) {
    audioLevel = audioInput.getLevel();
  } else {
    audioLevel = 0;
  }

  // Draw webcam preview (top-right corner) on canvas
  drawCameraPreview();

  // Draw audio level indicator
  drawAudioLevelIndicator();

  // Draw stars with twinkling effect
  for (let star of stars) {
    let twinkle = sin(frameCount * star.twinkleSpeed) * 50 + 200;
    stroke(star.brightness, star.brightness, 255, twinkle);
    strokeWeight(2);
    point(star.x, star.y);
  }

  // Draw planets
  for (let planet of planets) {
    planet.display();
    planet.orbit();
  }

  // Draw some shooting stars occasionally
  if (random() < 0.005) {
    drawShootingStar();
  }

  // Display instructions
  fill(255, 255, 255, 150);
  textAlign(CENTER);
  textSize(14);
  text("Space Simulation - Webcam & Audio", width / 2, height - 60);
  textSize(12);
  text("Click to add stars & beep | Press 'M' to toggle mic | Press 'R' to retry camera", width / 2, height - 40);
  text("Speak to see audio levels | Webcam preview in top-right", width / 2, height - 20);

  // Show microphone status
  let micStatus = micEnabled ? "ON" : "OFF";
  let micColor = micEnabled ? color(0, 255, 0) : color(255, 0, 0);
  fill(micColor);
  text(`Mic: ${micStatus}`, width / 2, height - 10);

  // (Minimal UI - no audio context status line)
}

function mousePressed() {
  // Initialize audio after user gesture (required by browsers)
  if (getAudioContext().state !== 'running') {
    getAudioContext().resume().then(() => {
      // Start p5 mic if enabled
      if (micEnabled && audioInput) {
        audioInput.start(() => {
          try { audioInput.disconnect(); } catch (e) {}
        });
      }
    }).catch((error) => {
      console.error('Failed to resume AudioContext:', error);
    });
  }

  // Add a new star where the user clicks
  stars.push({
    x: mouseX,
    y: mouseY,
    brightness: random(150, 255),
    twinkleSpeed: random(0.01, 0.05)
  });

  // Play a simple audio beep
  playBeep();
}

function playBeep() {
  if (getAudioContext().state !== 'running') return;
  let osc = new p5.Oscillator('sine');
  osc.freq(440);
  osc.amp(0);
  osc.start();
  osc.amp(0.12, 0.01);
  setTimeout(() => {
    osc.amp(0, 0.05);
    setTimeout(() => { osc.stop(); }, 60);
  }, 140);
}

// (No custom mic pipeline or extra constraints needed in the minimal setup)

function keyPressed() {
  if (key === 'm' || key === 'M') {
    // Toggle microphone on/off with 'M' key
    if (micEnabled) {
      if (audioInput) { audioInput.stop(); }
      micEnabled = false;
    } else {
      // Only start if AudioContext is running
      if (getAudioContext().state === 'running' && audioInput) {
        audioInput.start(() => {
          try { audioInput.disconnect(); } catch (e) {}
        });
        micEnabled = true;
      } else {
        // Click first to initialize audio context
      }
    }
  } else if (key === 'r' || key === 'R') {
    // Retry camera initialization
    console.log('Retrying camera initialization...');
    retryCamera();
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

function drawShootingStar() {
  let x = random(width);
  let y = random(height / 2);
  stroke(255, 255, 255, 200);
  strokeWeight(3);
  line(x, y, x + 50, y + 50);
  strokeWeight(1);
}

function drawCameraPreview() {
  let previewX = width - 160;
  let previewY = 10;
  let previewWidth = 160;
  let previewHeight = 120;
  
  if (videoCapture && videoCapture.elt && videoReady && videoCapture.elt.readyState >= 2) {
    // Camera is working - show video
    image(videoCapture, previewX, previewY, previewWidth, previewHeight);
    
    // Add a border
    noFill();
    stroke(0, 255, 0, 150);
    strokeWeight(2);
    rect(previewX, previewY, previewWidth, previewHeight);
    
    // Camera status indicator
    fill(0, 255, 0, 200);
    noStroke();
    textSize(10);
    textAlign(RIGHT);
    text('Camera: ON', width - 10, previewY + previewHeight + 15);
    
  } else {
    // Camera not working - show placeholder with error info
    noFill();
    stroke(cameraError ? color(255, 0, 0, 120) : color(200, 200, 255, 120));
    strokeWeight(2);
    rect(previewX, previewY, previewWidth, previewHeight);
    
    // Error message or loading message
    fill(cameraError ? color(255, 100, 100, 200) : color(200, 200, 255, 200));
    noStroke();
    textSize(9);
    textAlign(CENTER, CENTER);
    
    if (cameraError) {
      text('Camera Error:', previewX + previewWidth/2, previewY + previewHeight/2 - 10);
      text(cameraError.substring(0, 40), previewX + previewWidth/2, previewY + previewHeight/2);
      if (cameraError.length > 40) {
        text(cameraError.substring(40, 80), previewX + previewWidth/2, previewY + previewHeight/2 + 10);
      }
      
      // Retry button hint
      textSize(8);
      text('Press R to retry', previewX + previewWidth/2, previewY + previewHeight/2 + 25);
    } else {
      text('Starting webcam...', previewX + previewWidth/2, previewY + previewHeight/2);
    }
    
    // Camera status indicator
    fill(cameraError ? color(255, 0, 0, 200) : color(255, 255, 0, 200));
    noStroke();
    textSize(10);
    textAlign(RIGHT);
    text(cameraError ? 'Camera: ERROR' : 'Camera: LOADING', width - 10, previewY + previewHeight + 15);
  }
}

function drawAudioLevelIndicator() {
  // Audio level bar in bottom left
  let barWidth = 200;
  let barHeight = 20;
  let barX = 20;
  let barY = height - 60;

  // Background bar
  fill(50, 50, 50, 150);
  stroke(255, 255, 255, 100);
  strokeWeight(1);
  rect(barX, barY, barWidth, barHeight);

  // Audio level fill
  let levelWidth = map(audioLevel, 0, 0.3, 0, barWidth); // Map audio level to bar width
  fill(0, 255, 0, 200);
  noStroke();
  rect(barX, barY, levelWidth, barHeight);

  // Audio level text
  fill(255, 255, 255, 200);
  textAlign(LEFT);
  textSize(12);
  text(`Audio Level: ${(audioLevel * 1000).toFixed(1)}`, barX, barY - 10);
}

class Planet {
  constructor(x, y, radius, col) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.color = col;
    this.angle = 0;
    this.orbitRadius = 50;
    this.orbitSpeed = random(0.005, 0.02);
  }

  display() {
    // Draw orbit path
    noFill();
    stroke(255, 255, 255, 50);
    ellipse(this.x, this.y, this.orbitRadius * 2);

    // Draw planet
    fill(this.color);
    noStroke();
    let px = this.x + cos(this.angle) * this.orbitRadius;
    let py = this.y + sin(this.angle) * this.orbitRadius;
    ellipse(px, py, this.radius);

    // Add some atmosphere effect
    fill(red(this.color), green(this.color), blue(this.color), 100);
    ellipse(px, py, this.radius * 1.5);
  }

  orbit() {
    this.angle += this.orbitSpeed;
  }
}

// Handle window resizing
function windowResized() {
  resizeCanvas(canvasWidth, canvasHeight);
}
