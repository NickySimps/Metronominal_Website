/**
 * themeController.js
 * This module manages theme definitions and application.
 * NOTE: Ensure Three.js is loaded in your HTML before this script if using the global `THREE`.
 * e.g., <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
 */
import * as SceneManager from './3D/threeDSceneManager.js'; // For accessing camera
import DOM from './domSelectors.js';
import AppState from './appState.js';
import ThreeDThemeManager from './3D/3dTheme.js'; // Import the new 3D theme manager

const themes = {
    default: { // Pistachio Theme (unlabeled)
        '--Main': '#00b430', // Pistachio Green',
        '--Background': '#e3ffe8', // Light Green
        '--Accent': '#ffe0b2', // Pale Orange/Peach
        '--Highlight': '#a0faa0', // Light Green
        '--Alt1': '#4682b4', // Steel Blue
        '--Alt2': '#dc143c', // Crimson Red
        '--TextOnMain': '#000000', // White
        '--TextPrimary': '#333333', // Dark Gray
        '--TextSecondary': '#555555', // Medium Gray
        '--SubdivisionBeatColor': 'rgba(14, 75, 0, 0.85)', // OrangeRed for non-highlighted beat square (high contrast)
        '--HighlightedBeatColor': '#ffc471', // Light Orange', 
        '--ActiveBarBackground': 'rgb(255, 217, 248)', // Steel Blue with transparency
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '20px', // Slightly rounded
        '--font-family': '"Inter", sans-serif'
    },
    dark: {
        '--Main': '#1c1c22', // Very Dark Gray (almost black)
        '--Background': '#0c0c0e', // Near Black
        '--Accent': '#fde047', // Bright Yellow
        '--Highlight': '#303038', // Dark Gray
        '--Alt1': '#00529b', // Dark Blue
        '--Alt2': '#4a4a5a', // Medium Dark Gray
        '--TextOnMain': '#ffffff', // Off-White
        '--TextPrimary': '#bbbbbb', // Light Gray
        '--TextSecondary': '#cccccc', // Very Light Gray
        '--SubdivisionBeatColor': '#ffffff', // OrangeRed for non-highlighted beat square (high contrast)
        '--HighlightedBeatColor': '#00ffff', // Cyan for highlighted beat square (high contrast)
        '--ActiveBarBackground': 'rgba(0, 82, 155, 0.5)', // Dark Blue with transparency
        '--BorderColor': 'var(--Accent)', // Set to transparent for flat look
        '--BorderRadius': '7px', // Sharper than default
        '--font-family': '"Roboto Mono", monospace'
    },
    synthwave: {
        '--Main': '#ff00ff', // Magenta
        '--Background': '#0f0241', // Deep Indigo/Dark Purple
        '--Accent': '#7b00ff', // Electric Purple
        '--Highlight': '#008090', // Teal
        '--Alt1': '#ff69b4', // Hot Pink
        '--Alt2': '#7b00ff', // Electric Purple (same as Accent)
        '--TextOnMain': '#37ff48', // White
        '--TextPrimary': '#eeeeee', // Black (often on lighter elements if any)
        '--TextSecondary': 'var(--Alt1)', // Very Dark Gray
        '--SubdivisionBeatColor': '#37ff48', // Green',
        '--HighlightedBeatColor': '#00ffff', // Cyan for highlighted beat square (high contrast)
        '--ActiveBarBackground': 'rgba(255, 105, 180, 0.5)', // Hot Pink with transparency
        '--BorderColor': 'var(--Alt1)', // Set to transparent for flat look
        '--BorderRadius': '50%', // For circular/pill shapes
        '--font-family': '"Press Start 2P", cursive'
    },
    gundam: {
        '--Main': '#ffd700', // Gundam Blue
        '--Background': '#e8e8e8', // Light Gray (Gundam White)
        '--Accent': '#cc0000', // Gundam Red
        '--Highlight': '#0050a0', // Gundam Yellow (Gold)
        '--Alt1': '#4a4a4a', // Dark Gray (Inner Frame/Details)
        '--Alt2': '#d04000', // Orange-Red (Thrusters/Accents)
        '--TextOnMain': '#ffffff', // White
        '--TextPrimary': '#fffff1', // Dark Gray
        '--TextSecondary': '#555555', // Medium Gray
        '--SubdivisionBeatColor': '#ff4500', // OrangeRed for non-highlighted beat square (high contrast)
        '--HighlightedBeatColor': '#37ff48', // Deep Sky Blue for highlighted beat square (high contrast)
        '--ActiveBarBackground': 'rgba(0, 80, 160, 0.5)', // Gundam Blue with transparency
        '--BorderColor': 'var(--Main)', // Set to transparent for flat look
        '--BorderRadius': '0px', // Hard squares
        '--font-family': '"Orbitron", sans-serif'
    },
    helloKitty: {
        '--Main': '#ffffff', // Hello Kitty Pink
        '--Background': '#ffffff', // White
        '--Accent': '#ff3366', // Brighter Pink/Red for accents
        '--Highlight': '#66ccff', // Light Blue
        '--Alt1': '#fdfd96', // Pale Yellow (Nose/Flower center)
        '--Alt2': '#ff6699', // Deeper Pink
        '--TextOnMain': '#ffffff',
        '--TextPrimary': 'hsl(0, 0.00%, 0.00%)',
        '--TextSecondary': '#555555',
        '--SubdivisionBeatColor': '#ff4500', // OrangeRed for non-highlighted beat square (high contrast)
        '--HighlightedBeatColor': '#ff007f', // Rose for highlighted beat square (high contrast)
        '--ActiveBarBackground': 'rgba(255, 153, 204, 0.5)', // Hello Kitty Pink with transparency
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '15px', // Cute and rounded
        '--font-family': '"Handlee", cursive'
    },
    beach: {
        '--Main': '#0077be', // Ocean Blue
        '--Background': '#f0e68c', // Sandy Beige
        '--Accent': '#ffcc00', // Sun Yellow
        '--Highlight': '#87ceeb', // Sky Blue
        '--Alt1': '#ff7f50', // Coral
        '--Alt2': '#20b2aa', // Light Sea Green / Turquoise
        '--TextOnMain': '#ffffff',
        '--TextPrimary': '#4a3b28', // Dark Sand/Driftwood
        '--TextSecondary': '#705c3b', // Medium Sand
        '--SubdivisionBeatColor': '#ffcc00', // OrangeRed for non-highlighted beat square (high contrast)
        '--HighlightedBeatColor': '#ff8c00', // Dark Orange for highlighted beat square (high contrast)
        '--ActiveBarBackground': 'rgba(73, 254, 242, 0.5)', // Sky Blue with transparency
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '10px', // Softly rounded
        '--font-family': '"Pacifico", cursive'
    },
    iceCream: {
        '--Main': '#ffc0cb', // Strawberry Pink
        '--Background': '#fff8dc', // Vanilla Cream
        '--Accent': '#add8e6', // Pastel Blue (Blueberry/Mint)
        '--Highlight': '#ff69b4', // Lemon Chiffon Yellow
        '--Alt1': '#d2691e', // Chocolate Brown
        '--Alt2': '#fffacd', // Hot Pink (Cherry/Raspberry swirl)
        '--TextOnMain': '#5d3a1a', // Dark Brown text on light pink
        '--TextPrimary': '#5d3a1a', // Chocolate Brown
        '--TextSecondary': '#8b5a2b', // Lighter Brown
        '--SubdivisionBeatColor': '#add8e6', // OrangeRed for non-highlighted beat square (high contrast)
        '--HighlightedBeatColor': '#32cd32', // Lime Green for highlighted beat square (high contrast)
        '--ActiveBarBackground': 'rgba(193, 116, 22, 0.71)', // Pastel Blue with transparency
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '25px', // Scoopy and round
        '--font-family': '"Bubblegum Sans", cursive'
    },
    tuxedo: { // Replaces Black
        '--Main': '#1a1a1a', // Very Dark Gray
        '--Background': '#f0f0f0', // Off-white
        '--Accent': '#c0c0c0', // Silver
        '--Highlight': '#333333', // Dark Gray
        '--Alt1': '#666666', // Medium Gray
        '--Alt2': '#b22222', // Firebrick Red - for strong accent/alert
        '--TextOnMain': '#ffffff',
        '--TextPrimary': '#ffffff',
        '--TextSecondary': '#333333',
        '--SubdivisionBeatColor': '#ffffff', // Gold - high contrast on dark
        '--HighlightedBeatColor': '#ff4500', // OrangeRed - distinct and high contrast
        '--ActiveBarBackground': 'rgba(51, 51, 51, 0.5)',
        '--BorderColor': '#4a4a4a',
        '--BorderRadius': '3px',
        '--font-family': '"Roboto Mono", monospace'
    },
    pastel: { // Replaces White
        '--Main': '#ffe0e6', // Lighter Pink
        '--Background': '#ffffe0', // Lighter Pale Yellow
        '--Accent': '#e0f2f7', // Lighter Light Blue
        '--Highlight': '#e0ffe0', // Lighter Pale Green
        '--Alt1': '#f2e0f2', // Lighter Plum - muted purple
        '--Alt2': '#ff9980', // Lighter Tomato - for strong accent
        '--TextOnMain': '#8000ff', // Lighter Indigo
        '--TextPrimary': '#8000ff', // Lighter Indigo
        '--TextSecondary': '#c080ff', // Lighter Blue Violet
        '--SubdivisionBeatColor': '#f2e0f2', // Lighter Plum - high contrast on light
        '--HighlightedBeatColor': '#c080ff', // Lighter Blue Violet - distinct and high contrast
        '--ActiveBarBackground': 'rgba(200, 230, 240, 0.5)', // Lighter Light Blue with transparency
        '--BorderColor': 'transparent',
        '--BorderRadius': '15px',
        '--font-family': '"Inter", sans-serif'
    },
    colorblind: { // Replaces Gray
        '--Main': '#0072B2', // Strong Blue
        '--Background': '#F0E442', // Yellowish Orange - high contrast with blue
        '--Accent': '#D55E00', // Orange-Red
        '--Highlight': '#009E73', // Bluish Green
        '--Alt1': '#CC79A7', // Reddish Purple
        '--Alt2': '#56B4E9', // Sky Blue
        '--TextOnMain': '#ffffff',
        '--TextPrimary': '#000000',
        '--TextSecondary': '#333333',
        '--SubdivisionBeatColor': '#E69F00', // Orange - high contrast
        '--HighlightedBeatColor': '#000000', // Black - distinct and high contrast
        '--ActiveBarBackground': 'rgba(0, 114, 178, 0.5)',
        '--BorderColor': '#0072B2',
        '--BorderRadius': '10px',
        '--font-family': '"Roboto Mono", monospace'
    }
};

let mainContainerRef = null; // To store reference to the main 2D UI container

/**
 * Handles the selection of a theme, including switching to/from 3D mode.
 * @param {string} themeName - The name of the theme to apply.
 */
function handleThemeSelection(themeName) {
    if (!document.body) {
        console.error("Document body not found. Cannot apply theme.");
        return;
    }

    const themeJustBeforeThisCall = AppState.getCurrentTheme();

    // Remove previous theme classes from body
    const bodyClasses = Array.from(document.body.classList);
    bodyClasses.forEach(cls => {
        if (cls.endsWith('-theme') && cls !== `${themeName}-theme` && cls !== 'debug-mode') { // Keep debug-mode if present
            document.body.classList.remove(cls);
        }
    });

    // Add new theme class if not already present
    if (!document.body.classList.contains(`${themeName}-theme`)) {
        document.body.classList.add(`${themeName}-theme`);
    }

    if (themeName === '3dRoom') {
        if (ThreeDThemeManager.isActive() && themeJustBeforeThisCall === '3dRoom') {
            // If '3dRoom' is selected again while already active, dispose and re-initialize for a clean state.
            ThreeDThemeManager.dispose();
        }
        ThreeDThemeManager.initialize(mainContainerRef); // Handles hiding mainContainerRef internally
    } else { // Switching to or staying in a 2D theme
        const wasPreviously3DManagerActive = ThreeDThemeManager.isActive(); // Check if renderer, etc., existed

        if (wasPreviously3DManagerActive) {
            // Save camera state before disposing 3D scene
            const camera = SceneManager.getCamera();
            if (camera) {
                AppState.setCameraPosition3D(camera.position);
                if (camera.userData.lookAtPoint) {
                    AppState.setCameraLookAtPoint3D(camera.userData.lookAtPoint);
                }
            }
            ThreeDThemeManager.dispose(); // Handles showing mainContainerRef internally
        }

        // Apply CSS variables for 2D themes
        const theme = themes[themeName] || themes.default;
        for (const [variable, value] of Object.entries(theme)) {
            document.documentElement.style.setProperty(variable, value);
        }

        // If the logical theme state *before this call* was '3dRoom',
        // AND the 3D manager was actually active (renderer existed),
        // AND the new theme is a 2D theme, then we've switched from active 3D to 2D.
        if (themeJustBeforeThisCall === '3dRoom' && wasPreviously3DManagerActive && themeName !== '3dRoom') {
            document.dispatchEvent(new CustomEvent('switchedFrom3DTo2D'));
        }
    }

    localStorage.setItem('selectedTheme', themeName);
    AppState.setCurrentTheme(themeName); // Update AppState's current theme
    console.log(`Theme applied by ThemeController: ${themeName}`);
}

const ThemeController = {
    applyTheme: (themeName) => {
        // Now delegates to handleThemeSelection which manages both 2D and 3D
        if (!themes[themeName] && themeName !== '3dRoom') {
            console.warn(`Theme "${themeName}" not found. Applying default.`);
            handleThemeSelection('default');
            return;
        }
        handleThemeSelection(themeName);
    },

    is3DSceneActive: () => {
        // Check if 3D manager is active AND current theme in AppState is '3dRoom'
        return ThreeDThemeManager.isActive() && AppState.getCurrentTheme() === '3dRoom';
    },

    initializeThemeControls: () => {
        mainContainerRef = document.querySelector('.main-container');
        if (!mainContainerRef) {
            // This is a critical element for hiding/showing UI.
            console.error('.main-container not found! Theme switching might not work correctly.');
        }
        // DOM.themeButtons is a NodeList
        DOM.themeButtons.forEach(button => {
            button.addEventListener('click', () => {
                handleThemeSelection(button.dataset.theme); // Use the internal handler
            });
        });

        // Load and apply saved theme or default on initialization
        const savedTheme = localStorage.getItem('selectedTheme');
        let themeToLoad = 'default'; 

        if (savedTheme && (themes[savedTheme] || savedTheme === '3dRoom')) { // If a valid theme (2D or 3D) is saved
            themeToLoad = savedTheme;
        }
        handleThemeSelection(themeToLoad);
    },

    updatePlayheadVisuals: (containerIndex, barIndex, beatInBarWithSubdivisions, beatMultiplier) => {
        if (ThemeController.is3DSceneActive()) {
            ThreeDThemeManager.updatePlayheadVisuals(containerIndex, barIndex, beatInBarWithSubdivisions, beatMultiplier);
        }
    },

    clearAll3DVisualHighlights: () => {
        if (ThemeController.is3DSceneActive()) {
            ThreeDThemeManager.clearAllVisualHighlights();
        }
    },

    syncCurrentPageWithSelectedBar: () => {
        if (ThemeController.is3DSceneActive()) {
            return ThreeDThemeManager.syncCurrentPageWithSelectedBar();
        }
        return false; // Page did not change
    },

    /**
     * Rebuilds 3D measures. Typically called when bar settings change significantly.
     */
    rebuild3DMeasures: () => {
        if (ThemeController.is3DSceneActive()) {
            ThreeDThemeManager.rebuildMeasuresAndBeats();
        }
    },
    /**
     * Updates 3D control labels and rebuilds measures.
     * Call this after AppState changes that affect 3D display.
     * Renamed from update3DControlsPostStateChange for clarity.
     */
    update3DScenePostStateChange: () => {
        if (ThemeController.is3DSceneActive()) {
            ThreeDThemeManager.update3DScenePostStateChange();
        }
    }
};

export default ThemeController;