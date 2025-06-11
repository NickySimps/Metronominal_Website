/**
 * threeDMeasuresManager.js
 * Manages the creation, display, and interaction of 3D measures and beats.
 */
import * as THREE from 'three';
import AppState from '../appState.js';
import {
    DEFAULT_MEASURE_COLOR, SELECTED_MEASURE_COLOR, PLAYHEAD_SELECTED_MEASURE_COLOR,
    DEFAULT_MEASURE_OPACITY, SELECTED_MEASURE_OPACITY, PLAYHEAD_SELECTED_MEASURE_OPACITY,
    MAIN_BEAT_COLOR_3D_DEFAULT, SUB_BEAT_COLOR_3D_DEFAULT, HIGHLIGHT_COLOR_3D, BEAT_HIGHLIGHT_Y_OFFSET,
    BEAT_CUBE_HALF_SIDE_3D, MIN_SPHERE_SURFACE_SPACING_3D, GROUP_SIZE_3D, GROUP_GAP_3D, BEAT_AREA_PADDING_3D,
    MEASURES_PER_PAGE_3D, BUTTON_Y_POSITION // BEAT_AREA_PADDING_3D is from context, not monolithic but useful for layout
} from './threeDConstants.js';

let localMeasuresGroupRef = null;
let measureBoxes = []; // Array to hold references to the measure box meshes on the current page (monolithic doesn't use this array directly, but good for potential extensions)
let selectedMeasureBoxMesh = null;
let selectedMeasureWireframeMesh = null; // From monolithic
let currentPlayheadBarIndex = -1;
let currentHighlightedBeat3D = { bar: -1, beat: -1 };
let currentMeasurePage3D = 0;
let totalMeasurePages3D = 0;

export function createMeasuresAndBeats(measuresGroup) {
    localMeasuresGroupRef = measuresGroup;
    if (!measuresGroup) {
        console.warn("Cannot create 3D measures/beats: measuresGroup not ready.");
        return;
    }
    // Clear previous measures from monolithic
    while (measuresGroup.children.length) {
        const child = measuresGroup.children[0];
        measuresGroup.remove(child);

        // Recursively dispose children of the removed child
        child.traverse(object => {
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
    }
    measureBoxes = [];
    currentPlayheadBarIndex = -1; // Reset from monolithic
    currentHighlightedBeat3D = { bar: -1, beat: -1 }; // Reset from monolithic
    const selectedBarGlobalIndex = AppState.getSelectedBarIndex(); // From monolithic

    // Wireframe disposal from monolithic
    if (selectedMeasureWireframeMesh) {
        selectedMeasureWireframeMesh.parent?.remove(selectedMeasureWireframeMesh);
        if (selectedMeasureWireframeMesh.geometry) selectedMeasureWireframeMesh.geometry.dispose();
        if (selectedMeasureWireframeMesh.material) selectedMeasureWireframeMesh.material.dispose();
        selectedMeasureWireframeMesh = null;
    }
    selectedMeasureBoxMesh = null;

    const beatMultiplier = AppState.getBeatMultiplier();
    let barSettings = AppState.getBarSettings();
    if (!barSettings || barSettings.length === 0) barSettings = [4]; // Default if empty

    const totalMeasuresGlobal = barSettings.length;
    totalMeasurePages3D = totalMeasuresGlobal > 0 ? Math.ceil(totalMeasuresGlobal / MEASURES_PER_PAGE_3D) : 0;
    currentMeasurePage3D = Math.max(0, Math.min(currentMeasurePage3D, totalMeasurePages3D - 1)); // Ensure page is valid

    const startIndex = currentMeasurePage3D * MEASURES_PER_PAGE_3D;
    const endIndex = Math.min(startIndex + MEASURES_PER_PAGE_3D, totalMeasuresGlobal);
    const numMeasuresOnPage = endIndex - startIndex;

    const MEASURE_BOX_VISUAL_SCALE_FACTOR = 1.2; // Increase measure box dimensions by 20%
    // Initial dimensions for beat cubes and spacing (unscaled)
    const initialCubeSideLength = BEAT_CUBE_HALF_SIDE_3D * 2;
    const initialMinSpacing = MIN_SPHERE_SURFACE_SPACING_3D;
    const initialGroupGap = GROUP_GAP_3D;
    const boxWidth = 3.5 * MEASURE_BOX_VISUAL_SCALE_FACTOR;
    const boxHeight = 1.0 * MEASURE_BOX_VISUAL_SCALE_FACTOR;
    const boxDepth = 1.5 * MEASURE_BOX_VISUAL_SCALE_FACTOR;
    const spacing = 1.0; // Spacing between measure boxes; might need adjustment if scaled boxes are too close
    const measuresZ = 6;
    const pageDisplayWidth = numMeasuresOnPage * boxWidth + (numMeasuresOnPage > 1 ? (numMeasuresOnPage - 1) * spacing : 0);

    for (let i = 0; i < numMeasuresOnPage; i++) {
        const globalBarIndex = startIndex + i;
        const measureGeo = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
        const measureMat = new THREE.MeshStandardMaterial({
            color: DEFAULT_MEASURE_COLOR.clone(), // Clone to avoid shared material instance issues
            transparent: true, opacity: DEFAULT_MEASURE_OPACITY, side: THREE.DoubleSide,
        });
        const measureBox = new THREE.Mesh(measureGeo, measureMat);
        measureBox.name = `measureBox_${globalBarIndex}`;
        const xPos = (i * (boxWidth + spacing)) - pageDisplayWidth / 2 + boxWidth / 2;
        measureBox.position.set(xPos, BUTTON_Y_POSITION + boxHeight / 2 + 0.5, measuresZ);
        measureBox.castShadow = true; measureBox.receiveShadow = true;
        measuresGroup.add(measureBox);
        measureBoxes.push(measureBox);

        const subBeats = (barSettings[globalBarIndex] || 4) * beatMultiplier;
        
        let currentCubeSideLength = initialCubeSideLength;
        let currentMinSpacing = initialMinSpacing;
        let currentGroupGap = initialGroupGap;
        let scaleFactor = 1.0;

        const availableWidthForCubes = boxWidth - (2 * BEAT_AREA_PADDING_3D);
        let requiredWidthForCubesUnscaled = 0;

        if (subBeats > 0) {
            requiredWidthForCubesUnscaled = subBeats * initialCubeSideLength;
            if (subBeats > 1) {
                requiredWidthForCubesUnscaled += (subBeats - 1) * initialMinSpacing;
                const numberOfGroupGaps = Math.floor((subBeats - 1) / GROUP_SIZE_3D);
                requiredWidthForCubesUnscaled += numberOfGroupGaps * initialGroupGap;
            }
        }

        if (subBeats > 0 && requiredWidthForCubesUnscaled > availableWidthForCubes && availableWidthForCubes > 0) {
            scaleFactor = availableWidthForCubes / requiredWidthForCubesUnscaled;
            currentCubeSideLength = initialCubeSideLength * scaleFactor;
            currentMinSpacing = initialMinSpacing * scaleFactor;
            currentGroupGap = initialGroupGap * scaleFactor;
        }

        let totalWidthForPositioning = 0;
        if (subBeats > 0) {
            totalWidthForPositioning = subBeats * currentCubeSideLength;
            if (subBeats > 1) {
                totalWidthForPositioning += (subBeats - 1) * currentMinSpacing;
                const numberOfGroupGaps = Math.floor((subBeats - 1) / GROUP_SIZE_3D);
                totalWidthForPositioning += numberOfGroupGaps * currentGroupGap;
            }
        }
        let currentCubeX = (subBeats > 0) ? -totalWidthForPositioning / 2 + currentCubeSideLength / 2 : 0;

        if (subBeats > 0) {
            for (let j = 0; j < subBeats; j++) {
                const beatGeo = new THREE.BoxGeometry(currentCubeSideLength, currentCubeSideLength, currentCubeSideLength);
                const isMain = j % beatMultiplier === 0;
                const beatMat = new THREE.MeshStandardMaterial({ color: isMain ? MAIN_BEAT_COLOR_3D_DEFAULT : SUB_BEAT_COLOR_3D_DEFAULT });
                const beatCube = new THREE.Mesh(beatGeo, beatMat);
                beatCube.name = `beatSphere_${globalBarIndex}_${j}`; // "Sphere" is legacy name from monolithic
                beatCube.position.set(currentCubeX, 0, 0); // Position relative to measureBox center
                beatCube.castShadow = true; // From monolithic
                measureBox.add(beatCube);
                currentCubeX += currentCubeSideLength + currentMinSpacing;
                if ((j + 1) % GROUP_SIZE_3D === 0 && j < subBeats - 1) { // From monolithic
                    currentCubeX += currentGroupGap;
                }
            }
        }
    }

    if (selectedBarGlobalIndex >= startIndex && selectedBarGlobalIndex < endIndex) {
        const selectedBox = measuresGroup.getObjectByName(`measureBox_${selectedBarGlobalIndex}`);
        if (selectedBox) {
            selectedBox.material.color.set(SELECTED_MEASURE_COLOR);
            selectedBox.material.opacity = SELECTED_MEASURE_OPACITY;
            // Add wireframe as per monolithic
            const wireframeGeometry = new THREE.WireframeGeometry(selectedBox.geometry); // Use existing geometry
            const wireframeMaterial = new THREE.LineBasicMaterial({ color: SELECTED_MEASURE_COLOR });
            selectedMeasureWireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
            selectedBox.add(selectedMeasureWireframeMesh);
            selectedMeasureBoxMesh = selectedBox;
        }
    }
    console.log("3dTheme: Measures and Beats created/rebuilt by MeasuresManager.");
}

export function updatePlayheadVisuals(barIndex, beatInBarWithSubdivisions, beatMultiplier) {
    if (!localMeasuresGroupRef) return;

    // Page sync from monolithic
    if (barIndex >= 0 && AppState.getBarSettings().length > 0) {
        const targetPage = Math.floor(barIndex / MEASURES_PER_PAGE_3D);
        if (targetPage !== currentMeasurePage3D) {
            currentMeasurePage3D = targetPage;
            createMeasuresAndBeats(localMeasuresGroupRef); // Rebuild for new page
        }
    }

    // Update measure box color for playhead from monolithic
    if (barIndex !== currentPlayheadBarIndex) {
        if (currentPlayheadBarIndex !== -1) {
            const oldBox = localMeasuresGroupRef.getObjectByName(`measureBox_${currentPlayheadBarIndex}`);
            if (oldBox) {
                if (oldBox === selectedMeasureBoxMesh) {
                    oldBox.material.color.set(SELECTED_MEASURE_COLOR);
                    oldBox.material.opacity = SELECTED_MEASURE_OPACITY;
                } else {
                    oldBox.material.color.set(DEFAULT_MEASURE_COLOR);
                    oldBox.material.opacity = DEFAULT_MEASURE_OPACITY;
                }
            }
        }
        const newBox = localMeasuresGroupRef.getObjectByName(`measureBox_${barIndex}`);
        if (newBox) {
            newBox.material.color.set(PLAYHEAD_SELECTED_MEASURE_COLOR);
            newBox.material.opacity = PLAYHEAD_SELECTED_MEASURE_OPACITY;
        }
        currentPlayheadBarIndex = barIndex;
    }

    // Update beat highlight from monolithic
    if (currentHighlightedBeat3D.bar !== -1 && currentHighlightedBeat3D.beat !== -1) {
        const prevMeasureBox = localMeasuresGroupRef.getObjectByName(`measureBox_${currentHighlightedBeat3D.bar}`);
        if (prevMeasureBox) {
            const prevBeat = prevMeasureBox.getObjectByName(`beatSphere_${currentHighlightedBeat3D.bar}_${currentHighlightedBeat3D.beat}`);
            if (prevBeat) {
                prevBeat.material.color.set(currentHighlightedBeat3D.beat % beatMultiplier === 0 ? MAIN_BEAT_COLOR_3D_DEFAULT : SUB_BEAT_COLOR_3D_DEFAULT);
                prevBeat.position.y = 0;
            }
        }
    }

    const currentMeasureBox = localMeasuresGroupRef.getObjectByName(`measureBox_${barIndex}`);
    if (currentMeasureBox) {
        const beatToHighlight = currentMeasureBox.getObjectByName(`beatSphere_${barIndex}_${beatInBarWithSubdivisions}`);
        if (beatToHighlight) {
            beatToHighlight.material.color.set(HIGHLIGHT_COLOR_3D);
            beatToHighlight.position.y = BEAT_HIGHLIGHT_Y_OFFSET;
            currentHighlightedBeat3D = { bar: barIndex, beat: beatInBarWithSubdivisions };
        } else { currentHighlightedBeat3D = { bar: -1, beat: -1 }; }
    } else { currentHighlightedBeat3D = { bar: -1, beat: -1 }; }
}

export function clearAllVisualHighlights() {
    if (!localMeasuresGroupRef) return;
    const beatMultiplier = AppState.getBeatMultiplier();
    localMeasuresGroupRef.traverse((object) => {
        if (object.isMesh && object.name && object.name.startsWith('beatSphere_')) {
            const beatIdx = parseInt(object.name.split('_')[2], 10);
            object.material.color.set(beatIdx % beatMultiplier === 0 ? MAIN_BEAT_COLOR_3D_DEFAULT : SUB_BEAT_COLOR_3D_DEFAULT);
            object.position.y = 0;
        } else if (object.isMesh && object.name?.startsWith('measureBox_')) {
            if (object !== selectedMeasureBoxMesh) { // Don't reset user-selected one unless it's also playhead
                object.material.color.set(DEFAULT_MEASURE_COLOR);
                object.material.opacity = DEFAULT_MEASURE_OPACITY;
            }
        }
    });
    currentPlayheadBarIndex = -1;
    currentHighlightedBeat3D = { bar: -1, beat: -1 };
}

export function syncCurrentPageWithSelectedBar() {
    const selectedBar = AppState.getSelectedBarIndex();
    if (selectedBar >= 0 && AppState.getBarSettings().length > 0) {
        const targetPage = Math.floor(selectedBar / MEASURES_PER_PAGE_3D);
        if (targetPage !== currentMeasurePage3D) {
            currentMeasurePage3D = targetPage;
            return true; // Page changed, rebuild needed
        }
    }
    return false;
}

export function getMeasureBoxes() { return measureBoxes; }
export function getSelectedMeasureBoxMesh() { return selectedMeasureBoxMesh; }
export function setSelectedMeasureBoxMesh(mesh) { selectedMeasureBoxMesh = mesh; }
export function getSelectedMeasureWireframeMesh() { return selectedMeasureWireframeMesh; }
export function setSelectedMeasureWireframeMesh(mesh) { selectedMeasureWireframeMesh = mesh; }
export function getCurrentMeasurePage() { return currentMeasurePage3D; }
export function getTotalMeasurePages() { return totalMeasurePages3D; }
export function incrementPage() { 
    if (currentMeasurePage3D < totalMeasurePages3D - 1) currentMeasurePage3D++; 
}
export function decrementPage() { 
    if (currentMeasurePage3D > 0) currentMeasurePage3D--; 
}

export function disposeMeasures() {
    // localMeasuresGroupRef children are disposed by SceneManager's scene.clear() or main 3dTheme.dispose()
    // This function primarily resets state variables.
    measureBoxes = [];
    selectedMeasureBoxMesh = null;
    currentPlayheadBarIndex = -1;
    currentHighlightedBeat3D = { bar: -1, beat: -1 };
    currentMeasurePage3D = 0;
    totalMeasurePages3D = 0;
    localMeasuresGroupRef = null;
    selectedMeasureWireframeMesh = null; // Ensure wireframe is nulled
}