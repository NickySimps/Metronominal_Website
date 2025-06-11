/**
 * threeDObjectFactory.js
 * Helper functions for creating common 3D objects like text labels, buttons, and knobs.
 */
import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import {
    BUTTON_Y_POSITION, DefaultThemeColors3D,
    KNOB_RADIUS, KNOB_HEIGHT, KNOB_SEGMENTS,
    BUTTON_SHAPE_CIRCLE, BUTTON_SHAPE_SQUARE, BUTTON_SHAPE_ROUNDED_SQUARE
} from './threeDConstants.js';



/**
 * Creates a 3D text label.
 * @param {string} text - The text content.
 * @param {THREE.Font} font - The loaded Three.js font.
 * @param {number} size - The size of the text.
 * @param {THREE.Color} textColor - The color of the text.
 * @param {object} textPosition - {x, y, z} position.
 * @param {object} textRotation - {x, y, z} rotation in radians.
 * @returns {THREE.Mesh|null} The text mesh or null if font/text is missing.
 */
export function createTextLabel(text, font, size, textColor, textPosition, textRotation = { x: -Math.PI / 2, y: 0, z: 0 }) {
    if (!font || (text === null || typeof text === 'undefined')) {
        console.warn("Font or text not available for createTextLabel", { font, text });
        return null; // Return null if font or text is missing
    }

    const textGeo = new TextGeometry(text, {
        font: font,
        size: size, // Use the passed-in size parameter
        height: size * 0.1,
        depth: size / 2, // Make depth proportional to size, e.g., 10% of size, or keep 0.00 for flat.
        curveSegments: 4,
        bevelEnabled: false
    });

    textGeo.computeBoundingBox();
    const textBoundingBox = textGeo.boundingBox;
    const textWidth = textBoundingBox ? (textBoundingBox.max.x - textBoundingBox.min.x) : 0;

    const textMat = new THREE.MeshBasicMaterial({ color: textColor, transparent: true, opacity: 0.9 });
    const textMesh = new THREE.Mesh(textGeo, textMat);

    // Centering logic from monolithic:
    // textMesh.position.set(textPosition.x - textWidth / 2, textPosition.y, textPosition.z + size * 0.5);
    // The monolithic file's addTextLabel has:
    // textMesh.position.set(textPosition.x - textWidth / 2, textPosition.y, textPosition.z + size * 0.5);
    // This seems to be an attempt to vertically center. Let's stick to it.
    // However, the original context file had a more robust centering for Z:
    // const textCharacterCenterOffsetY = (textBoundingBox.min.y + textBoundingBox.max.y) / 2;
    // textMesh.position.set(textPosition.x - textWidth / 2, textPosition.y, textPosition.z - textCharacterCenterOffsetY);
    // Given "perfectly match the functionality within this post", we use the monolithic's logic.
    textMesh.position.set(textPosition.x - textWidth / 2, textPosition.y, textPosition.z + size * 0.5); // Monolithic version
    textMesh.rotation.set(textRotation.x, textRotation.y, textRotation.z);

    // Note: The monolithic `addTextLabel` added the mesh to `controlsGroup`.
    // The factory should just return the mesh. The caller (ControlsManager) will add it.
    return textMesh;
}

/**
 * Creates a standing rounded square geometry for buttons.
 * The face of the button is on the XZ plane, and it's extruded along Y.
 * @param {number} width - The width of the button face (along X).
 * @param {number} length - The length of the button face (along Z).
 * @param {number} height - The height of the button (extrusion along Y).
 * @param {number} cornerRadius - The radius of the corners.
 * @returns {THREE.ExtrudeGeometry} The button geometry.
 */
function createStandingRoundedSquareGeometry(width, length, height, cornerRadius) {
    const shape = new THREE.Shape();
    // Define shape in XY plane (which will become XZ after rotation)
    // Width of shape corresponds to button's X dimension, Length of shape to button's Z dimension
    shape.moveTo(cornerRadius, 0); // Start
    shape.lineTo(width - cornerRadius, 0); // Bottom edge
    shape.absarc(width - cornerRadius, cornerRadius, cornerRadius, -Math.PI / 2, 0, false); // Bottom-right corner
    shape.lineTo(width, length - cornerRadius); // Right edge
    shape.absarc(width - cornerRadius, length - cornerRadius, cornerRadius, 0, Math.PI / 2, false); // Top-right corner
    shape.lineTo(cornerRadius, length); // Top edge
    shape.absarc(cornerRadius, length - cornerRadius, cornerRadius, Math.PI / 2, Math.PI, false); // Top-left corner
    shape.lineTo(0, cornerRadius); // Left edge
    shape.absarc(cornerRadius, cornerRadius, cornerRadius, Math.PI, Math.PI * 1.5, false); // Bottom-left corner

    const extrudeSettings = {
        depth: height, // This will be the button's height along the Y-axis after rotation
        bevelEnabled: false,
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // The shape is in XY plane, extruded along Z.
    // Rotate so that the original XY plane of the shape becomes the XZ plane,
    // and the extrusion depth (original Z) becomes the Y dimension.
    geometry.rotateX(-Math.PI / 2);
    // Translate so the center of the bounding box is at (0,0,0)
    geometry.center();
    return geometry;
}

export function createButtonMesh(name, color, position, size, height, shape, cornerRadius = 0.05) {
    let geometry;
    if (shape === BUTTON_SHAPE_CIRCLE) {
        geometry = new THREE.CylinderGeometry(size, size, height, 32);
    } else if (shape === BUTTON_SHAPE_SQUARE) {
        geometry = new THREE.BoxGeometry(size * 2, height, size * 2); // size is half-side
    } else if (shape === BUTTON_SHAPE_ROUNDED_SQUARE) {
        // size is half-side, so full width/length is size * 2
        geometry = createStandingRoundedSquareGeometry(size * 2, size * 2, height, cornerRadius);
    } else { // Default to square
        geometry = new THREE.BoxGeometry(size * 2, height, size * 2);
    }

    const material = new THREE.MeshStandardMaterial({ color: color, metalness: 0.3, roughness: 1 });
    const button = new THREE.Mesh(geometry, material);
    button.name = name;
    button.position.set(position.x, BUTTON_Y_POSITION + height / 2, position.z); // Centered on its height above BUTTON_Y_POSITION
    button.castShadow = true;
    button.receiveShadow = true;
    return button;
}

export function createInteractiveKnobGroup(name, color, position, radius = KNOB_RADIUS, height = KNOB_HEIGHT, segments = KNOB_SEGMENTS) {
    const knobGroup = new THREE.Group();
    knobGroup.name = name;
    // color parameter is not used in the original context's knob body, but kept for signature consistency.

    const bodyGeometry = new THREE.CylinderGeometry(radius, radius, height, segments);
    const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 0.2,
        roughness: 0.4
    });
    const knobBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
    knobBody.name = name + "_body";
    knobBody.castShadow = true;
    knobBody.receiveShadow = true;
    knobGroup.add(knobBody);

    const indicatorRadius = radius * 0.15;
    const indicatorHeight = height * 0.1;
    const indicatorGeometry = new THREE.CylinderGeometry(indicatorRadius, indicatorRadius, indicatorHeight, 16);
    // Color from original context file
    const indicatorMaterial = new THREE.MeshStandardMaterial({ color: DefaultThemeColors3D.textOnMain.clone().lerp(DefaultThemeColors3D.textPrimary, 0.2) }); 
    const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    indicator.name = name + "_indicator";
    indicator.position.set(radius * 0.7, height / 2 - indicatorHeight / 2 + 0.001, 0);
    knobBody.add(indicator);

    knobGroup.position.set(position.x, BUTTON_Y_POSITION + height / 2, position.z);
    return knobGroup;
}

export function createInteractiveSliderGroup(name, trackColor, handleColor, position,
    trackWidth, trackHeight, trackDepth,
    handleWidth, handleHeight, handleDepth) {

    const sliderGroup = new THREE.Group();
    sliderGroup.name = name;

    const trackGeometry = new THREE.BoxGeometry(trackWidth, trackHeight, trackDepth);
    const trackMaterial = new THREE.MeshStandardMaterial({ color: trackColor, metalness: 0.2, roughness: 0.6 });
    const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
    trackMesh.name = name + "_track";
    trackMesh.castShadow = true;
    trackMesh.receiveShadow = true;
    sliderGroup.add(trackMesh); // Track is at the group's origin

    const handleGeometry = new THREE.BoxGeometry(handleWidth, handleHeight, handleDepth);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: handleColor, metalness: 0.4, roughness: 0.4 });
    const handleMesh = new THREE.Mesh(handleGeometry, handleMaterial);
    handleMesh.name = name + "_handle";
    // Position handle relative to the track. Y offset so it's on top.
    handleMesh.position.y = (trackHeight / 2) + (handleHeight / 2) - trackHeight/2; // Adjusted so handle base aligns with track top
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;
    sliderGroup.add(handleMesh); // Add handle to the group, its X will be set based on value

    // Position the entire slider group. The Y position should ensure the base of the track/handle is on BUTTON_Y_POSITION + its own height/2
    sliderGroup.position.set(position.x, BUTTON_Y_POSITION + Math.max(trackHeight, handleHeight) / 2, position.z);

    sliderGroup.userData.trackWidth = trackWidth; // Store for interaction manager
    sliderGroup.userData.handleHeight = handleHeight; // Store for Y positioning if needed elsewhere
    return sliderGroup;
}