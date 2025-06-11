/**
 * threeDConstants.js
 * Defines constants used throughout the 3D theme.
 */

import * as THREE from 'three';

export const DefaultThemeColors3D = {
    main: new THREE.Color('#c000a0'),
    background: new THREE.Color('#f0f0f0'),
    accent: new THREE.Color('#ffe0b2'),
    highlight: new THREE.Color('#a0faa0'),
    alt1: new THREE.Color('#4682b4'),
    alt2: new THREE.Color('#dc143c'),
    textOnMain: new THREE.Color('#ffffff'),
    textPrimary: new THREE.Color('#333333'),
    textSecondary: new THREE.Color('#555555'),
    subdivisionBeat: new THREE.Color('#ffa07a'),
};

export const DEFAULT_MEASURE_COLOR = DefaultThemeColors3D.alt1.clone(); // Changed from textPrimary for less grey
export const SELECTED_MEASURE_COLOR = DefaultThemeColors3D.main.clone(); // User clicked selection
export const PLAYHEAD_SELECTED_MEASURE_COLOR = DefaultThemeColors3D.alt1.clone(); // Playhead active measure

// --- Layout Constants ---
// --- Button Shapes ---
export const BUTTON_SHAPE_CIRCLE = 'circle';
export const BUTTON_SHAPE_SQUARE = 'square';
export const BUTTON_SHAPE_ROUNDED_SQUARE = 'rounded_square';

// --- Scale Factor for Button Visual Size ---
const BUTTON_VISUAL_SCALE_FACTOR = 1.2; // Increase button dimensions by 20%

// --- Button Dimensions (radius for circles, half-side for squares) ---
export const BUTTON_DIM_XLARGE = 0.85 * BUTTON_VISUAL_SCALE_FACTOR;  // For Start button
export const BUTTON_DIM_LARGE = 0.45 * BUTTON_VISUAL_SCALE_FACTOR;   // For Camera/Light control buttons
export const BUTTON_DIM_MEDIUM = 0.35 * BUTTON_VISUAL_SCALE_FACTOR; // For Theme, Tap Tempo, Reset buttons
export const BUTTON_DIM_SMALL = 0.25 * BUTTON_VISUAL_SCALE_FACTOR;  // For symbol-only buttons (+, -, <, >)

export const BUTTON_CORNER_RADIUS_MEDIUM = 0.05; // Corner radius for rounded square theme buttons

// --- Button Heights ---
export const BUTTON_Y_POSITION = -2.0; // Y position for buttons on the floor, slightly lower
export const BUTTON_HEIGHT_MAIN = 0.2 * BUTTON_VISUAL_SCALE_FACTOR;         // For Start, Tap, Reset, +/- controls etc.
export const BUTTON_HEIGHT_THEME_CAMERA_LIGHT = 0.15 * BUTTON_VISUAL_SCALE_FACTOR; // For Theme, Camera, Light buttons

export const Y_POS_LABELS_ABOVE_BUTTONS = BUTTON_Y_POSITION + BUTTON_HEIGHT_MAIN + 0.15; // Adjusted for potentially varied button heights
export const Y_POS_SECTION_HEADER_LABELS = BUTTON_Y_POSITION + BUTTON_HEIGHT_MAIN + 0.35;
export const Y_POS_THEME_LABELS = BUTTON_Y_POSITION + BUTTON_HEIGHT_THEME_CAMERA_LIGHT + 0.12;
export const Y_POS_CONTROL_VALUE_SUB_LABEL = Y_POS_LABELS_ABOVE_BUTTONS - 0.20; // Position for labels like "Tempo" under its value "120"
export const Y_POS_THEME_SECTION_HEADER = BUTTON_Y_POSITION + BUTTON_HEIGHT_THEME_CAMERA_LIGHT + 0.32;

// Knob constants remain from original context, though not used by monolithic logic
export const KNOB_RADIUS = 0.35; // Original context value
export const KNOB_HEIGHT = 0.4;  // Original context value
export const KNOB_SEGMENTS = 32; // Original context value

export const LABEL_TEXT_COLOR = DefaultThemeColors3D.textPrimary;
export const DEFAULT_MEASURE_OPACITY = 0.3;
export const SELECTED_MEASURE_OPACITY = 0.6;
export const PLAYHEAD_SELECTED_MEASURE_OPACITY = 0.45; // Opacity for the measure box when playhead is on it

// --- Beat Highlighting ---
export const MAIN_BEAT_COLOR_3D_DEFAULT = DefaultThemeColors3D.highlight.clone();
export const SUB_BEAT_COLOR_3D_DEFAULT = DefaultThemeColors3D.subdivisionBeat.clone();
export const HIGHLIGHT_COLOR_3D = DefaultThemeColors3D.accent.clone();
export const BEAT_HIGHLIGHT_Y_OFFSET = 0.2; // How much the highlighted beat cube raises // From monolithic

// --- Beat Cube Layout ---
export const BEAT_CUBE_HALF_SIDE_3D = 0.15; // Size of the beat cube itself // From monolithic
export const MIN_SPHERE_SURFACE_SPACING_3D = 0.15; // Increased spacing between individual beat cubes // From monolithic
export const GROUP_SIZE_3D = 4; // Grouping for visual spacing
export const GROUP_GAP_3D = 0.25; // Increased spacing between groups of 4 beat cubes
export const BEAT_AREA_PADDING_3D = 0.2; // (From context, not directly in monolithic but good for layout logic)

// --- Measure Pagination ---
export const MEASURES_PER_PAGE_3D = 4;

// --- Main Control Rows (Center Area) ---
export const Z_ROW_MAIN_1 = 3.5;    // Start/Stop, Tap, Reset
export const Z_ROW_MAIN_2 = 2.0;    // Tempo, Volume
export const Z_ROW_MAIN_3 = 0.5;    // Beats, Bars, Subdivision
export const Z_ROW_MAIN_4 = -1.0;   // Presets
export const Z_ROW_MEASURES_PAGING = -2.5; // Measures Paging

// --- Theme Buttons Column (Left Side) ---
export const X_POS_THEME_COLUMN = -4.8;
export const Z_POS_THEME_HEADER = 3.8;
export const Z_POS_THEME_START = 3.0;
export const THEME_BUTTON_VERTICAL_SPACING = 1.0;

// --- Camera and Light Controls Column (Right Side) ---
export const X_POS_CAMERA_LIGHT_COLUMN = 4.8;
export const CAMERA_LIGHT_BUTTON_HORIZONTAL_OFFSET = 0.6; // Offset for +/- or </> buttons from center label
export const Z_POS_CAMERA_LIGHT_HEADER_START = 3.8; // For "Camera Controls" / "Light Controls" headers
export const Z_POS_CAMERA_LIGHT_SECTION_SPACING = 2.2; // Vertical space between Camera section and Light section
export const Z_POS_CAMERA_LIGHT_ROW_SPACING = 0.9;   // Vertical space between rows within a C/L section

export const CAMERA_LIGHT_BUTTON_RADIUS = BUTTON_DIM_LARGE; // Using new constant for clarity, though value might be same as old 0.25
export const CAMERA_LIGHT_BUTTON_HEIGHT = BUTTON_HEIGHT_THEME_CAMERA_LIGHT; // Using new constant
export const Y_POS_CAMERA_LIGHT_LABELS = BUTTON_Y_POSITION + BUTTON_HEIGHT_THEME_CAMERA_LIGHT + 0.12;
export const Y_POS_CAMERA_LIGHT_SECTION_HEADER = BUTTON_Y_POSITION + BUTTON_HEIGHT_THEME_CAMERA_LIGHT + 0.32;
export const TEXT_SIZE_SMALL = 0.07;    // For small labels, captions, theme buttons, camera/light labels (e.g., "Zoom")
export const TEXT_SIZE_REGULAR = 0.09;  // For general labels, headers, camera/light section headers (e.g., "Camera Controls")
export const TEXT_SIZE_LARGE = 0.12;    // For value displays, arrow symbols (camera/light arrows < > ^ v)
export const TEXT_SIZE_XLARGE = 0.15;   // For prominent symbols like +/- (camera/light +/-)

// Specific constants for Camera/Light control labels, derived from generic sizes
export const CAMERA_LIGHT_LABEL_SIZE = TEXT_SIZE_SMALL;
export const CAMERA_LIGHT_PLUS_MINUS_LABEL_SIZE = TEXT_SIZE_XLARGE;
export const CAMERA_LIGHT_ARROW_LABEL_SIZE = TEXT_SIZE_LARGE;
export const CAMERA_LIGHT_SECTION_HEADER_LABEL_SIZE = TEXT_SIZE_REGULAR;

// --- Joystick Controls ---
export const JOYSTICK_BASE_RADIUS = 0.6;
export const JOYSTICK_BASE_HEIGHT = 0.05;
export const JOYSTICK_STICK_RADIUS = 0.2;
export const JOYSTICK_STICK_HEIGHT = 0.3;
export const JOYSTICK_MAX_DISPLACEMENT = JOYSTICK_BASE_RADIUS - JOYSTICK_STICK_RADIUS;
export const JOYSTICK_SENSITIVITY_H = 0.002; // Radians per pixel
export const JOYSTICK_SENSITIVITY_V = 0.002; // Radians per pixel
export const JOYSTICK_STICK_COLOR = DefaultThemeColors3D.main.clone();
export const JOYSTICK_BASE_COLOR = DefaultThemeColors3D.textSecondary.clone();

// --- Light Control Joystick ---
export const LIGHT_JOYSTICK_BASE_RADIUS = 0.5;
export const LIGHT_JOYSTICK_BASE_HEIGHT = 0.05;
export const LIGHT_JOYSTICK_STICK_RADIUS = 0.15;
export const LIGHT_JOYSTICK_STICK_HEIGHT = 0.25;
export const LIGHT_JOYSTICK_MAX_DISPLACEMENT = LIGHT_JOYSTICK_BASE_RADIUS - LIGHT_JOYSTICK_STICK_RADIUS;
export const LIGHT_JOYSTICK_SENSITIVITY_H = 0.0025; // Radians per pixel for horizontal rotation
export const LIGHT_JOYSTICK_SENSITIVITY_V = 0.025;  // Units per pixel for elevation
export const LIGHT_JOYSTICK_SENSITIVITY_INTENSITY = 0.005; // Intensity change per pixel of vertical drag
export const LIGHT_JOYSTICK_STICK_COLOR = DefaultThemeColors3D.accent.clone();
export const LIGHT_JOYSTICK_BASE_COLOR = DefaultThemeColors3D.textSecondary.clone();

// --- Slider Constants ---
export const SLIDER_TRACK_WIDTH = 1.5; // Width of the slider track
export const SLIDER_TRACK_HEIGHT = 0.1; // Thickness of the track
export const SLIDER_TRACK_DEPTH = 0.1;  // Depth of the track (if it's a box)
export const SLIDER_HANDLE_WIDTH = 0.2; // Width of the slider handle
export const SLIDER_HANDLE_HEIGHT = 0.3; // Height of the handle
export const SLIDER_HANDLE_DEPTH = 0.2; // Depth of the handle
export const SLIDER_SENSITIVITY = 0.005; // How much the value changes per pixel of drag

// --- Light Control ---
export const LIGHT_INTENSITY_STEP = 0.1;