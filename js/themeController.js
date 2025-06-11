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
    default: {
        '--Main': '#c000a0', // Deep Pink/Magenta
        '--Background': '#f0f0f0', // Light Gray
        '--Accent': '#ffe0b2', // Pale Orange/Peach
        '--Highlight': '#a0faa0', // Light Green
        '--Alt1': '#4682b4', // Steel Blue
        '--Alt2': '#dc143c', // Crimson Red
        '--TextOnMain': '#ffffff', // White
        '--TextPrimary': '#333333', // Dark Gray
        '--TextSecondary': '#555555', // Medium Gray
        '--SubdivisionBeatColor': '#ffa07a', // Light Salmon
        '--ActiveBarBackground': 'var(--Alt1)', // Example: 'rgba(70, 130, 180, 0.2)'
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '20px' // Slightly rounded
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
        '--TextSecondary': 'var(--Alt1)', // Medium Light Gray
        '--SubdivisionBeatColor': 'var(--Highlight)', // Bright Yellow (Corrected to use Accent for yellow)
        '--ActiveBarBackground': 'var(--Accent)', // Bright Yellow
        '--BorderColor': 'var(--Accent)', // Set to transparent for flat look
        '--BorderRadius': '7px' // Sharper than default
    },
    synthwave: {
        '--Main': '#ff00ff', // Magenta
        '--Background': '#0f0241', // Deep Indigo/Dark Purple
        '--Accent': '#7b00ff', // Electric Purple
        '--Highlight': '#008090', // Teal
        '--Alt1': '#ff69b4', // Hot Pink
        '--Alt2': '#7b00ff', // Electric Purple (same as Accent)
        '--TextOnMain': '#ffffff', // White
        '--TextPrimary': '#eeeeee', // Black (often on lighter elements if any)
        '--TextSecondary': 'var(--Alt1)', // Very Dark Gray
        '--SubdivisionBeatColor': '#00f0ff', // Cyan
        '--ActiveBarBackground': 'var(--Alt1)', // Example: 'rgba(255, 105, 180, 0.2)'
        '--BorderColor': 'var(--Alt1)', // Set to transparent for flat look
        '--BorderRadius': '50%' // For circular/pill shapes
    },
    gundam: {
        '--Main': '#0050a0', // Gundam Blue
        '--Background': '#e8e8e8', // Light Gray (Gundam White)
        '--Accent': '#cc0000', // Gundam Red
        '--Highlight': '#ffd700', // Gundam Yellow (Gold)
        '--Alt1': '#4a4a4a', // Dark Gray (Inner Frame/Details)
        '--Alt2': '#d04000', // Orange-Red (Thrusters/Accents)
        '--TextOnMain': '#ffffff', // White
        '--TextPrimary': '#222222', // Dark Gray
        '--TextSecondary': '#555555', // Medium Gray
        '--SubdivisionBeatColor': '#87cefa', // Light Sky Blue (Beam Saber effect) 
        '--ActiveBarBackground': 'var(--Main)', // Uses Gundam Blue from --Main
        '--BorderColor': 'var(--Main)', // Set to transparent for flat look
        '--BorderRadius': '0px' // Hard squares
    },
    helloKitty: {
        '--Main': '#ff99cc', // Hello Kitty Pink
        '--Background': '#ffffff', // White
        '--Accent': '#ff3366', // Brighter Pink/Red for accents
        '--Highlight': '#66ccff', // Light Blue
        '--Alt1': '#fdfd96', // Pale Yellow (Nose/Flower center)
        '--Alt2': '#ff6699', // Deeper Pink
        '--TextOnMain': '#ffffff',
        '--TextPrimary': '#333333',
        '--TextSecondary': '#555555',
        '--SubdivisionBeatColor': '#ffcce5', // Lighter Pink
        '--ActiveBarBackground': 'var(--Main)',
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '15px' // Cute and rounded
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
        '--SubdivisionBeatColor': '#ffeb99', // Lighter Yellow
        '--ActiveBarBackground': 'var(--Highlight)',
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '10px' // Softly rounded
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
        '--SubdivisionBeatColor': '#7cfd54', // Pistachio Green
        '--ActiveBarBackground': 'var(--Accent)',
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '25px' // Scoopy and round
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

    updatePlayheadVisuals: (barIndex, beatInBarWithSubdivisions, beatMultiplier) => {
        if (ThemeController.is3DSceneActive()) {
            ThreeDThemeManager.updatePlayheadVisuals(barIndex, beatInBarWithSubdivisions, beatMultiplier);
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