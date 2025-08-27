// Space Simulation - p5.js
// A basic space environment with stars and interactive elements

let stars = [];
let planets = [];
let canvasWidth = 800;
let canvasHeight = 600;

function setup() {
  let canvas = createCanvas(canvasWidth, canvasHeight);
  canvas.parent('canvas-container');

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

function draw() {
  // Space background
  background(5, 5, 25);

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
  text("Space Simulation - Click to add stars!", width / 2, height - 20);
}

function mousePressed() {
  // Add a new star where the user clicks
  stars.push({
    x: mouseX,
    y: mouseY,
    brightness: random(150, 255),
    twinkleSpeed: random(0.01, 0.05)
  });
}

function drawShootingStar() {
  let x = random(width);
  let y = random(height / 2);
  stroke(255, 255, 255, 200);
  strokeWeight(3);
  line(x, y, x + 50, y + 50);
  strokeWeight(1);
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
