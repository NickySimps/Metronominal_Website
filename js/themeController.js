/**
 * themeController.js
 * This module manages theme definitions and application.
 */
import DOM from './domSelectors.js';

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
        '--TextOnMain': '#f5f5f5', // Off-White
        '--TextPrimary': '#e0e0e0', // Light Gray
        '--TextSecondary': '#a0a0a8', // Medium Light Gray
        '--SubdivisionBeatColor': 'var(--Highlight)', // Bright Yellow (Corrected to use Accent for yellow)
        '--ActiveBarBackground': 'var(--Accent)', // Bright Yellow
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '7px' // Sharper than default
    },
    synthwave: {
        '--Main': '#ff00ff', // Magenta
        '--Background': '#0d0221', // Deep Indigo/Dark Purple
        '--Accent': '#7b00ff', // Electric Purple
        '--Highlight': '#008090', // Teal
        '--Alt1': '#ff69b4', // Hot Pink
        '--Alt2': '#7b00ff', // Electric Purple (same as Accent)
        '--TextOnMain': '#ffffff', // White
        '--TextPrimary': '#000000', // Black (often on lighter elements if any)
        '--TextSecondary': '#222222', // Very Dark Gray
        '--SubdivisionBeatColor': '#00f0ff', // Cyan
        '--ActiveBarBackground': 'var(--Alt1)', // Example: 'rgba(255, 105, 180, 0.2)'
        '--BorderColor': 'transparent', // Set to transparent for flat look
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
        '--BorderColor': 'transparent', // Set to transparent for flat look
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
        '--Highlight': '#fffacd', // Lemon Chiffon Yellow
        '--Alt1': '#d2691e', // Chocolate Brown
        '--Alt2': '#ff69b4', // Hot Pink (Cherry/Raspberry swirl)
        '--TextOnMain': '#5d3a1a', // Dark Brown text on light pink
        '--TextPrimary': '#5d3a1a', // Chocolate Brown
        '--TextSecondary': '#8b5a2b', // Lighter Brown
        '--SubdivisionBeatColor': '#7cfd54', // Pistachio Green
        '--ActiveBarBackground': 'var(--Accent)',
        '--BorderColor': 'transparent', // Set to transparent for flat look
        '--BorderRadius': '25px' // Scoopy and round
    }
};

const ThemeController = {
    applyTheme: (themeName) => {
        const theme = themes[themeName];
        if (!theme) {
            console.warn(`Theme "${themeName}" not found. Applying default.`);
            ThemeController.applyTheme('default'); // Apply default if requested one is not found
            return;
        }
        for (const [variable, value] of Object.entries(theme)) {
            document.documentElement.style.setProperty(variable, value);
        }
        localStorage.setItem('selectedTheme', themeName);
        // console.log(`Theme applied: ${themeName}`); // Commented out console log
    },

    initializeThemeControls: () => {
        // DOM.themeButtons is a NodeList
        DOM.themeButtons.forEach(button => {
            button.addEventListener('click', () => {
                ThemeController.applyTheme(button.dataset.theme);
            });
        });

        // Load and apply saved theme or default on initialization (Re-enabled persistence)
        const savedTheme = localStorage.getItem('selectedTheme');
        if (savedTheme && themes[savedTheme]) {
            ThemeController.applyTheme(savedTheme);
        } else {
            ThemeController.applyTheme('default');
            console.log("No saved theme found, applying default."); // Added log for default
        }
    }
};

export default ThemeController;