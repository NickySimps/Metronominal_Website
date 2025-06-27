/**
 * 3dTheme.js
 * This module manages the Three.js 3D "Room" theme, including scene setup,
 * object creation, user interactions, and visual updates.
 * NOTE: Ensure Three.js is loaded in your HTML before this script if using the global `THREE`.
 */
import * as THREE from 'three'; // Keep for type hinting or direct THREE calls if any emerge
import AppState from '../appState.js';
// Import the refactored manager modules
import * as SceneManager from './threeDSceneManager.js';
import * as ControlsManager from './threeDControlsManager.js';
import * as MeasuresManager from './threeDMeasuresManager.js';
import * as CameraManager from './threeDCameraManager.js';
import * as InteractionManager from './threeDInteractionManager.js';
// Constants are imported by individual modules as needed.

let mainContainerRef = null; // To store reference to the main 2D UI container passed during init

const ThreeDThemeManager = {
    initialize: function(uiMainContainerRef) {
        mainContainerRef = uiMainContainerRef;

        // SceneManager's initializeScene will take callbacks for when the font is loaded
        SceneManager.initializeScene(
            mainContainerRef,
            // Callback for creating controls
            (font, controlsGroup, interactionGroup) => {
                ControlsManager.createControls(font, controlsGroup, interactionGroup); 
            },
            // Callback for creating measures
            (measuresGroup) => {
                MeasuresManager.createMeasuresAndBeats(
                    measuresGroup,
                    SceneManager.getLoadedFont(),
                    SceneManager.getInteractionGroup()
                );
                // Monolithic does not dynamically adjust camera to fit content after creation.
                // Initial camera setup is in SceneManager.initializeScene.
            }
        );

        // Initialize interaction handlers after scene and groups are potentially set up by SceneManager
        InteractionManager.initializeEventHandlers(
            SceneManager.getRenderer(),
            SceneManager.getCamera(),
            SceneManager.getScene(),
            SceneManager.getInteractionGroup(), // Pass the new group for hitboxes
            SceneManager.getMeasuresGroup(),    // Direct measure meshes
            SceneManager.getLoadedFont(),       // For any text updates during interaction
            SceneManager.getControlsGroup()     // Pass original controls group for direct access to draggable parts if needed
        );

        if (mainContainerRef) mainContainerRef.style.display = 'none'; // Hide 2D UI
        console.log("3dTheme: Initialization complete by ThemeManager.");
    },
    dispose: function() {
        InteractionManager.removeEventHandlers();
        
        // Dispose individual managers' resources
        ControlsManager.disposeControls();
        MeasuresManager.disposeMeasures();
        // CameraManager typically doesn't hold disposable resources itself
        
        // SceneManager handles its own disposal of listeners, animation frame, and nullifying its refs.
        // The actual THREE.js object disposal (geometries, materials, renderer) is done here for clarity.
        // Retrieve scene and renderer references before SceneManager.disposeScene()
        // in case it nullifies or disposes them internally.
        const scene = SceneManager.getScene();
        const renderer = SceneManager.getRenderer();

        // Allow SceneManager to dispose of its specific resources, animation loop, and listeners.
        SceneManager.disposeScene(); 

        // Full scene object disposal (geometries, materials)
        if (scene) {
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
            scene.clear();
        }
        if (renderer) {
            const canvas = renderer.domElement;
            renderer.dispose();
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
        }
        if (mainContainerRef) mainContainerRef.style.display = ''; // Show 2D UI
        mainContainerRef = null;
        console.log("3dTheme: Scene fully disposed by ThreeDThemeManager.");
    },
    isActive: function() {
        return SceneManager.isSceneActive();
    },
    updatePlayheadVisuals: function(barIndex, beatInBarWithSubdivisions, beatMultiplier) {
        if (!this.isActive()) return;
        MeasuresManager.updatePlayheadVisuals(barIndex, beatInBarWithSubdivisions, beatMultiplier);
    },
    clearAllVisualHighlights: function() {
        if (!this.isActive()) return;
        MeasuresManager.clearAllVisualHighlights();
    },
    syncCurrentPageWithSelectedBar: function() {
        if (!this.isActive()) return false;
        const pageChanged = MeasuresManager.syncCurrentPageWithSelectedBar();
        // if (pageChanged) { // Monolithic doesn't rebuild here, rebuild is explicit via rebuildMeasuresAndBeats
        //     this.rebuildMeasuresAndBeats();
        // }
        return pageChanged;
    },
    rebuildMeasuresAndBeats: function() {
        if (!this.isActive()) return;
        MeasuresManager.createMeasuresAndBeats(
            SceneManager.getMeasuresGroup(),
            SceneManager.getLoadedFont(),
            SceneManager.getInteractionGroup()
        );
        // Monolithic does not adjust camera after rebuild.
    },
    adjustCameraToFitSceneContent: function() {
        // This method was in the original context 3dTheme.js, but monolithic logic doesn't use it.
        // Kept for API compatibility if other modules expect it, but it will do nothing based on monolithic.
        if (!this.isActive()) return;
        // CameraManager.adjustCameraToFitSceneContent(...); // No dynamic adjustment in monolithic
        console.log("ThreeDThemeManager.adjustCameraToFitSceneContent called, but no dynamic adjustment in current logic.");
    },
    updateDynamicControlLabels: function() {
        // This was part of the original context 3dTheme.js
        if (!this.isActive() || !SceneManager.getLoadedFont()) return;
        ControlsManager.updateDynamicControlLabels();
    },
    // This function is called by themeController.js after state changes (e.g., preset load)
    update3DScenePostStateChange: function() {
        if (!this.isActive()) return;
        this.updateDynamicControlLabels();
        this.rebuildMeasuresAndBeats(); // Rebuild measures as labels/state might relate to them
        // Monolithic does not adjust camera after this.
    },
};

export default ThreeDThemeManager;
