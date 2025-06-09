/**
 * 3dTheme.js
 * This module manages the Three.js 3D "Room" theme, including scene setup,
 * object creation, user interactions, and visual updates.
 * NOTE: Ensure Three.js is loaded in your HTML before this script if using the global `THREE`.
 */
import DOM from './domSelectors.js';
import AppState from './appState.js';
import ThemeController from './themeController.js'; // Added for applying themes

// --- THREE.JS Global Variables (scoped to this module) ---
let scene, camera, renderer, animationFrameId;
let threeJsCanvas = null;
let mainContainerRef = null; // To store reference to the main 2D UI container passed during init
let controlsGroup = null; // Group for 3D control buttons
let measuresGroup = null; // Group for measures and beats

let loadedFont = null; // Will be set by FontLoader

let selectedMeasureWireframeMesh = null; // Tracks the wireframe of the user-selected measure
let selectedMeasureBoxMesh = null;

// Define default theme colors for 3D elements, to avoid repeated lookups and ensure consistency
const defaultThemeColors3D = {
    main: new THREE.Color('#c000a0'), // Deep Pink/Magenta
    background: new THREE.Color('#f0f0f0'), // Light Gray
    accent: new THREE.Color('#ffe0b2'), // Pale Orange/Peach
    highlight: new THREE.Color('#a0faa0'), // Light Green
    alt1: new THREE.Color('#4682b4'), // Steel Blue
    alt2: new THREE.Color('#dc143c'), // Crimson Red
    textOnMain: new THREE.Color('#ffffff'), // White
    textPrimary: new THREE.Color('#333333'), // Dark Gray
    textSecondary: new THREE.Color('#555555'), // Medium Gray
    subdivisionBeat: new THREE.Color('#ffa07a'), // Light Salmon
};

const DEFAULT_MEASURE_COLOR = defaultThemeColors3D.alt1.clone(); // Changed from textPrimary for less grey
const SELECTED_MEASURE_COLOR = defaultThemeColors3D.main.clone(); // User clicked selection
const PLAYHEAD_SELECTED_MEASURE_COLOR = defaultThemeColors3D.alt1.clone(); // Playhead active measure

// Store references to text meshes that need dynamic updates
const dynamicTextMeshes = {
    tempoValue: null,
    volumeValue: null,
    subdivisionValue: null,
    presetSlotValue: null,
    presetNameValue: null,
    beatsValue: null, // Added for beats display
    barsValue: null,  // Added for bars display
};

// --- Layout Constants ---
const BUTTON_Y_POSITION = -2.0; // Y position for buttons on the floor, slightly lower
const mainButtonHeight = 0.2;
const smallButtonRadius = 0.3;
const themeButtonHeight = 0.15;

const yPositionForLabelsAboveButtons = BUTTON_Y_POSITION + mainButtonHeight + 0.15;
const yPositionForSectionHeaderLabels = BUTTON_Y_POSITION + mainButtonHeight + 0.35;
const yPositionForThemeLabels = BUTTON_Y_POSITION + themeButtonHeight + 0.12; // Y for individual theme button text
const yPositionForThemeSectionHeader = BUTTON_Y_POSITION + themeButtonHeight + 0.32; // Y for "Switch to 2D Theme:"

const LABEL_TEXT_COLOR = defaultThemeColors3D.textOnMain;
const DEFAULT_MEASURE_OPACITY = 0.3;
const SELECTED_MEASURE_OPACITY = 0.6;
const PLAYHEAD_SELECTED_MEASURE_OPACITY = 0.45;

// --- Beat Highlighting Colors for 3D ---
const MAIN_BEAT_COLOR_3D_DEFAULT = defaultThemeColors3D.highlight.clone();
const SUB_BEAT_COLOR_3D_DEFAULT = defaultThemeColors3D.subdivisionBeat.clone();
const HIGHLIGHT_COLOR_3D = defaultThemeColors3D.accent.clone();
const BEAT_HIGHLIGHT_Y_OFFSET = 0.2; // How much the highlighted beat cube raises

let currentHighlightedBeat3D = { bar: -1, beat: -1 }; // Tracks the currently highlighted beat in 3D
let currentPlayheadBarIndex = -1; // Tracks the bar index currently highlighted by the playhead

// --- Beat Cube Layout Constants for 3D ---
const BEAT_CUBE_HALF_SIDE_3D = 0.15; // Size of the beat cube itself
const MIN_SPHERE_SURFACE_SPACING_3D = 0.15; // Increased spacing between individual beat cubes
const GROUP_SIZE_3D = 4;
const GROUP_GAP_3D = 0.25; // Increased spacing between groups of 4 beat cubes

// --- Measure Pagination Constants for 3D ---
const MEASURES_PER_PAGE_3D = 4;
let currentMeasurePage3D = 0;
let totalMeasurePages3D = 0;

// --- HELPER FUNCTIONS ---
function getSelectedOptionText(selectElement) {
    if (selectElement && selectElement.options && selectElement.selectedIndex !== -1) {
        return selectElement.options[selectElement.selectedIndex].text;
    }
    return "";
}

function addTextLabel(text, font, size, textColor, textPosition, textRotation = { x: -Math.PI / 2, y: 0, z: 0 }) {
    if (!font || (text === null || typeof text === 'undefined') || !controlsGroup) {
        console.warn("Font, text, or controlsGroup not available for addTextLabel", { font, text, controlsGroupPresent: !!controlsGroup });
        return null;
    }

    const textGeo = new THREE.TextGeometry(text, {
        font: font,
        size: size,
        height: 0.03,
        curveSegments: 4,
        bevelEnabled: false
    });

    textGeo.computeBoundingBox();
    const textBoundingBox = textGeo.boundingBox;
    const textWidth = textBoundingBox.max.x - textBoundingBox.min.x;

    const textMat = new THREE.MeshBasicMaterial({ color: textColor, transparent: true, opacity: 0.9 });
    const textMesh = new THREE.Mesh(textGeo, textMat);

    textMesh.position.set(textPosition.x - textWidth / 2, textPosition.y, textPosition.z + size * 0.5);
    textMesh.rotation.set(textRotation.x, textRotation.y, textRotation.z);

    controlsGroup.add(textMesh);
    return textMesh;
}

function updateOrAddTextLabel(meshKey, newText, font, size, textColor, textPosition, textRotation = { x: -Math.PI / 2, y: 0, z: 0 }) {
    if (!font || !controlsGroup) return;

    if (dynamicTextMeshes[meshKey]) {
        controlsGroup.remove(dynamicTextMeshes[meshKey]);
        if (dynamicTextMeshes[meshKey].geometry) dynamicTextMeshes[meshKey].geometry.dispose();
        if (dynamicTextMeshes[meshKey].material) dynamicTextMeshes[meshKey].material.dispose();
        dynamicTextMeshes[meshKey] = null;
    }

    const textMesh = addTextLabel(newText, font, size, textColor, textPosition, textRotation);
    if (textMesh) {
        dynamicTextMeshes[meshKey] = textMesh;
    }
    return textMesh;
}

function createCircularButton(name, color, position, radius = 0.6, height = 0.2) {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
    const material = new THREE.MeshStandardMaterial({ color: color, metalness: 0.3, roughness: 0.6 });
    const button = new THREE.Mesh(geometry, material);
    button.name = name;
    button.position.set(position.x, BUTTON_Y_POSITION + height / 2, position.z);
    button.castShadow = true;
    button.receiveShadow = true;
    controlsGroup.add(button);
    return button;
}

// --- CORE 3D SCENE FUNCTIONS ---
function internalCreate3DControls() {
    if (!controlsGroup || !loadedFont) {
        console.warn("Cannot create 3D controls: controlsGroup or font not ready.");
        return;
    }
    // Clear previous controls if any (safer for re-initialization scenarios)
    while (controlsGroup.children.length > 0) {
        const child = controlsGroup.children[0];
        controlsGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    }
    // Reset dynamic text meshes
    for (const key in dynamicTextMeshes) {
        dynamicTextMeshes[key] = null;
    }

    // Label Sizes
    const mainStartStopLabelSize = 0.1;
    const tapResetLabelSize = 0.12;
    const plusMinusLabelSize = 0.18;
    const valueLabelSize = 0.14;
    const controlGroupLabelSize = 0.12;
    const presetSlotSubdivLabelSize = 0.1;
    const presetNameLabelSize = 0.1;
    const saveLoadLabelSize = 0.1;
    const measuresPagingLabelSize = 0.09;
    const themeSwitcherButtonLabelSize = 0.08;
    const themeSectionHeaderLabelSize = 0.1;

    let btnPos;

    // Z Rows for controls - pushed further back for more spacing
    const zRow1 = 3.5;    // Start/Stop, Tap, Reset
    const zRow2 = 2.2;    // Tempo, Volume
    const zRow3 = 0.8;   // Beats, Bars, Subdivision
    const zRow4 = -0.7;   // Presets
    const measuresPagingZ = -2.0; // Measures paging buttons
    const zRowThemes1 = -3.5; // Theme buttons row 1
    const zRowThemes2 = -4.3; // Theme buttons row 2

    // Row 1: Start/Stop, Tap Tempo, Reset
    btnPos = { x: 0, z: zRow1 };
    createCircularButton("startStopButton3D", defaultThemeColors3D.highlight, btnPos, .8, mainButtonHeight);
    addTextLabel("Start/Stop", loadedFont, mainStartStopLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: btnPos.z });

    btnPos = { x: -1.5, z: zRow1 }; // Increased spread
    createCircularButton("tapTempoButton3D", defaultThemeColors3D.alt1, btnPos, 0.45, mainButtonHeight); // Slightly larger tap tempo
    addTextLabel("Tap", loadedFont, tapResetLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: btnPos.z });

    btnPos = { x: 1.5, z: zRow1 }; // Increased spread
    createCircularButton("resetButton3D", defaultThemeColors3D.accent, btnPos, 0.45, mainButtonHeight); // Slightly larger reset
    addTextLabel("Reset", loadedFont, tapResetLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: btnPos.z });

    // Row 2: Tempo, Volume
    addTextLabel("Tempo", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: -1.85, y: yPositionForSectionHeaderLabels+2, z: zRow2 });
    btnPos = { x: -2.8, z: zRow2 }; // Increased spread
    createCircularButton("decreaseTempoButton3D", defaultThemeColors3D.alt2, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("-", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow2 });
    updateOrAddTextLabel("tempoValue", AppState.getTempo().toString(), loadedFont, valueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: yPositionForLabelsAboveButtons, z: zRow2 });
    btnPos = { x: -1.6, z: zRow2 }; // Increased spread
    createCircularButton("increaseTempoButton3D", defaultThemeColors3D.highlight, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("+", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow2 });

    addTextLabel("Volume", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 1.85, y: yPositionForSectionHeaderLabels +2, z: zRow2 });
    btnPos = { x: 1.6, z: zRow2 }; // Increased spread
    createCircularButton("decreaseVolumeButton3D", defaultThemeColors3D.alt2, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("-", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow2 });
    updateOrAddTextLabel("volumeValue", `${Math.round(AppState.getVolume() * 100)}%`, loadedFont, valueLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: yPositionForLabelsAboveButtons, z: zRow2 });
    btnPos = { x: 2.8, z: zRow2 }; // Increased spread
    createCircularButton("increaseVolumeButton3D", defaultThemeColors3D.highlight, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("+", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow2 });

    // Row 3: Beats, Bars, Subdivision
    addTextLabel("Beats", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: -1.5, y: yPositionForSectionHeaderLabels +4, z: zRow3 });
    btnPos = { x: -2.8, z: zRow3 };
    createCircularButton("decreaseBeatsButton3D", defaultThemeColors3D.alt2, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("-", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow3 });
    const beatsDisplay = AppState.getBarSettings()[AppState.getSelectedBarIndex()] || AppState.getBarSettings()[0] || 4;
    updateOrAddTextLabel("beatsValue", beatsDisplay.toString(), loadedFont, valueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: yPositionForLabelsAboveButtons, z: zRow3 });
    btnPos = { x: -1.6, z: zRow3 };
    createCircularButton("increaseBeatsButton3D", defaultThemeColors3D.highlight, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("+", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow3 });

    addTextLabel("Bars", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 0, y: yPositionForSectionHeaderLabels + 4, z: zRow3 });
    btnPos = { x: -0.6, z: zRow3 };
    createCircularButton("decreaseBarsButton3D", defaultThemeColors3D.alt2, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("-", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow3 });
    if (typeof AppState.getBarSettings === 'function' && AppState.getBarSettings()) updateOrAddTextLabel("barsValue", AppState.getBarSettings().length.toString(), loadedFont, valueLabelSize, LABEL_TEXT_COLOR, { x: 0, y: yPositionForLabelsAboveButtons, z: zRow3 });
    btnPos = { x: 0.6, z: zRow3 };
    createCircularButton("increaseBarsButton3D", defaultThemeColors3D.highlight, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel("+", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow3 });

    addTextLabel("Subdivision", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 1.3, y: yPositionForSectionHeaderLabels+5, z: zRow3 });
    btnPos = { x: 1.6, z: zRow3 };
    createCircularButton("prevSubdivisionButton3D", defaultThemeColors3D.alt1, btnPos, smallButtonRadius, mainButtonHeight); // Changed color
    addTextLabel("<", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow3 });
    if (DOM.beatMultiplierSelect) updateOrAddTextLabel("subdivisionValue", getSelectedOptionText(DOM.beatMultiplierSelect), loadedFont, presetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: yPositionForLabelsAboveButtons, z: zRow3 });
    btnPos = { x: 2.8, z: zRow3 };
    createCircularButton("nextSubdivisionButton3D", defaultThemeColors3D.textSecondary, btnPos, smallButtonRadius, mainButtonHeight);
    addTextLabel(">", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow3 });

    // Row 4: Presets
    addTextLabel("Preset Slot", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: -1.2, y: yPositionForSectionHeaderLabels +6, z: zRow4 });
    btnPos = { x: -2.8, z: zRow4 };
    createCircularButton("prevPresetSlotButton3D", defaultThemeColors3D.highlight, btnPos, 0.35, mainButtonHeight);
    addTextLabel("<", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow4 });
    if (DOM.presetSlotSelect) updateOrAddTextLabel("presetSlotValue", getSelectedOptionText(DOM.presetSlotSelect), loadedFont, presetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: yPositionForLabelsAboveButtons, z: zRow4 });
    btnPos = { x: -1.6, z: zRow4 };
    createCircularButton("nextPresetSlotButton3D", defaultThemeColors3D.alt1, btnPos, 0.35, mainButtonHeight);
    addTextLabel(">", loadedFont, plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: zRow4 });

    addTextLabel("Song Name", loadedFont, controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 0, y: yPositionForSectionHeaderLabels, z: zRow4 });
    const presetNameDisplayWidth = 1.5;
    const presetNameDisplayGeometry = new THREE.BoxGeometry(presetNameDisplayWidth, mainButtonHeight, 0.5);
    const presetNameDisplayMaterial = new THREE.MeshStandardMaterial({ color: defaultThemeColors3D.alt1 }); // Changed color
    const presetNameDisplayBox = new THREE.Mesh(presetNameDisplayGeometry, presetNameDisplayMaterial);
    presetNameDisplayBox.position.set(0, BUTTON_Y_POSITION + mainButtonHeight / 2, zRow4);
    controlsGroup.add(presetNameDisplayBox);
    if (DOM.presetNameInput) updateOrAddTextLabel("presetNameValue", DOM.presetNameInput.value.substring(0, 10), loadedFont, presetNameLabelSize, LABEL_TEXT_COLOR, { x: 0, y: yPositionForLabelsAboveButtons, z: zRow4 + 0.01 });

    btnPos = { x: 1.8, z: zRow4 }; // Increased spread
    createCircularButton("savePresetButton3D", defaultThemeColors3D.highlight, btnPos, 0.35, mainButtonHeight); // Changed color
    addTextLabel("Save", loadedFont, saveLoadLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: btnPos.z });
    btnPos = { x: 2.6, z: zRow4 }; // Increased spread
    createCircularButton("loadPresetButton3D", defaultThemeColors3D.alt1, btnPos, 0.35, mainButtonHeight); // Changed color
    addTextLabel("Load", loadedFont, saveLoadLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForLabelsAboveButtons, z: btnPos.z });

    // Measures Paging Buttons
    const measuresPagingButtonRadius = 0.3;
    const measuresPagingYForLabel = BUTTON_Y_POSITION + themeButtonHeight + 0.12; // Using themeButtonHeight as it's similar

    btnPos = { x: -2.8, z: measuresPagingZ }; // Increased spread
    createCircularButton("prevMeasuresPageButton3D", defaultThemeColors3D.alt2, btnPos, measuresPagingButtonRadius, themeButtonHeight);
    addTextLabel("< Measures", loadedFont, measuresPagingLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: measuresPagingYForLabel, z: btnPos.z });

    btnPos = { x: 2.8, z: measuresPagingZ }; // Increased spread
    createCircularButton("nextMeasuresPageButton3D", defaultThemeColors3D.alt1, btnPos, measuresPagingButtonRadius, themeButtonHeight);
    addTextLabel("Measures >", loadedFont, measuresPagingLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: measuresPagingYForLabel, z: btnPos.z });

    // Add Theme Switcher Buttons (to 2D themes)
    const themeButtonRadius = 0.3;
    const themeButtonXPositions = [-2.5, -0.8, 0.8, 2.5]; // Increased spread

    const themesRow1 = [
        { name: "Dark", id: "switchToDarkTheme3D", color: defaultThemeColors3D.textPrimary }, // Dark grey is thematic for "Dark"
        { name: "Light", id: "switchToLightTheme3D", color: defaultThemeColors3D.main },      // Default/Light theme uses Main color
        { name: "Classic", id: "switchToClassicTheme3D", color: defaultThemeColors3D.main }, // Assuming Classic is similar to Light/Default
        { name: "Synth", id: "switchToSynthwaveTheme3D", color: defaultThemeColors3D.alt2 }   // Synth uses Alt2
    ];
    themesRow1.forEach((theme, index) => {
        btnPos = { x: themeButtonXPositions[index], z: zRowThemes1 };
        createCircularButton(theme.id, theme.color, btnPos, themeButtonRadius, themeButtonHeight);
        addTextLabel(theme.name, loadedFont, themeSwitcherButtonLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForThemeLabels, z: btnPos.z });
    });

    // Row 2 of Theme Buttons
    const themesRow2 = [
        { name: "Gundam", id: "switchToGundamTheme3D", color: defaultThemeColors3D.alt1 },         // Gundam uses Alt1
        { name: "Kitty", id: "switchToHelloKittyTheme3D", color: defaultThemeColors3D.highlight },// Kitty uses Highlight
        { name: "Beach", id: "switchToBeachTheme3D", color: defaultThemeColors3D.accent },        // Beach uses Accent
        { name: "IceCream", id: "switchToIceCreamTheme3D", color: defaultThemeColors3D.subdivisionBeat } // IceCream uses SubdivisionBeat color
    ];
    themesRow2.forEach((theme, index) => {
        btnPos = { x: themeButtonXPositions[index], z: zRowThemes2 };
        createCircularButton(theme.id, theme.color, btnPos, themeButtonRadius, themeButtonHeight);
        addTextLabel(theme.name, loadedFont, themeSwitcherButtonLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: yPositionForThemeLabels, z: btnPos.z });
    });

    // Add a general label for the theme section
    addTextLabel("Switch to 2D Theme:", loadedFont, themeSectionHeaderLabelSize, LABEL_TEXT_COLOR,
        { x: 0, y: yPositionForThemeSectionHeader, z: zRowThemes1 },
        { x: -Math.PI / 2, y: 0, z: 0 }
    );

}

function internalCreate3DMeasuresAndBeats() {
    if (!measuresGroup) {
        console.warn("Cannot create 3D measures/beats: measuresGroup not ready.");
        return;
    }
    while (measuresGroup.children.length) {
        const child = measuresGroup.children[0];
        measuresGroup.remove(child);
        // Dispose geometry and material of children if they are meshes
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
        // If children have their own children (like measureBox having beatCubes or wireframes)
        // a recursive disposal might be needed if not handled by scene.clear() during full dispose.
        // For now, this simple removal is for rebuilding.
    }
    currentPlayheadBarIndex = -1;
    currentHighlightedBeat3D = { bar: -1, beat: -1 };
    const selectedBarGlobalIndex = AppState.getSelectedBarIndex();

    if (selectedMeasureWireframeMesh) {
        selectedMeasureWireframeMesh.parent?.remove(selectedMeasureWireframeMesh);
        selectedMeasureWireframeMesh.geometry.dispose();
        selectedMeasureWireframeMesh.material.dispose();
        selectedMeasureWireframeMesh = null;
    }
    selectedMeasureBoxMesh = null;

    const beatMultiplier = AppState.getBeatMultiplier();
    let barSettings = AppState.getBarSettings();
    if (!barSettings || barSettings.length === 0) {
        barSettings = [4];
    }
    const totalMeasuresGlobal = barSettings.length;

    if (totalMeasuresGlobal > 0) {
        totalMeasurePages3D = Math.ceil(totalMeasuresGlobal / MEASURES_PER_PAGE_3D);
        currentMeasurePage3D = Math.max(0, Math.min(currentMeasurePage3D, totalMeasurePages3D - 1));
    } else {
        totalMeasurePages3D = 0;
        currentMeasurePage3D = 0;
    }

    const startIndex = currentMeasurePage3D * MEASURES_PER_PAGE_3D;
    const endIndex = Math.min(startIndex + MEASURES_PER_PAGE_3D, totalMeasuresGlobal);
    const numMeasuresOnCurrentPage = endIndex - startIndex;

    const measureBoxWidth = 3.5; // Slightly wider
    const measureBoxHeight = 1;
    const measureBoxDepth = 1.5;
    const measureSpacing = 1.0; // Increased spacing between measures
    const measuresZ = 6; // Pushed measures further back

    const currentPageDisplayWidth = numMeasuresOnCurrentPage * measureBoxWidth + (numMeasuresOnCurrentPage > 1 ? (numMeasuresOnCurrentPage - 1) * measureSpacing : 0);

    for (let i = 0; i < numMeasuresOnCurrentPage; i++) {
        const globalBarIndex = startIndex + i;

        const measureGeometry = new THREE.BoxGeometry(measureBoxWidth, measureBoxHeight, measureBoxDepth);
        const measureMaterial = new THREE.MeshStandardMaterial({
            color: DEFAULT_MEASURE_COLOR.clone(),
            transparent: true,
            opacity: DEFAULT_MEASURE_OPACITY,
            side: THREE.DoubleSide,
        });
        const measureBox = new THREE.Mesh(measureGeometry, measureMaterial);
        measureBox.name = `measureBox_${globalBarIndex}`;
        const xPos = (i * (measureBoxWidth + measureSpacing)) - currentPageDisplayWidth / 2 + measureBoxWidth / 2;
        measureBox.position.set(xPos, BUTTON_Y_POSITION + measureBoxHeight / 2 + 0.5, measuresZ);
        measureBox.castShadow = true;
        measureBox.receiveShadow = true;
        measuresGroup.add(measureBox);

        const subBeatsInThisMeasure = (barSettings[globalBarIndex] || 4) * beatMultiplier;
        let requiredWidthForCubes = 0;
        const cubeSideLength = BEAT_CUBE_HALF_SIDE_3D * 2;

        if (subBeatsInThisMeasure > 0) {
            requiredWidthForCubes = subBeatsInThisMeasure * cubeSideLength;
            if (subBeatsInThisMeasure > 1) {
                requiredWidthForCubes += (subBeatsInThisMeasure - 1) * MIN_SPHERE_SURFACE_SPACING_3D;
                const numberOfGroupGaps = Math.floor((subBeatsInThisMeasure - 1) / GROUP_SIZE_3D);
                requiredWidthForCubes += numberOfGroupGaps * GROUP_GAP_3D;
            }
        }

        let currentCubeX = (subBeatsInThisMeasure > 0) ? -requiredWidthForCubes / 2 + BEAT_CUBE_HALF_SIDE_3D : 0;

        for (let j = 0; j < subBeatsInThisMeasure; j++) {
            const beatGeometry = new THREE.BoxGeometry(cubeSideLength, cubeSideLength, cubeSideLength);
            const isMainBeat = j % beatMultiplier === 0;
            const beatMaterial = new THREE.MeshStandardMaterial({ color: isMainBeat ? MAIN_BEAT_COLOR_3D_DEFAULT : SUB_BEAT_COLOR_3D_DEFAULT });
            const beatCube = new THREE.Mesh(beatGeometry, beatMaterial);
            beatCube.name = `beatSphere_${globalBarIndex}_${j}`;
            beatCube.position.set(currentCubeX, 0, 0);
            beatCube.castShadow = true;
            measureBox.add(beatCube);

            currentCubeX += cubeSideLength + MIN_SPHERE_SURFACE_SPACING_3D;
            if ((j + 1) % GROUP_SIZE_3D === 0 && j < subBeatsInThisMeasure - 1) {
                currentCubeX += GROUP_GAP_3D;
            }
        }
    }

    if (selectedBarGlobalIndex >= startIndex && selectedBarGlobalIndex < endIndex) {
        const selectedMeasureBoxOnPage = measuresGroup.getObjectByName(`measureBox_${selectedBarGlobalIndex}`);
        if (selectedMeasureBoxOnPage) {
            selectedMeasureBoxOnPage.material.color.set(SELECTED_MEASURE_COLOR);
            selectedMeasureBoxOnPage.material.opacity = SELECTED_MEASURE_OPACITY;


            const wireframeGeometry = new THREE.WireframeGeometry(selectedMeasureBoxOnPage.geometry);
            const wireframeMaterial = new THREE.LineBasicMaterial({ color: SELECTED_MEASURE_COLOR });
            selectedMeasureWireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
            selectedMeasureBoxOnPage.add(selectedMeasureWireframeMesh);
            selectedMeasureBoxMesh = selectedMeasureBoxOnPage;
        }
    }
}

function internalInitializeScene(_mainContainerRef) {
    if (renderer) return; // Already initialized
    if (!THREE) {
        console.error("THREE.js is not loaded. Cannot initialize 3D scene.");
        return;
    }
    mainContainerRef = _mainContainerRef; // Store the passed reference

    scene = new THREE.Scene();
    scene.background = defaultThemeColors3D.background;

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000); // Slightly reduced FOV
    camera.position.set(0, 12, 0); // Moved slightly higher
    camera.lookAt(0, -1.5, 0); // Adjusted lookAt

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(40, 40, -50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    scene.add(directionalLight);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    threeJsCanvas = renderer.domElement;
    threeJsCanvas.id = 'threejs-canvas';
    document.body.appendChild(threeJsCanvas);

    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: defaultThemeColors3D.alt1, side: THREE.DoubleSide }); // Changed floor color
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = BUTTON_Y_POSITION;
    floor.receiveShadow = true;
    scene.add(floor);

    controlsGroup = new THREE.Group();
    scene.add(controlsGroup);

    measuresGroup = new THREE.Group();
    scene.add(measuresGroup);

    const fontLoader = new THREE.FontLoader();
    fontLoader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json',
        function (font) {
            loadedFont = font;
            console.log("3dTheme: Font loaded successfully.");
            internalCreate3DControls();
            internalCreate3DMeasuresAndBeats();
        },
        undefined,
        function (error) {
            console.error('3dTheme: Font loading failed:', error);
            // Fallback: Initialize scene without text labels if font fails
            internalCreate3DControls(); // Will add buttons, but text labels will fail gracefully
            internalCreate3DMeasuresAndBeats();
        }
    );

    internalAnimateScene();
    window.addEventListener('resize', onThreeJSWindowResize, false);
    window.addEventListener('click', onThreeJSSceneClick, false);
    console.log("3dTheme: Three.js scene initialization sequence started.");
}

function internalDisposeScene() {
    if (!renderer) return;
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', onThreeJSWindowResize);
    window.removeEventListener('click', onThreeJSSceneClick);

    if (scene) {
        // Dispose of all meshes, geometries, materials
        scene.traverse(object => {
            if (object.isMesh) {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => {
                            if (mat.map) mat.map.dispose();
                            mat.dispose();
                        });
                    } else {
                        if (object.material.map) object.material.map.dispose();
                        object.material.dispose();
                    }
                }
            }
        });
        scene.clear(); // Removes all children, lights, etc.
    }

    // Explicitly nullify groups after clearing scene to help GC
    // The groups themselves are children of the scene, so scene.clear() handles them.
    // However, references should be nulled.
    controlsGroup = null;
    measuresGroup = null;

    if (selectedMeasureWireframeMesh) { // Should be cleared by scene traversal if added to scene object
        if (selectedMeasureWireframeMesh.geometry) selectedMeasureWireframeMesh.geometry.dispose();
        if (selectedMeasureWireframeMesh.material) selectedMeasureWireframeMesh.material.dispose();
        selectedMeasureWireframeMesh = null;
    }

    renderer.dispose();
    if (threeJsCanvas && threeJsCanvas.parentNode) {
        threeJsCanvas.parentNode.removeChild(threeJsCanvas);
    }

    // Reset all state variables
    scene = null; camera = null; renderer = null; threeJsCanvas = null; animationFrameId = null;
    loadedFont = null;
    selectedMeasureBoxMesh = null;
    currentPlayheadBarIndex = -1;
    currentHighlightedBeat3D = { bar: -1, beat: -1 };
    currentMeasurePage3D = 0;
    totalMeasurePages3D = 0;
    for (const key in dynamicTextMeshes) { // Clear text mesh references
        dynamicTextMeshes[key] = null;
    }

    console.log("3dTheme: Three.js scene disposed.");
}

function onThreeJSWindowResize() {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

function internalAnimateScene() {
    animationFrameId = requestAnimationFrame(internalAnimateScene);
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

function onThreeJSSceneClick(event) {
    if (!renderer || !camera || !scene || !controlsGroup || !measuresGroup) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Check intersects with controlsGroup and measuresGroup children
    const intersects = raycaster.intersectObjects([...controlsGroup.children, ...measuresGroup.children], true);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        let isButtonInteraction = false;

        const animateClick = (obj) => {
            isButtonInteraction = true;
            const originalY = obj.position.y;
            const pressDepth = 0.05;
            obj.position.y -= pressDepth;
            setTimeout(() => {
                obj.position.y = originalY;
            }, 100);
        };

        // Use the globally defined Y positions and label sizes
        const currentYPosForLabels = yPositionForLabelsAboveButtons; // For most value updates
        const currentValueLabelSize = 0.14; // Corresponds to valueLabelSize
        const currentPresetSlotSubdivLabelSize = 0.1; // Corresponds to presetSlotSubdivLabelSize
        const currentPresetNameLabelSize = 0.1; // Corresponds to presetNameLabelSize

        // Z positions for control rows
        const zValRow2 = 2.2;
        const zValRow3 = 0.8;
        const zValRow4 = -0.7;

        const name = clickedObject.name;
        if (name === "startStopButton3D") { DOM.startStopBtn?.click(); animateClick(clickedObject); }
        else if (name === "tapTempoButton3D") { DOM.tapTempoBtn?.click(); animateClick(clickedObject); }
        else if (name === "resetButton3D") { DOM.resetButton?.click(); animateClick(clickedObject); }
        else if (name === "decreaseTempoButton3D") {
            DOM.decreaseTempoBtn?.click(); animateClick(clickedObject);
            if (loadedFont) updateOrAddTextLabel("tempoValue", AppState.getTempo().toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow2 });
        } else if (name === "increaseTempoButton3D") {
            DOM.increaseTempoBtn?.click(); animateClick(clickedObject);
            if (loadedFont) updateOrAddTextLabel("tempoValue", AppState.getTempo().toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow2 });
        } else if (name === "decreaseVolumeButton3D") {
            if (DOM.volumeSlider) { DOM.volumeSlider.stepDown(); DOM.volumeSlider.dispatchEvent(new Event('input')); }
            animateClick(clickedObject);
            if (loadedFont) updateOrAddTextLabel("volumeValue", `${Math.round(AppState.getVolume() * 100)}%`, loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: currentYPosForLabels, z: zValRow2 });
        } else if (name === "increaseVolumeButton3D") {
            if (DOM.volumeSlider) { DOM.volumeSlider.stepUp(); DOM.volumeSlider.dispatchEvent(new Event('input')); }
            animateClick(clickedObject);
            if (loadedFont) updateOrAddTextLabel("volumeValue", `${Math.round(AppState.getVolume() * 100)}%`, loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: currentYPosForLabels, z: zValRow2 });
        } else if (name === "decreaseBeatsButton3D") {
            DOM.decreaseMeasureLengthBtn?.click();
            animateClick(clickedObject);
            setTimeout(() => {
                const beatsDisplay = AppState.getBarSettings()[AppState.getSelectedBarIndex()] || AppState.getBarSettings()[0] || 4;
                if (loadedFont) updateOrAddTextLabel("beatsValue", beatsDisplay.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow3 });
                internalCreate3DMeasuresAndBeats();
            }, 50); // Allow AppState to update
        } else if (name === "increaseBeatsButton3D") {
            DOM.increaseMeasureLengthBtn?.click();
            animateClick(clickedObject);
            setTimeout(() => {
                const beatsDisplay = AppState.getBarSettings()[AppState.getSelectedBarIndex()] || AppState.getBarSettings()[0] || 4;
                if (loadedFont) updateOrAddTextLabel("beatsValue", beatsDisplay.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow3 });
                internalCreate3DMeasuresAndBeats();
            }, 50);
        } else if (name === "decreaseBarsButton3D") {
            DOM.decreaseBarLengthBtn?.click();
            animateClick(clickedObject);
            setTimeout(() => {
                if (loadedFont && AppState.getBarSettings()) updateOrAddTextLabel("barsValue", AppState.getBarSettings().length.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: 0, y: currentYPosForLabels, z: zValRow3 });
                internalCreate3DMeasuresAndBeats();
            }, 50);
        } else if (name === "increaseBarsButton3D") {
            DOM.increaseBarLengthBtn?.click();
            animateClick(clickedObject);
            setTimeout(() => {
                if (loadedFont && AppState.getBarSettings()) updateOrAddTextLabel("barsValue", AppState.getBarSettings().length.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: 0, y: currentYPosForLabels, z: zValRow3 });
                internalCreate3DMeasuresAndBeats();
            }, 50);
        } else if (name === "prevSubdivisionButton3D") {
            animateClick(clickedObject);
            if (DOM.beatMultiplierSelect && DOM.beatMultiplierSelect.selectedIndex > 0) {
                DOM.beatMultiplierSelect.selectedIndex--;
                DOM.beatMultiplierSelect.dispatchEvent(new Event('change'));
                setTimeout(() => {
                    if (loadedFont) updateOrAddTextLabel("subdivisionValue", getSelectedOptionText(DOM.beatMultiplierSelect), loadedFont, currentPresetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: currentYPosForLabels, z: zValRow3 });
                    internalCreate3DMeasuresAndBeats();
                }, 50);
            }
        } else if (name === "nextSubdivisionButton3D") {
            animateClick(clickedObject);
            if (DOM.beatMultiplierSelect && DOM.beatMultiplierSelect.selectedIndex < DOM.beatMultiplierSelect.options.length - 1) {
                DOM.beatMultiplierSelect.selectedIndex++;
                DOM.beatMultiplierSelect.dispatchEvent(new Event('change'));
                setTimeout(() => {
                    if (loadedFont) updateOrAddTextLabel("subdivisionValue", getSelectedOptionText(DOM.beatMultiplierSelect), loadedFont, currentPresetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: currentYPosForLabels, z: zValRow3 });
                    internalCreate3DMeasuresAndBeats();
                }, 50);
            }
        } else if (name === "prevPresetSlotButton3D") {
            animateClick(clickedObject);
            if (DOM.presetSlotSelect && DOM.presetSlotSelect.selectedIndex > 0) {
                DOM.presetSlotSelect.selectedIndex--;
                DOM.presetSlotSelect.dispatchEvent(new Event('change'));
                if (loadedFont) updateOrAddTextLabel("presetSlotValue", getSelectedOptionText(DOM.presetSlotSelect), loadedFont, currentPresetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow4 });
            }
        } else if (name === "nextPresetSlotButton3D") {
            animateClick(clickedObject);
            if (DOM.presetSlotSelect && DOM.presetSlotSelect.selectedIndex < DOM.presetSlotSelect.options.length - 1) {
                DOM.presetSlotSelect.selectedIndex++;
                DOM.presetSlotSelect.dispatchEvent(new Event('change'));
                if (loadedFont) updateOrAddTextLabel("presetSlotValue", getSelectedOptionText(DOM.presetSlotSelect), loadedFont, currentPresetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow4 });
            }
        } else if (name === "savePresetButton3D") {
            DOM.savePresetButton?.click();
            animateClick(clickedObject);
            if (loadedFont && DOM.presetNameInput) updateOrAddTextLabel("presetNameValue", DOM.presetNameInput.value.substring(0, 10), loadedFont, currentPresetNameLabelSize, LABEL_TEXT_COLOR, { x: 0, y: currentYPosForLabels, z: zValRow4 + 0.01 });
        } else if (name === "loadPresetButton3D") {
            animateClick(clickedObject);
            DOM.loadPresetButton?.click();
            setTimeout(() => {
                if (renderer && scene && camera && AppState.getCurrentTheme() === '3dRoom') {
                    internalCreate3DMeasuresAndBeats(); // Rebuild measures first
                    if (loadedFont) { 
                        updateOrAddTextLabel("tempoValue", AppState.getTempo().toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow2 });
                        updateOrAddTextLabel("volumeValue", `${Math.round(AppState.getVolume() * 100)}%`, loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: currentYPosForLabels, z: zValRow2 });
                        const beatsDisplay = AppState.getBarSettings()[AppState.getSelectedBarIndex()] || AppState.getBarSettings()[0] || 4;
                        updateOrAddTextLabel("beatsValue", beatsDisplay.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow3 });
                        if (AppState.getBarSettings()) updateOrAddTextLabel("barsValue", AppState.getBarSettings().length.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: 0, y: currentYPosForLabels, z: zValRow3 });
                        if (DOM.beatMultiplierSelect) updateOrAddTextLabel("subdivisionValue", getSelectedOptionText(DOM.beatMultiplierSelect), loadedFont, currentPresetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: 2.2, y: currentYPosForLabels, z: zValRow3 });
                        if (DOM.presetSlotSelect) updateOrAddTextLabel("presetSlotValue", getSelectedOptionText(DOM.presetSlotSelect), loadedFont, currentPresetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: currentYPosForLabels, z: zValRow4 });
                        if (DOM.presetNameInput) updateOrAddTextLabel("presetNameValue", DOM.presetNameInput.value.substring(0, 10), loadedFont, currentPresetNameLabelSize, LABEL_TEXT_COLOR, { x: 0, y: currentYPosForLabels, z: zValRow4 + 0.01 });
                    }
                }
            }, 100);
        } else if (name.startsWith("measureBox_")) {
            const barIndex = parseInt(name.split('_')[1], 10);
            handleMeasureBoxClick(clickedObject, barIndex);
            isButtonInteraction = true;
        } else if (name === "prevMeasuresPageButton3D") {
            animateClick(clickedObject);
            if (currentMeasurePage3D > 0) {
                currentMeasurePage3D--;
                internalCreate3DMeasuresAndBeats();
            }
        } else if (name === "nextMeasuresPageButton3D") {
            animateClick(clickedObject);
            if (currentMeasurePage3D < totalMeasurePages3D - 1) {
                currentMeasurePage3D++;
                internalCreate3DMeasuresAndBeats();
            }
        } else if (name === "switchToDarkTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('dark');
        } else if (name === "switchToLightTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('light');
        } else if (name === "switchToClassicTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('classic');
        } else if (name === "switchToSynthwaveTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('synthwave');
        } else if (name === "switchToGundamTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('gundam');
        } else if (name === "switchToHelloKittyTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('helloKitty');
        } else if (name === "switchToBeachTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('beach');
        } else if (name === "switchToIceCreamTheme3D") {
            animateClick(clickedObject); ThemeController.applyTheme('iceCream');
        }

        // If ThemeController.applyTheme was called with a 2D theme,
        // it will handle disposing the 3D scene.
        // No further action needed here for those cases.

        // Ensure isButtonInteraction is set if any theme button was clicked
        // This is implicitly handled if animateClick sets it.
        if (name.startsWith("switchTo") && name.endsWith("Theme3D")) {
            isButtonInteraction = true;
        }
    }
}

function handleMeasureBoxClick(clickedMeasureBoxObject, barIndex) {
    // The clickedObject might be the wireframe if it exists, or the box itself.
    // We need the actual measureBox mesh.
    let actualMeasureBox = clickedMeasureBoxObject;
    if (clickedMeasureBoxObject.parent && clickedMeasureBoxObject.parent.name.startsWith("measureBox_")) {
        actualMeasureBox = clickedMeasureBoxObject.parent;
    }

    if (AppState.getSelectedBarIndex() !== barIndex) {
        AppState.setSelectedBarIndex(barIndex);

        // If there was a previously selected measure, reset its appearance
        if (selectedMeasureBoxMesh) {
            // Remove its wireframe
            selectedMeasureWireframeMesh.parent?.remove(selectedMeasureWireframeMesh);
            selectedMeasureWireframeMesh.geometry.dispose();
            selectedMeasureWireframeMesh.material.dispose();
            selectedMeasureWireframeMesh = null;
        }


        // Reset its material properties if it's not the current playhead bar
        // (updatePlayheadVisuals will handle color if it IS the playhead bar)
        const oldSelectedGlobalIndex = parseInt(selectedMeasureBoxMesh.name.split('_')[1], 10);
        if (oldSelectedGlobalIndex !== currentPlayheadBarIndex) {
            selectedMeasureBoxMesh.material.color.set(DEFAULT_MEASURE_COLOR);
            selectedMeasureBoxMesh.material.opacity = DEFAULT_MEASURE_OPACITY;
        }
        selectedMeasureBoxMesh = null; // Clear old reference

        // Update the beats display text for the newly selected bar
        const beatsDisplay = AppState.getBarSettings()[barIndex] || 4;
        const zValRow3 = 0.8; // Z position for beats value
        const currentValueLabelSize = 0.14; // Corresponds to valueLabelSize
        if (loadedFont) updateOrAddTextLabel("beatsValue", beatsDisplay.toString(), loadedFont, currentValueLabelSize, LABEL_TEXT_COLOR, { x: -2.2, y: yPositionForLabelsAboveButtons, z: zValRow3 });

        // Add wireframe to the newly selected measure box
        if (actualMeasureBox && actualMeasureBox.name === `measureBox_${barIndex}`) {

                        // Set its material to the "selected" state
            actualMeasureBox.material.color.set(SELECTED_MEASURE_COLOR);
            actualMeasureBox.material.opacity = SELECTED_MEASURE_OPACITY;


            const wireframeGeometry = new THREE.WireframeGeometry(actualMeasureBox.geometry);
            const wireframeMaterial = new THREE.LineBasicMaterial({ color: SELECTED_MEASURE_COLOR, linewidth: 2 }); // Thicker line
            const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
            actualMeasureBox.add(wireframe);
            selectedMeasureWireframeMesh = wireframe;
            selectedMeasureBoxMesh = actualMeasureBox; // Store reference to the box itself
        }
    }
}

const ThreeDThemeManager = {
    initialize: function (uiMainContainerRef) {
        internalInitializeScene(uiMainContainerRef);
        if (mainContainerRef) mainContainerRef.style.display = 'none';
    },
    dispose: function () {
        internalDisposeScene();
        if (mainContainerRef) mainContainerRef.style.display = ''; // Show 2D UI
    },
    isActive: function () {
        return !!renderer;
    },
    updatePlayheadVisuals: function (barIndex, beatInBarWithSubdivisions, beatMultiplier) {
        if (!this.isActive() || !measuresGroup || !scene) return;

        if (barIndex >= 0 && AppState.getBarSettings().length > 0) {
            const targetPage = Math.floor(barIndex / MEASURES_PER_PAGE_3D);
            if (targetPage !== currentMeasurePage3D) {
                currentMeasurePage3D = targetPage;
                internalCreate3DMeasuresAndBeats(); // This will also handle selected wireframe
            }
        }

        if (barIndex !== currentPlayheadBarIndex) {
            if (currentPlayheadBarIndex !== -1) {
                const oldMeasureBox = measuresGroup.getObjectByName(`measureBox_${currentPlayheadBarIndex}`);
                if (oldMeasureBox) {
                    if (oldMeasureBox === selectedMeasureBoxMesh) {
                        // Restore user-selected appearance
                        oldMeasureBox.material.color.set(SELECTED_MEASURE_COLOR);
                        oldMeasureBox.material.opacity = SELECTED_MEASURE_OPACITY;
                    } else {
                        // Restore default appearance
                        oldMeasureBox.material.color.set(DEFAULT_MEASURE_COLOR);
                        oldMeasureBox.material.opacity = DEFAULT_MEASURE_OPACITY;
                    }
                }
            }

            const newMeasureBox = measuresGroup.getObjectByName(`measureBox_${barIndex}`);
            if (newMeasureBox) { // Always apply playhead highlight
                newMeasureBox.material.color.set(PLAYHEAD_SELECTED_MEASURE_COLOR);
                newMeasureBox.material.opacity = PLAYHEAD_SELECTED_MEASURE_OPACITY;
            }
            currentPlayheadBarIndex = barIndex;
        }

        if (currentHighlightedBeat3D.bar !== -1 && currentHighlightedBeat3D.beat !== -1) {
            const prevMeasureBox = measuresGroup.getObjectByName(`measureBox_${currentHighlightedBeat3D.bar}`);
            if (prevMeasureBox) {
                const prevBeatSphere = prevMeasureBox.getObjectByName(`beatSphere_${currentHighlightedBeat3D.bar}_${currentHighlightedBeat3D.beat}`);
                if (prevBeatSphere) {
                    const isPrevMainBeat = currentHighlightedBeat3D.beat % beatMultiplier === 0;
                    prevBeatSphere.material.color.set(isPrevMainBeat ? MAIN_BEAT_COLOR_3D_DEFAULT : SUB_BEAT_COLOR_3D_DEFAULT);
                    prevBeatSphere.position.y = 0;
                }
            }
        }

        const currentMeasureBox = measuresGroup.getObjectByName(`measureBox_${barIndex}`);
        if (currentMeasureBox) {
            const beatSphere = currentMeasureBox.getObjectByName(`beatSphere_${barIndex}_${beatInBarWithSubdivisions}`);
            if (beatSphere) {
                beatSphere.material.color.set(HIGHLIGHT_COLOR_3D);
                beatSphere.position.y = BEAT_HIGHLIGHT_Y_OFFSET;
                currentHighlightedBeat3D = { bar: barIndex, beat: beatInBarWithSubdivisions };
            } else {
                currentHighlightedBeat3D = { bar: -1, beat: -1 };
            }
        } else {
            currentHighlightedBeat3D = { bar: -1, beat: -1 };
        }
    },
    clearAllVisualHighlights: function () {
        if (!this.isActive() || !measuresGroup) return;
        const beatMultiplier = AppState.getBeatMultiplier();

        // User selection wireframe is handled by create3DMeasuresAndBeats or click logic
        // This function primarily resets playhead and beat highlights.

        measuresGroup.traverse((object) => {
            if (object.isMesh && object.name && object.name.startsWith('beatSphere_')) {
                const parts = object.name.split('_');
                const beatIndexInSubdivisions = parseInt(parts[2], 10);
                const isMainBeat = beatIndexInSubdivisions % beatMultiplier === 0;
                object.material.color.set(isMainBeat ? MAIN_BEAT_COLOR_3D_DEFAULT : SUB_BEAT_COLOR_3D_DEFAULT);
                object.position.y = 0;
            } else if (object.isMesh && object.name && object.name.startsWith('measureBox_')) {
                // Only reset color if it's not the user-selected box
                if (object !== selectedMeasureBoxMesh) {
                    object.material.color.set(DEFAULT_MEASURE_COLOR);
                    object.material.opacity = DEFAULT_MEASURE_OPACITY;
                }
            }
        });
        currentPlayheadBarIndex = -1;
        currentHighlightedBeat3D = { bar: -1, beat: -1 };
    },
    syncCurrentPageWithSelectedBar: function () {
        if (!this.isActive()) return false;
        const selectedBar = AppState.getSelectedBarIndex();
        const barSettingsLength = AppState.getBarSettings().length;

        if (selectedBar >= 0 && barSettingsLength > 0) {
            const targetPage = Math.floor(selectedBar / MEASURES_PER_PAGE_3D);
            if (targetPage !== currentMeasurePage3D) {
                currentMeasurePage3D = targetPage;
                // The caller (e.g., refreshUIFromState via ThemeController) will typically call rebuildMeasuresAndBeats
                return true; // Page changed, rebuild needed
            }
        }
        return false; // Page did not change
    },
    rebuildMeasuresAndBeats: function () {
        if (!this.isActive()) return;
        internalCreate3DMeasuresAndBeats();
    }
};

export default ThreeDThemeManager;