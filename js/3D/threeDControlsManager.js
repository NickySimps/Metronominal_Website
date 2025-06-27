/**
 * threeDControlsManager.js
 * Manages the creation and updating of 3D UI controls (buttons, knobs, labels).
 */
import * as THREE from 'three';
import DOM from '../domSelectors.js';
import AppState from '../appState.js';
import * as SceneManager from './threeDSceneManager.js'; // Added for light intensity label
// Import all constants from threeDConstants.js
import {
    DefaultThemeColors3D, LABEL_TEXT_COLOR, BUTTON_Y_POSITION, TEXT_SIZE_SMALL,
    Y_POS_LABELS_ABOVE_BUTTONS, Y_POS_THEME_LABELS, Y_POS_CONTROL_VALUE_SUB_LABEL, Y_POS_THEME_SECTION_HEADER,
    Y_POS_CAMERA_LIGHT_LABELS,
    Y_POS_CAMERA_LIGHT_SECTION_HEADER, CAMERA_LIGHT_LABEL_SIZE, CAMERA_LIGHT_PLUS_MINUS_LABEL_SIZE,
    CAMERA_LIGHT_ARROW_LABEL_SIZE, CAMERA_LIGHT_SECTION_HEADER_LABEL_SIZE,
    BUTTON_DIM_XLARGE, BUTTON_DIM_LARGE, BUTTON_DIM_MEDIUM, BUTTON_DIM_SMALL,
    BUTTON_HEIGHT_MAIN, BUTTON_HEIGHT_THEME_CAMERA_LIGHT, BUTTON_CORNER_RADIUS_MEDIUM, // Button appearance
    BUTTON_SHAPE_SQUARE, BUTTON_SHAPE_CIRCLE, BUTTON_SHAPE_ROUNDED_SQUARE, // Button shapes
    Z_ROW_MAIN_1, Z_ROW_MAIN_2, Z_ROW_MAIN_3, Z_ROW_MAIN_4, Z_ROW_MEASURES_PAGING, // Main control rows
    X_POS_THEME_COLUMN, Z_POS_THEME_HEADER, Z_POS_THEME_START, THEME_BUTTON_VERTICAL_SPACING, // Theme column
    X_POS_CAMERA_LIGHT_COLUMN, CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET, Z_POS_CAMERA_LIGHT_HEADER_START, // C/L column    
    KNOB_RADIUS, KNOB_HEIGHT, // Knobs
    SLIDER_TRACK_WIDTH, SLIDER_TRACK_HEIGHT, SLIDER_TRACK_DEPTH, SLIDER_HANDLE_WIDTH, SLIDER_HANDLE_HEIGHT, SLIDER_HANDLE_DEPTH, // Sliders
    LIGHT_JOYSTICK_BASE_RADIUS, LIGHT_JOYSTICK_BASE_HEIGHT, LIGHT_JOYSTICK_STICK_RADIUS, LIGHT_JOYSTICK_STICK_HEIGHT, LIGHT_JOYSTICK_STICK_COLOR, LIGHT_JOYSTICK_BASE_COLOR, // Light Joystick
    JOYSTICK_BASE_RADIUS, JOYSTICK_BASE_HEIGHT, JOYSTICK_STICK_RADIUS, JOYSTICK_STICK_HEIGHT, JOYSTICK_STICK_COLOR, JOYSTICK_BASE_COLOR, // Joystick    
    Z_POS_CAMERA_LIGHT_SECTION_SPACING, Z_POS_CAMERA_LIGHT_ROW_SPACING // C/L column
} from './threeDConstants.js';
import { createTextLabel, createButtonMesh, createInteractiveKnobGroup, createInteractiveSliderGroup } from './threeDObjectFactory.js';

// Constants for button heights, aliasing for clarity within this file if needed
const MAIN_BUTTON_HEIGHT = BUTTON_HEIGHT_MAIN;
const THEME_BUTTON_HEIGHT = BUTTON_HEIGHT_THEME_CAMERA_LIGHT; // Theme buttons use this height
const CAMERA_LIGHT_BUTTON_HEIGHT = BUTTON_HEIGHT_THEME_CAMERA_LIGHT; // Camera/Light buttons also use this height

let dynamicTextMeshes = {}; // Store references to text meshes that need dynamic updates, keys match monolithic
let localFontRef = null;
let localControlsGroupRef = null;
let localInteractionGroupRef = null;
// Define theme data structure for creating buttons
const ALL_THEMES_DATA = [
    // internalName should match the key in ThemeController's `themes` object or be '3dRoom'
    { name: "Default", id: "switchToDefaultTheme3D", internalName: 'default', color: DefaultThemeColors3D.background },
    { name: "Dark", id: "switchToDarkTheme3D", internalName: 'dark', color: DefaultThemeColors3D.highlight },
    { name: "Synth", id: "switchToSynthwaveTheme3D", internalName: 'synthwave', color: DefaultThemeColors3D.main },
    { name: "Gundam", id: "switchToGundamTheme3D", internalName: 'gundam', color: DefaultThemeColors3D.alt1 },
    { name: "Kitty", id: "switchToHelloKittyTheme3D", internalName: 'helloKitty', color: DefaultThemeColors3D.alt2 },
    { name: "Beach", id: "switchToBeachTheme3D", internalName: 'beach', color: DefaultThemeColors3D.accent },
    { name: "IceCream", id: "switchToIceCreamTheme3D", internalName: 'iceCream', color: DefaultThemeColors3D.subdivisionBeat }
    // '3dRoom' theme is not a button *within* the 3D scene itself.
];


function getSelectedOptionText(selectElement) {
    if (selectElement && selectElement.options && selectElement.selectedIndex !== -1) {
        return selectElement.options[selectElement.selectedIndex].text;
    }
    return "";
}

function addHitbox(visibleObject, interactionGroup) { // This function will now be used
    if (!interactionGroup || !visibleObject) return;

    let geometryForHitbox = null;

    if (visibleObject.isMesh) {
        geometryForHitbox = visibleObject.geometry;
    } else if (visibleObject.isGroup) {
        // Attempt to find a primary mesh within the group, e.g., the knob body
        const mainChild = visibleObject.children.find(child => child.isMesh && child.name && child.name.endsWith("_body"));
        if (mainChild) {
            geometryForHitbox = mainChild.geometry;
        } else if (visibleObject.children.length > 0 && visibleObject.children[0].isMesh) {
            // Fallback to the first mesh child if no specific "_body" found
            geometryForHitbox = visibleObject.children[0].geometry;
        }
    }

    if (!geometryForHitbox) {
        console.warn(`addHitbox: Could not determine geometry for hitbox for object: ${visibleObject.name || 'Unnamed object'}. Skipping hitbox creation.`);
        return;
    }

    let hitboxRadius, hitboxHeight;
    const HITBOX_SCALE_FACTOR = 1.2; // Increased from 1.2 for larger hitboxes

    if (geometryForHitbox instanceof THREE.CylinderGeometry) {
        hitboxRadius = geometryForHitbox.parameters.radiusTop * HITBOX_SCALE_FACTOR;
        hitboxHeight = geometryForHitbox.parameters.height * HITBOX_SCALE_FACTOR;
    } else if (geometryForHitbox instanceof THREE.BoxGeometry) {
        geometryForHitbox.computeBoundingBox();
        const size = new THREE.Vector3();
        geometryForHitbox.boundingBox.getSize(size);
        hitboxRadius = Math.max(size.x, size.z) / 2 * HITBOX_SCALE_FACTOR;
        hitboxHeight = size.y * HITBOX_SCALE_FACTOR;
    } else {
        // Fallback for other geometry types (e.g., TextGeometry): compute bounding box and make a cylindrical approximation
        geometryForHitbox.computeBoundingBox();
        if (!geometryForHitbox.boundingBox) {
            console.warn(`addHitbox: Bounding box not computed for geometry of object: ${visibleObject.name || 'Unnamed object'}. Skipping hitbox creation.`);
            return;
        }
        const size = new THREE.Vector3();
        geometryForHitbox.boundingBox.getSize(size);
        hitboxRadius = Math.max(size.x, size.z) / 2 * HITBOX_SCALE_FACTOR;
        hitboxHeight = size.y * HITBOX_SCALE_FACTOR;

        // Ensure dimensions are not zero to prevent CylinderGeometry errors
        if (hitboxRadius <= 0) hitboxRadius = 0.1 * HITBOX_SCALE_FACTOR; // Scale fallback minimum
        if (hitboxHeight <= 0) hitboxHeight = 0.1 * HITBOX_SCALE_FACTOR; // Scale fallback minimum
    }

    const hitboxGeometry = new THREE.CylinderGeometry(hitboxRadius, hitboxRadius, hitboxHeight, 16);
    const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false, depthWrite: false });
    const hitboxMesh = new THREE.Mesh(hitboxGeometry, hitboxMaterial);

    hitboxMesh.position.copy(visibleObject.position); // Position hitbox at the visible object's location
    hitboxMesh.userData.visibleButton = visibleObject; // Link hitbox to the original interactive object (Mesh or Group)
    hitboxMesh.name = (visibleObject.name || 'unnamed_object') + "_hitbox";
    interactionGroup.add(hitboxMesh);
}

// This function is internal to ControlsManager, using the factory's createTextLabel
function _updateOrAddTextLabel(meshKey, newText, size, textColor, textPosition, textRotation = { x: -Math.PI / 2, y: 0, z: 0 }) {
    if (!localFontRef || !localControlsGroupRef) return;

    // Dispose and remove old mesh if it exists
    if (dynamicTextMeshes[meshKey]) {
        localControlsGroupRef.remove(dynamicTextMeshes[meshKey]);
        if (dynamicTextMeshes[meshKey].geometry) dynamicTextMeshes[meshKey].geometry.dispose();
        if (dynamicTextMeshes[meshKey].material) dynamicTextMeshes[meshKey].material.dispose();
        dynamicTextMeshes[meshKey] = null;
    }

    // Create new text mesh using the factory
    const textMesh = createTextLabel(newText, localFontRef, size, textColor, textPosition, textRotation);
    if (textMesh) {
        dynamicTextMeshes[meshKey] = textMesh;
        localControlsGroupRef.add(textMesh);
        console.log(`Text Label "${meshKey}":`, {
            text: newText,
            size: size,
            color: textColor,
            position: textMesh.position.clone(),
            rotation: textMesh.rotation.clone(),
        });
    }
    return textMesh;
}

export function createControls(font, controlsGroup, interactionGroup) { 
    localFontRef = font;
    localControlsGroupRef = controlsGroup;
    localInteractionGroupRef = interactionGroup; 

    if (!controlsGroup) {
        console.warn("Cannot create 3D controls: controlsGroup not ready.");
        return;
    }

    // Clear previous controls
    while (localControlsGroupRef.children.length > 0) {
        const child = localControlsGroupRef.children[0];
        localControlsGroupRef.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) { // Check if material is an array
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
            } else {
                child.material.dispose();
            }
        }
    }
    // Reset dynamic text meshes
    for (const key in dynamicTextMeshes) {
        dynamicTextMeshes[key] = null;
    }

    // Label Sizes from monolithic
    const mainStartStopLabelSize = 0.08; // Reduced
    const tapResetLabelSize = 0.1; // Reduced
    const plusMinusLabelSize = 0.15; // Reduced
    const valueLabelSize = 0.12; // Reduced
    const controlGroupLabelSize = 0.1; // Reduced
    const presetSlotSubdivLabelSize = 0.08; // Reduced
    const presetNameLabelSize = 0.08; // Reduced
    const saveLoadLabelSize = 0.08; // Reduced
    const measuresPagingLabelSize = 0.07; // Reduced
    const themeSwitcherButtonLabelSize = 0.07; // Reduced
    const themeSectionHeaderLabelSize = 0.08; // Reduced
    // Camera/Light label sizes are now directly from threeDConstants.js

    let btnPos, btn;

    // --- Main Controls (Center Area) ---
    // Row 1 (Z_ROW_MAIN_1): Start/Stop, Tap Tempo, Reset
    btnPos = { x: 0, z: Z_ROW_MAIN_1 };
    btn = createButtonMesh("startStopButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_XLARGE, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    if (font) _updateOrAddTextLabel("startStopLabel", "Start/Stop", mainStartStopLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: btnPos.z });

    btnPos = { x: -1.8, z: Z_ROW_MAIN_1 }; // Adjusted X for wider layout
    btn = createButtonMesh("tapTempoButton3D", DefaultThemeColors3D.alt1, btnPos, BUTTON_DIM_MEDIUM, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    if (font) _updateOrAddTextLabel("tapTempoLabel", "Tap", tapResetLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: btnPos.z });

    btnPos = { x: 1.8, z: Z_ROW_MAIN_1 }; // Adjusted X for wider layout
    btn = createButtonMesh("resetButton3D", DefaultThemeColors3D.accent, btnPos, BUTTON_DIM_MEDIUM, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    if (font) _updateOrAddTextLabel("resetLabel", "Reset", tapResetLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: btnPos.z });

    // Row 2 (Z_ROW_MAIN_2): Tempo, Volume
    // Tempo Controls: +/- buttons and Knob
    const tempoControlsXCenter = -2.8; // Adjusted center for the tempo group
    const tempoButtonOffsetX = 1.0;   // Offset for +/- buttons from the knob

    if (font) _updateOrAddTextLabel("tempoHeaderLabel", "Tempo", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: tempoControlsXCenter, y: Y_POS_CONTROL_VALUE_SUB_LABEL -0.1, z: Z_ROW_MAIN_2 +0.6 });
    btnPos = { x: tempoControlsXCenter - tempoButtonOffsetX, z: Z_ROW_MAIN_2  };
    btn = createButtonMesh("decreaseTempoButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("decreaseTempoLabel", "-", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_2 });

    // Tempo Knob
    const tempoKnobPosition = { x: tempoControlsXCenter, z: Z_ROW_MAIN_2 };
    const tempoKnob = createInteractiveKnobGroup("tempoKnob3D", DefaultThemeColors3D.alt1, tempoKnobPosition, KNOB_RADIUS, KNOB_HEIGHT);
    controlsGroup.add(tempoKnob);
    if (localInteractionGroupRef) addHitbox(tempoKnob, localInteractionGroupRef);
    // Label for "Tempo" is now above the group

    btnPos = { x: tempoControlsXCenter + tempoButtonOffsetX, z: Z_ROW_MAIN_2 };
    btn = createButtonMesh("increaseTempoButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    if (font) _updateOrAddTextLabel("increaseTempoLabel", "+", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_2 });

    // Volume Controls: +/- buttons and Slider
    const volumeControlsXCenter = 2.8; // Adjusted center for the volume group
    const volumeButtonOffsetX = 1.0;   // Offset for +/- buttons from the slider center

    if (font) _updateOrAddTextLabel("volumeHeaderLabel", "Volume", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: volumeControlsXCenter, y: Y_POS_CONTROL_VALUE_SUB_LABEL, z: Z_ROW_MAIN_2+0.6});
    btnPos = { x: volumeControlsXCenter - volumeButtonOffsetX - SLIDER_TRACK_WIDTH / 2 - BUTTON_DIM_SMALL, z: Z_ROW_MAIN_2 }; // Position left of slider
    btn = createButtonMesh("decreaseVolumeButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("decreaseVolumeLabel", "-", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_2 });

    const volumeSliderPosition = { x: volumeControlsXCenter -0.5, z: Z_ROW_MAIN_2 };
    const volumeSlider = createInteractiveSliderGroup(
        "volumeSlider3D",
        DefaultThemeColors3D.alt2, // track color
        DefaultThemeColors3D.highlight, // handle color
        volumeSliderPosition,
        SLIDER_TRACK_WIDTH, SLIDER_TRACK_HEIGHT, SLIDER_TRACK_DEPTH,
        SLIDER_HANDLE_WIDTH, SLIDER_HANDLE_HEIGHT, SLIDER_HANDLE_DEPTH
    );
    controlsGroup.add(volumeSlider);
    if (localInteractionGroupRef) addHitbox(volumeSlider, localInteractionGroupRef);
    // Label for "Volume" is now above the group

    btnPos = { x: volumeControlsXCenter + volumeButtonOffsetX + SLIDER_TRACK_WIDTH / 2 + BUTTON_DIM_SMALL -1.1, z: Z_ROW_MAIN_2 }; // Position right of slider
    btn = createButtonMesh("increaseVolumeButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    if (font) _updateOrAddTextLabel("increaseVolumeLabel", "+", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_2 });
    

    // Row 3 (Z_ROW_MAIN_3): Beats, Bars, Subdivision
    if (font) _updateOrAddTextLabel("beatsHeaderLabel", "Beats", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: -2.5, y: Y_POS_CONTROL_VALUE_SUB_LABEL, z: Z_ROW_MAIN_3 + 0.4 });
    btnPos = { x: -3.1, z: Z_ROW_MAIN_3 };
    btn = createButtonMesh("decreaseBeatsButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("decreaseBeatsLabel", "-", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_3 });
    btnPos = { x: -1.9, z: Z_ROW_MAIN_3 };
    btn = createButtonMesh("increaseBeatsButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("increaseBeatsLabel", "+", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_3 });

    if (font) _updateOrAddTextLabel("barsHeaderLabel", "Bars", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 0, y: Y_POS_CONTROL_VALUE_SUB_LABEL, z: Z_ROW_MAIN_3 + 0.4 });
    btnPos = { x: -0.6, z: Z_ROW_MAIN_3 };
    btn = createButtonMesh("decreaseBarsButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("decreaseBarsLabel", "-", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_3 });
    btnPos = { x: 0.6, z: Z_ROW_MAIN_3 };
    btn = createButtonMesh("increaseBarsButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("increaseBarsLabel", "+", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_3 });

    if (font) _updateOrAddTextLabel("subdivisionHeaderLabel", "Subdivision", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 2.5, y: Y_POS_CONTROL_VALUE_SUB_LABEL, z: Z_ROW_MAIN_3 +0.4});
    btnPos = { x: 1.9, z: Z_ROW_MAIN_3 };
    btn = createButtonMesh("prevSubdivisionButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("prevSubdivisionLabel", "<", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_3 });
    btnPos = { x: 3.1, z: Z_ROW_MAIN_3 };
    btn = createButtonMesh("nextSubdivisionButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("nextSubdivisionLabel", ">", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_3 });

    // Row 4 (Z_ROW_MAIN_4): Presets
    if (font) _updateOrAddTextLabel("presetSlotHeaderLabel", "Preset Slot", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: -2.5, y: Y_POS_CONTROL_VALUE_SUB_LABEL, z: Z_ROW_MAIN_4 + 0.4 });
    btnPos = { x: -3.1, z: Z_ROW_MAIN_4 };
    btn = createButtonMesh("prevPresetSlotButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("prevPresetSlotLabel", "<", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_4 });
    btnPos = { x: -1.9, z: Z_ROW_MAIN_4 };
    btn = createButtonMesh("nextPresetSlotButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("nextPresetSlotLabel", ">", plusMinusLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: Z_ROW_MAIN_4 });

    if (font) _updateOrAddTextLabel("songNameHeaderLabel", "Song Name", controlGroupLabelSize, LABEL_TEXT_COLOR, { x: 0, y: Y_POS_CONTROL_VALUE_SUB_LABEL, z: Z_ROW_MAIN_4 });
    const presetNameDisplayWidth = 1.5; // From monolithic
    const presetNameDisplayGeometry = new THREE.BoxGeometry(presetNameDisplayWidth, BUTTON_HEIGHT_MAIN, 0.5); // Depth 0.5 from monolithic
    const presetNameDisplayMaterial = new THREE.MeshStandardMaterial({ color: DefaultThemeColors3D.alt1 });
    const presetNameDisplayBox = new THREE.Mesh(presetNameDisplayGeometry, presetNameDisplayMaterial);
    presetNameDisplayBox.position.set(0, BUTTON_Y_POSITION + BUTTON_HEIGHT_MAIN / 2, Z_ROW_MAIN_4);
    controlsGroup.add(presetNameDisplayBox);

    btnPos = { x: 1.9, z: Z_ROW_MAIN_4 };
    btn = createButtonMesh("savePresetButton3D", DefaultThemeColors3D.main, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("savePresetLabel", "Save", saveLoadLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: btnPos.z });
    btnPos = { x: 3.1, z: Z_ROW_MAIN_4 };
    btn = createButtonMesh("loadPresetButton3D", DefaultThemeColors3D.subdivisionBeat, btnPos, BUTTON_DIM_SMALL, MAIN_BUTTON_HEIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("loadPresetLabel", "Load", saveLoadLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_LABELS_ABOVE_BUTTONS, z: btnPos.z });

    // Measures Paging Buttons (Z_ROW_MEASURES_PAGING)
    const measuresPagingYForLabel = BUTTON_Y_POSITION + BUTTON_HEIGHT_THEME_CAMERA_LIGHT + 0.12; // Using themeButtonHeight as it's similar

    btnPos = { x: -2.8, z: Z_ROW_MEASURES_PAGING };
    btn = createButtonMesh("prevMeasuresPageButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_SMALL, BUTTON_HEIGHT_THEME_CAMERA_LIGHT, BUTTON_SHAPE_SQUARE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("prevMeasuresPageLabel", "< Measures", measuresPagingLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: measuresPagingYForLabel, z: btnPos.z });

    btnPos = { x: 2.8, z: Z_ROW_MEASURES_PAGING };
    btn = createButtonMesh("nextMeasuresPageButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_SMALL, BUTTON_HEIGHT_THEME_CAMERA_LIGHT, BUTTON_SHAPE_SQUARE);
    controlsGroup.add(btn);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    if (font) _updateOrAddTextLabel("nextMeasuresPageLabel", "Measures >", measuresPagingLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: measuresPagingYForLabel, z: btnPos.z });

    // --- Theme Switcher Buttons (Left Column) ---
    if (font) _updateOrAddTextLabel("themeSectionHeader", "2D Themes", themeSectionHeaderLabelSize, LABEL_TEXT_COLOR,
        { x: X_POS_THEME_COLUMN, y: Y_POS_THEME_SECTION_HEADER, z: Z_POS_THEME_HEADER },
        { x: -Math.PI / 2, y: 0, z: 0 }
    );

    ALL_THEMES_DATA.forEach((theme, index) => {
        // Filter out '3dRoom' as it's not a button to switch to when already in 3D.
        if (theme.internalName === '3dRoom') return;

        const currentZ = Z_POS_THEME_START - (index * THEME_BUTTON_VERTICAL_SPACING);
        btnPos = { x: X_POS_THEME_COLUMN, z: currentZ };
        btn = createButtonMesh(theme.id, theme.color, btnPos,
            BUTTON_DIM_MEDIUM, BUTTON_HEIGHT_THEME_CAMERA_LIGHT, BUTTON_SHAPE_ROUNDED_SQUARE, BUTTON_CORNER_RADIUS_MEDIUM);
        controlsGroup.add(btn);
        if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
        if (font) _updateOrAddTextLabel(`${theme.id}Label`, theme.name, themeSwitcherButtonLabelSize, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_THEME_LABELS, z: btnPos.z });
    });

    // --- Camera and Light Controls (Right Column) ---
    let currentSectionZ = Z_POS_CAMERA_LIGHT_HEADER_START;

    // Camera Controls Section
    if (font) _updateOrAddTextLabel("cameraControlsHeader", "Camera Controls", CAMERA_LIGHT_SECTION_HEADER_LABEL_SIZE, LABEL_TEXT_COLOR,
        { x: X_POS_CAMERA_LIGHT_COLUMN, y: Y_POS_CAMERA_LIGHT_SECTION_HEADER, z: currentSectionZ });

    currentSectionZ -= Z_POS_CAMERA_LIGHT_ROW_SPACING; // Move down for first row of controls
    // Camera Row 1: Zoom, Reset
    if (font) _updateOrAddTextLabel("cameraZoomLabel", "Zoom", CAMERA_LIGHT_LABEL_SIZE, LABEL_TEXT_COLOR, { x: X_POS_CAMERA_LIGHT_COLUMN, y: Y_POS_CAMERA_LIGHT_LABELS, z: currentSectionZ + 0.6 });
    btnPos = { x: X_POS_CAMERA_LIGHT_COLUMN - CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET, z: currentSectionZ };
    btn = createButtonMesh("cameraZoomOutButton3D", DefaultThemeColors3D.alt2, btnPos,
        BUTTON_DIM_LARGE, CAMERA_LIGHT_BUTTON_HEIGHT, BUTTON_SHAPE_CIRCLE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("cameraZoomOutLabel", "-", CAMERA_LIGHT_PLUS_MINUS_LABEL_SIZE, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_CAMERA_LIGHT_LABELS, z: btnPos.z });

    btnPos = { x: X_POS_CAMERA_LIGHT_COLUMN + CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET, z: currentSectionZ };
    btn = createButtonMesh("cameraZoomInButton3D", DefaultThemeColors3D.highlight, btnPos,
        BUTTON_DIM_LARGE, CAMERA_LIGHT_BUTTON_HEIGHT, BUTTON_SHAPE_CIRCLE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("cameraZoomInLabel", "+", CAMERA_LIGHT_PLUS_MINUS_LABEL_SIZE, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_CAMERA_LIGHT_LABELS, z: btnPos.z });

    // Camera Row 2: Joystick for Orbit
    currentSectionZ -= (Z_POS_CAMERA_LIGHT_ROW_SPACING * 1.5); // Give joystick more space
    if (font) _updateOrAddTextLabel("cameraJoystickLabel", "Orbit", CAMERA_LIGHT_LABEL_SIZE +0.1, LABEL_TEXT_COLOR, { x: X_POS_CAMERA_LIGHT_COLUMN + 0.8, y:  -1.8, z: currentSectionZ + 0.6});

    const joystickGroup = new THREE.Group();
    joystickGroup.name = "cameraJoystick3D";
    joystickGroup.position.set(X_POS_CAMERA_LIGHT_COLUMN, BUTTON_Y_POSITION + JOYSTICK_BASE_HEIGHT / 2, currentSectionZ);

    const baseGeo = new THREE.CylinderGeometry(JOYSTICK_BASE_RADIUS, JOYSTICK_BASE_RADIUS, JOYSTICK_BASE_HEIGHT, 32);
    const baseMat = new THREE.MeshStandardMaterial({ color: JOYSTICK_BASE_COLOR, metalness: 0.3, roughness: 0.7 });
    const joystickBase = new THREE.Mesh(baseGeo, baseMat);
    joystickBase.name = "cameraJoystickBase3D";
    joystickBase.castShadow = true;
    joystickBase.receiveShadow = true;
    joystickGroup.add(joystickBase);

    const stickGeo = new THREE.CylinderGeometry(JOYSTICK_STICK_RADIUS, JOYSTICK_STICK_RADIUS, JOYSTICK_STICK_HEIGHT, 32);
    const stickMat = new THREE.MeshStandardMaterial({ color: JOYSTICK_STICK_COLOR, metalness: 0.5, roughness: 0.5 });
    const joystickStick = new THREE.Mesh(stickGeo, stickMat);
    joystickStick.name = "cameraJoystickStick3D";
    joystickStick.position.y = JOYSTICK_BASE_HEIGHT / 2 + JOYSTICK_STICK_HEIGHT / 2; // Position stick on top of the base
    joystickStick.castShadow = true;
    joystickStick.receiveShadow = true;
    joystickGroup.add(joystickStick); // Add stick to the group

    controlsGroup.add(joystickGroup);
    if (localInteractionGroupRef) addHitbox(joystickGroup, localInteractionGroupRef);

    // --- Reset Buttons Row (between Joysticks) ---
    currentSectionZ -= Z_POS_CAMERA_LIGHT_ROW_SPACING * 1.2; // Space before reset buttons
    const resetButtonsYForLabel = BUTTON_Y_POSITION + THEME_BUTTON_HEIGHT + 0.12;

    // Camera Reset Button
    btnPos = { x: X_POS_CAMERA_LIGHT_COLUMN - CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET * 0.8, z: currentSectionZ };
    btn = createButtonMesh("cameraResetButton3D", DefaultThemeColors3D.accent, btnPos,
        BUTTON_DIM_MEDIUM, THEME_BUTTON_HEIGHT, BUTTON_SHAPE_ROUNDED_SQUARE, BUTTON_CORNER_RADIUS_MEDIUM);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("cameraResetLabel", "Reset C", CAMERA_LIGHT_LABEL_SIZE, LABEL_TEXT_COLOR, { x: btnPos.x, y: resetButtonsYForLabel, z: btnPos.z });

    // Light Reset Button
    btnPos = { x: X_POS_CAMERA_LIGHT_COLUMN + CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET * 0.8, z: currentSectionZ };
    btn = createButtonMesh("lightResetButton3D", DefaultThemeColors3D.accent, btnPos,
        BUTTON_DIM_MEDIUM, THEME_BUTTON_HEIGHT, BUTTON_SHAPE_ROUNDED_SQUARE, BUTTON_CORNER_RADIUS_MEDIUM);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("lightResetLabel", "Reset L", CAMERA_LIGHT_LABEL_SIZE, LABEL_TEXT_COLOR, { x: btnPos.x, y: resetButtonsYForLabel, z: btnPos.z });

    // --- Light Controls Section ---
    currentSectionZ -= Z_POS_CAMERA_LIGHT_ROW_SPACING * 1.2; // Space before light controls header
    if (font) _updateOrAddTextLabel("lightControlsHeader", "Light Controls", CAMERA_LIGHT_SECTION_HEADER_LABEL_SIZE, LABEL_TEXT_COLOR,
        { x: X_POS_CAMERA_LIGHT_COLUMN, y: Y_POS_CAMERA_LIGHT_SECTION_HEADER, z: currentSectionZ });

    // Light Row 1: Intensity
    currentSectionZ -= Z_POS_CAMERA_LIGHT_ROW_SPACING;
    if (font) _updateOrAddTextLabel("lightIntensityLabel", "Intensity", CAMERA_LIGHT_LABEL_SIZE, LABEL_TEXT_COLOR, { x: X_POS_CAMERA_LIGHT_COLUMN, y: Y_POS_CAMERA_LIGHT_LABELS + 0.08, z: currentSectionZ + 0.6 }); // Label slightly higher for value display
    btnPos = { x: X_POS_CAMERA_LIGHT_COLUMN - CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET, z: currentSectionZ };
    btn = createButtonMesh("lightIntensityDownButton3D", DefaultThemeColors3D.alt2, btnPos, BUTTON_DIM_LARGE, CAMERA_LIGHT_BUTTON_HEIGHT, BUTTON_SHAPE_CIRCLE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("lightIntensityDownLabel", "-", CAMERA_LIGHT_PLUS_MINUS_LABEL_SIZE, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_CAMERA_LIGHT_LABELS, z: btnPos.z });
    btnPos = { x: X_POS_CAMERA_LIGHT_COLUMN + CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET, z: currentSectionZ };
    btn = createButtonMesh("lightIntensityUpButton3D", DefaultThemeColors3D.highlight, btnPos, BUTTON_DIM_LARGE, CAMERA_LIGHT_BUTTON_HEIGHT, BUTTON_SHAPE_CIRCLE);
    if (localInteractionGroupRef) addHitbox(btn, localInteractionGroupRef);
    controlsGroup.add(btn);
    if (font) _updateOrAddTextLabel("lightIntensityUpLabel", "+", CAMERA_LIGHT_PLUS_MINUS_LABEL_SIZE, LABEL_TEXT_COLOR, { x: btnPos.x, y: Y_POS_CAMERA_LIGHT_LABELS, z: btnPos.z });

    // Light Control Joystick
    currentSectionZ -= (Z_POS_CAMERA_LIGHT_ROW_SPACING * 1.5); // Give joystick space
    if (font) _updateOrAddTextLabel("lightJoystickLabel", "Light Adjust", CAMERA_LIGHT_LABEL_SIZE + 0.01, LABEL_TEXT_COLOR, 
        { x: X_POS_CAMERA_LIGHT_COLUMN + 0.8, y: -1.8, z: currentSectionZ + 0.6 });

    const lightJoystickGroup = new THREE.Group();
    lightJoystickGroup.name = "lightControlJoystick3D";
    lightJoystickGroup.position.set(X_POS_CAMERA_LIGHT_COLUMN, BUTTON_Y_POSITION + LIGHT_JOYSTICK_BASE_HEIGHT / 2, currentSectionZ);

    const lightBaseGeo = new THREE.CylinderGeometry(LIGHT_JOYSTICK_BASE_RADIUS, LIGHT_JOYSTICK_BASE_RADIUS, LIGHT_JOYSTICK_BASE_HEIGHT, 32);
    const lightBaseMat = new THREE.MeshStandardMaterial({ color: LIGHT_JOYSTICK_BASE_COLOR, metalness: 0.3, roughness: 0.7 });
    const lightJoystickBase = new THREE.Mesh(lightBaseGeo, lightBaseMat);
    lightJoystickBase.name = "lightControlJoystickBase3D";
    lightJoystickBase.castShadow = true;
    lightJoystickBase.receiveShadow = true;
    lightJoystickGroup.add(lightJoystickBase);

    const lightStickGeo = new THREE.CylinderGeometry(LIGHT_JOYSTICK_STICK_RADIUS, LIGHT_JOYSTICK_STICK_RADIUS, LIGHT_JOYSTICK_STICK_HEIGHT, 32);
    const lightStickMat = new THREE.MeshStandardMaterial({ color: LIGHT_JOYSTICK_STICK_COLOR, metalness: 0.5, roughness: 0.5 });
    const lightJoystickStick = new THREE.Mesh(lightStickGeo, lightStickMat);
    lightJoystickStick.name = "lightControlJoystickStick3D";
    lightJoystickStick.position.y = LIGHT_JOYSTICK_BASE_HEIGHT / 2 + LIGHT_JOYSTICK_STICK_HEIGHT / 2; // Position stick on top of the base
    lightJoystickStick.castShadow = true;
    lightJoystickStick.receiveShadow = true;
    lightJoystickGroup.add(lightJoystickStick);

    controlsGroup.add(lightJoystickGroup);
    if (localInteractionGroupRef) addHitbox(lightJoystickGroup, localInteractionGroupRef);

    // Initial label updates
    updateDynamicControlLabels();
    console.log("3dTheme: Controls created by ControlsManager.");
}

export function updateDynamicControlLabels() {
    if (!localFontRef) return;

    const valueLabelSize = 0.12; // Match size used in createControls
    const presetSlotSubdivLabelSize = 0.08; // Match size used in createControls
    const presetNameLabelSize = TEXT_SIZE_SMALL; // Match size used in createControls
    // Z-positions for main control value labels
    const zValTempoVol = Z_ROW_MAIN_2;
    const zValBeatsBarsSub = Z_ROW_MAIN_3;
    const zValPresets = Z_ROW_MAIN_4;

    // Tempo Value (centered on its control group)
    const tempoControlsXCenter = -2.8; // Must match createControls
    _updateOrAddTextLabel("tempoValue", AppState.getTempo().toString(), valueLabelSize, LABEL_TEXT_COLOR, { x: tempoControlsXCenter, y: Y_POS_LABELS_ABOVE_BUTTONS + KNOB_HEIGHT -0.2, z: zValTempoVol });
    
    // Volume Value (centered on its control group)
    const volumeControlsXCenter = 2.8; // Must match createControls
    _updateOrAddTextLabel("volumeValue", `${Math.round(AppState.getVolume() * 100)}%`, valueLabelSize, LABEL_TEXT_COLOR, { x: volumeControlsXCenter, y: Y_POS_LABELS_ABOVE_BUTTONS + SLIDER_HANDLE_HEIGHT - 0.2, z: zValTempoVol +0.2 });

    // Update Volume Slider Handle Position
    const volumeSliderGroup = localControlsGroupRef.getObjectByName("volumeSlider3D");
    if (volumeSliderGroup) {
        const handle = volumeSliderGroup.getObjectByName("volumeSlider3D_handle");
        const trackWidth = volumeSliderGroup.userData.trackWidth;
        if (handle && typeof trackWidth === 'number') {
            handle.position.x = (AppState.getVolume() - 0.5) * trackWidth;
        }
    }

    // Beats & Bars Values
    const barSettings = AppState.getBarSettings();
    const selectedIdx = AppState.getSelectedBarIndex();
    let beatsVal = 4; // Default
    if (barSettings && barSettings.length > 0) {
        const barToRead = selectedIdx !== -1 ? barSettings[selectedIdx] : barSettings[0];
        if (barToRead && typeof barToRead.beats === 'number') {
            beatsVal = barToRead.beats;
        }
    }
    _updateOrAddTextLabel("beatsValue", beatsVal.toString(), valueLabelSize, LABEL_TEXT_COLOR, { x: -2.5, y: Y_POS_LABELS_ABOVE_BUTTONS, z: zValBeatsBarsSub });
    _updateOrAddTextLabel("barsValue", (barSettings ? barSettings.length : 0).toString(), valueLabelSize, LABEL_TEXT_COLOR, { x: 0, y: Y_POS_LABELS_ABOVE_BUTTONS, z: zValBeatsBarsSub });

    // Subdivision Value (centered between its < > buttons)
    _updateOrAddTextLabel("subdivisionValue", AppState.getSubdivisionForSelectedBar().toString(), presetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: 2.5, y: Y_POS_LABELS_ABOVE_BUTTONS, z: zValBeatsBarsSub });

    // Preset Slot Value (centered between its < > buttons)
    if (DOM.presetSlotSelect) _updateOrAddTextLabel("presetSlotValue", getSelectedOptionText(DOM.presetSlotSelect), presetSlotSubdivLabelSize, LABEL_TEXT_COLOR, { x: -2.5, y: Y_POS_LABELS_ABOVE_BUTTONS, z: zValPresets });

    // Preset Name (on the display box)
    if (DOM.presetNameInput) _updateOrAddTextLabel("presetNameValue", DOM.presetNameInput.value.substring(0, 10), presetNameLabelSize, LABEL_TEXT_COLOR, { x: 0, y: Y_POS_LABELS_ABOVE_BUTTONS, z: zValPresets + 0.01 });

    // Update light intensity label
    const light = SceneManager.getDirectionalLight();
    if (light && localFontRef) {
        // Find the Z position of the light intensity controls
        // This is: Z_POS_CAMERA_LIGHT_HEADER_START - Z_POS_CAMERA_LIGHT_SECTION_SPACING (approx for header) - Z_POS_CAMERA_LIGHT_ROW_SPACING (for intensity row)
        // A more robust way is to find the "lightIntensityLabel" mesh and use its z, or recalculate based on currentSectionZ logic.
        // For now, let's find the "lightIntensityLabel" text mesh if it exists.
        const intensityLabelMesh = dynamicTextMeshes["lightIntensityLabel"];
        if (intensityLabelMesh) {
            _updateOrAddTextLabel("lightIntensityValue", `${Math.round(light.intensity * 100)}`, TEXT_SIZE_SMALL, LABEL_TEXT_COLOR,
                                { x: X_POS_CAMERA_LIGHT_COLUMN, y: Y_POS_CAMERA_LIGHT_LABELS - 0.08, z: intensityLabelMesh.position.z + 0.1

                                 });
        }
    }
}

export function disposeControls() {
    if (localControlsGroupRef) {
        while (localControlsGroupRef.children.length > 0) {
            const child = localControlsGroupRef.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat.map) mat.map.dispose();
                        mat.dispose();
                    });
                } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
            localControlsGroupRef.remove(child);
        }
    }
    // Dispose hitboxes from the interaction group
    if (localInteractionGroupRef) {
        while (localInteractionGroupRef.children.length > 0) {
            const hitbox = localInteractionGroupRef.children[0];
            localInteractionGroupRef.remove(hitbox); // Remove from group
            // Hitbox geometry and material are simple and will be disposed if they were added to the main scene
            // by the main 3dTheme.dispose() scene traversal.
            // If they are *only* in interactionGroup and interactionGroup is not part of main scene's
            // disposal traversal, then they need explicit disposal here.
            // Assuming interactionGroup IS added to the main scene, so 3dTheme.dispose() handles them.
        }
    }

    for (const key in dynamicTextMeshes) { // Clear text mesh references
        dynamicTextMeshes[key] = null;
    }
    localFontRef = null;
    localControlsGroupRef = null;
    localInteractionGroupRef = null; 
}