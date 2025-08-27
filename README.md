# Space Simulation

A beautiful space simulation built with p5.js, featuring twinkling stars, orbiting planets, and interactive elements.

## 🌟 Features

- **Twinkling Stars**: 200+ animated stars that twinkle at different speeds
- **Orbiting Planets**: Three colorful planets with realistic orbital motion
- **Interactive Elements**: Click anywhere to add new stars
- **Shooting Stars**: Occasional shooting stars for added atmosphere
- **Responsive Design**: Works on both desktop and mobile devices

## 🚀 Getting Started

### Prerequisites

- A web browser (Chrome, Firefox, Safari, Edge)
- Internet connection for p5.js library (hosted on CDN)

### Running Locally

1. Clone or download this repository
2. Open `index.html` in your web browser
3. Enjoy the space simulation!

## 🌐 Deploying to GitHub Pages

Follow these steps to share your space simulation online:

### Step 1: Create a GitHub Repository

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the "+" button and select "New repository"
3. Name your repository `space-simulation` (or any name you prefer)
4. Make sure it's set to **Public** (required for free GitHub Pages)
5. **DO NOT** initialize with README, .gitignore, or license (since you already have these)
6. Click "Create repository"

### Step 2: Upload Your Files

You have several options to upload your files:

#### Option A: Git Commands (Recommended for developers)

```bash
# Initialize git in your project folder
git init

# Add all your files
git add .

# Commit the files
git commit -m "Initial commit: Space simulation with p5.js"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push to GitHub
git push -u origin main
```

#### Option B: GitHub Web Interface

1. In your GitHub repository, click "Add file" → "Upload files"
2. Drag and drop all files from your project:
   - `index.html`
   - `sketch.js`
   - `styles.css`
   - `README.md`
   - `LICENSE`
3. Add a commit message like "Initial commit: Space simulation"
4. Click "Commit changes"

### Step 3: Enable GitHub Pages

1. In your repository, go to **Settings** tab
2. Scroll down to **Pages** section (in the left sidebar)
3. Under "Source", select **Deploy from a branch**
4. Under "Branch", select **main** and folder **/(root)**
5. Click **Save**

### Step 4: Access Your Live Site

1. Wait 2-3 minutes for deployment
2. Go back to Settings → Pages
3. You'll see a message: "Your site is live at [URL]"
4. Click the URL to view your space simulation!

## 🎮 How to Use

- **View**: Enjoy the animated space scene with twinkling stars and orbiting planets
- **Interact**: Click anywhere on the canvas to add new stars
- **Responsive**: The simulation automatically adjusts to different screen sizes

## 🛠️ Customization

### Changing Colors

Edit `sketch.js` to modify:
- Background color (line ~24)
- Planet colors (in the Planet constructor)
- Star brightness and twinkling speed

### Adding More Planets

Add more planets in the `setup()` function:

```javascript
planets.push(new Planet(x, y, radius, color(r, g, b)));
```

### Modifying Star Field

Adjust the number of stars or their properties in the `setup()` function:

```javascript
// Change 200 to any number you want
for (let i = 0; i < 200; i++) {
```

## 📁 Project Structure

```
space-simulation/
├── index.html          # Main HTML file
├── sketch.js           # p5.js sketch with space simulation
├── styles.css          # CSS styling
├── README.md           # This file
└── LICENSE             # License file
```

## 🐛 Troubleshooting

### Common Issues

**Page not loading:**
- Check your internet connection (p5.js loads from CDN)
- Verify all files are uploaded to GitHub

**GitHub Pages not working:**
- Make sure your repository is **Public**
- Wait a few minutes after enabling Pages
- Check that you're deploying from the `main` branch

**Mobile issues:**
- The canvas is responsive, but very small screens may need scrolling

## 🤝 Contributing

Feel free to fork this project and add your own space-themed features!

## 📄 License

This project is licensed under the terms specified in the LICENSE file.

---

**Enjoy your space simulation! 🚀✨**

If you have any questions about deployment or want to add new features, feel free to open an issue or submit a pull request.
