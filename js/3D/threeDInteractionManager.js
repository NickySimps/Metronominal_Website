/**
 * threeDInteractionManager.js
 * Handles user interactions with the 3D scene (clicks, drags).
 */
import * as THREE from 'three';
import DOM from '../domSelectors.js'; // For DOM element clicks
import AppState from '../appState.js';
import ThemeController from '../themeController.js'; // For theme switching actions
import * as CameraManager from './threeDCameraManager.js'; // For camera controls
import VolumeController from '../volumeController.js'; // For updating 2D volume slider
import * as SceneManager from './threeDSceneManager.js'; // For light controls
import * as ControlsManager from './threeDControlsManager.js'; // For label updates after interactions
import * as MeasuresManager from './threeDMeasuresManager.js'; // For measure clicks & page changes
import { 
    Y_POS_LABELS_ABOVE_BUTTONS, LABEL_TEXT_COLOR, // For label updates
    SELECTED_MEASURE_COLOR, SELECTED_MEASURE_OPACITY, // For measure selection visuals
    DEFAULT_MEASURE_COLOR, DEFAULT_MEASURE_OPACITY // For deselecting measures
} from './threeDConstants.js';
import { SLIDER_SENSITIVITY } from './threeDConstants.js'; // Import slider sensitivity
import { 
    JOYSTICK_SENSITIVITY_H, JOYSTICK_SENSITIVITY_V, JOYSTICK_MAX_DISPLACEMENT, LIGHT_INTENSITY_STEP,
    LIGHT_JOYSTICK_SENSITIVITY_H, LIGHT_JOYSTICK_SENSITIVITY_V, LIGHT_JOYSTICK_SENSITIVITY_INTENSITY, LIGHT_JOYSTICK_MAX_DISPLACEMENT
} from './threeDConstants.js';


// Knob dragging logic is removed as per monolithic file's functionality
// Joystick, Knob, and Slider Dragging State
let draggedObject = null; // Can be a knob body, joystick stick, or slider handle
let isDraggingJoystick = false;
let isDraggingKnob = false;
let isDraggingSlider = false;
let joystickDragAnchorScreenPos = new THREE.Vector2(); // For total visual displacement of stick from drag start
let joystickLastFrameScreenPos = new THREE.Vector2();  // For per-frame delta for camera orbit, updated each move
let joystickStickRestPosition = new THREE.Vector3(); // Stick's initial local position within its parent group

let isDraggingLightJoystick = false;
let lightJoystickDragAnchorScreenPos = new THREE.Vector2();
let lightJoystickLastFrameScreenPos = new THREE.Vector2();
let lightJoystickStickRestPosition = new THREE.Vector3();
let initialLightIntensity = 1.0; // Default

let initialMouseX = 0; // For knobs (original logic)
let initialKnobRotationY = 0;
let initialSliderHandleX = 0;
let initialKnobValue = 0;

let localRenderer, localCamera, localScene, localHitboxesGroup, localMeasuresGroup, localFont, localDraggablePartsGroup;

function getClickedObject(event, targetObjectsArray) {
    if (!localRenderer || !localCamera || !targetObjectsArray) return null;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, localCamera);
    const intersects = raycaster.intersectObjects(targetObjectsArray, true);
    return intersects.length > 0 ? intersects[0] : null;
}

function onPointerDown(event) {
    if (draggedObject) return; // Already dragging something

    // Raycast against the hitboxes group first
    const intersection = getClickedObject(event, localHitboxesGroup.children);
    if (!intersection) return;

    const hitboxMesh = intersection.object;
    const actualInteractiveObject = hitboxMesh.userData.visibleButton;

    if (!actualInteractiveObject) return;

    // Determine which part to drag based on the actualInteractiveObject (the visible group/mesh)
    if (actualInteractiveObject.name === "cameraJoystick3D") {
        const stick = actualInteractiveObject.getObjectByName("cameraJoystickStick3D");
        if (stick) {
            isDraggingJoystick = true;
            draggedObject = stick;
            joystickDragAnchorScreenPos.set(event.clientX, event.clientY);
            joystickLastFrameScreenPos.set(event.clientX, event.clientY);
            joystickStickRestPosition.copy(stick.position);
            isDraggingKnob = false; isDraggingSlider = false; isDraggingLightJoystick = false;
            event.preventDefault();
        }
    } else if (actualInteractiveObject.name === "tempoKnob3D") {
        const body = actualInteractiveObject.getObjectByName("tempoKnob3D_body");
        if (body) {
            isDraggingKnob = true;
            draggedObject = body;
            initialMouseX = event.clientX;
            initialKnobRotationY = body.rotation.y;
            initialKnobValue = AppState.getTempo();
            isDraggingJoystick = false; isDraggingSlider = false; isDraggingLightJoystick = false;
            event.preventDefault();
        }
    } else if (actualInteractiveObject.name === "volumeSlider3D") {
        const handle = actualInteractiveObject.getObjectByName("volumeSlider3D_handle");
        if (handle) {
            isDraggingSlider = true;
            draggedObject = handle;
            initialMouseX = event.clientX;
            initialSliderHandleX = handle.position.x;
            initialKnobValue = AppState.getVolume();
            isDraggingJoystick = false; isDraggingKnob = false; isDraggingLightJoystick = false;
            event.preventDefault();
        }
    } else if (actualInteractiveObject.name?.endsWith("Knob3D")) { // Generic knobs
        const body = actualInteractiveObject.children.find(child => child.isMesh && child.name?.endsWith("_body"));
        if (body) {
            isDraggingKnob = true;
            draggedObject = body;
            initialMouseX = event.clientX;
            initialKnobRotationY = body.rotation.y;
            if (actualInteractiveObject.name === "beatMultiplierKnob3D" && DOM.beatMultiplierSelect) initialKnobValue = DOM.beatMultiplierSelect.selectedIndex;
            else if (actualInteractiveObject.name === "presetSlotKnob3D" && DOM.presetSlotSelect) initialKnobValue = DOM.presetSlotSelect.selectedIndex;
            else initialKnobValue = 0;
            isDraggingJoystick = false; isDraggingSlider = false; isDraggingLightJoystick = false;
            event.preventDefault();
        }
    } else if (actualInteractiveObject.name === "lightControlJoystick3D") {
        const stick = actualInteractiveObject.getObjectByName("lightControlJoystickStick3D");
        if (stick) {
            isDraggingLightJoystick = true;
            draggedObject = stick;
            lightJoystickDragAnchorScreenPos.set(event.clientX, event.clientY);
            lightJoystickLastFrameScreenPos.set(event.clientX, event.clientY);
            lightJoystickStickRestPosition.copy(stick.position);
            const light = SceneManager.getDirectionalLight();
            if (light) initialLightIntensity = light.intensity;
            else initialLightIntensity = 1.0;
            isDraggingJoystick = false; isDraggingKnob = false; isDraggingSlider = false;
            event.preventDefault();
        }
    }
}

function onPointerMove(event) {
    if (!draggedObject) return;
    event.preventDefault();

    if (isDraggingJoystick) {
        const stick = draggedObject;
        const deltaX = event.clientX - joystickLastFrameScreenPos.x;
        const deltaY = event.clientY - joystickLastFrameScreenPos.y;

        // Orbit camera based on per-frame mouse delta
        CameraManager.orbitCameraHorizontal(-deltaX * JOYSTICK_SENSITIVITY_H);
        CameraManager.orbitCameraVertical(deltaY * JOYSTICK_SENSITIVITY_V);

        // Update last screen position for the next frame's delta calculation
        joystickLastFrameScreenPos.set(event.clientX, event.clientY);

        // Update joystick stick's visual position based on total displacement from drag start
        const totalDeltaXFromAnchor = event.clientX - joystickDragAnchorScreenPos.x;
        const totalDeltaYFromAnchor = event.clientY - joystickDragAnchorScreenPos.y;

        // Scale total displacement for visual feedback of the stick
        // This will be the stick's local X and Z offset from its rest position.
        let visualStickOffsetX = totalDeltaXFromAnchor * 0.01; 
        let visualStickOffsetZ = -totalDeltaYFromAnchor * 0.01; // Screen Y down moves stick "forward" (local -Z or +Z)

        const displacement = Math.sqrt(visualStickOffsetX * visualStickOffsetX + visualStickOffsetZ * visualStickOffsetZ);
        if (displacement > JOYSTICK_MAX_DISPLACEMENT) {
            const scale = JOYSTICK_MAX_DISPLACEMENT / displacement;
            visualStickOffsetX *= scale;
            visualStickOffsetZ *= scale;
        }
        
        // Set the stick's local position.
        // joystickStickRestPosition.x and .z are typically 0 if the stick is centered on its base.
        stick.position.set(joystickStickRestPosition.x + visualStickOffsetX, 
                           joystickStickRestPosition.y, 
                           joystickStickRestPosition.z + visualStickOffsetZ);
    } else if (isDraggingKnob) {
        const deltaMouseX = event.clientX - initialMouseX; // initialMouseX is specific to knob
        draggedObject.rotation.y = initialKnobRotationY + deltaMouseX * 0.02; // draggedObject is knob_body

        const knobGroupName = draggedObject.parent.name;
        if (knobGroupName === "tempoKnob3D") {
            let newTempo = initialKnobValue - Math.round(deltaMouseX * 0.25); // Reversed direction
            AppState.setTempo(Math.max(20, Math.min(newTempo, 300)));
        } else if (knobGroupName === "beatMultiplierKnob3D" && DOM.beatMultiplierSelect) {
            const optionsCount = DOM.beatMultiplierSelect.options.length;
            if (optionsCount > 0) {
                let newIndex = initialKnobValue + Math.round(deltaMouseX * 0.03); // Sensitivity
                newIndex = Math.max(0, Math.min(newIndex, optionsCount - 1));
                if (DOM.beatMultiplierSelect.selectedIndex !== newIndex) {
                    DOM.beatMultiplierSelect.selectedIndex = newIndex; // This will trigger its own 'change' event if script.js is set up for it
                    DOM.beatMultiplierSelect.dispatchEvent(new Event('change')); // Explicitly dispatch
                }
            }
        } else if (knobGroupName === "presetSlotKnob3D" && DOM.presetSlotSelect) {
            const optionsCount = DOM.presetSlotSelect.options.length;
            if (optionsCount > 0) {
                let newIndex = initialKnobValue + Math.round(deltaMouseX * 0.03); // Sensitivity
                newIndex = Math.max(0, Math.min(newIndex, optionsCount - 1));
                if (DOM.presetSlotSelect.selectedIndex !== newIndex) {
                    DOM.presetSlotSelect.selectedIndex = newIndex;
                    // DOM.presetSlotSelect.dispatchEvent(new Event('change')); // Typically not needed for preset slot selection via knob
                }
            }
        }
    } else if (isDraggingSlider && draggedObject.name === "volumeSlider3D_handle") {
        const deltaMouseX = event.clientX - initialMouseX;
        let newVolume = initialKnobValue + deltaMouseX * SLIDER_SENSITIVITY; // initialKnobValue holds initial volume
        newVolume = Math.max(0, Math.min(1, parseFloat(newVolume.toFixed(2))));
        AppState.setVolume(newVolume);
        VolumeController.updateVolumeDisplay(); // Sync 2D slider and its display

        // Visual update of handle position is now done by ControlsManager.updateDynamicControlLabels
        // which is called below. This ensures consistency.
    }
    else if (isDraggingLightJoystick) {
        const stick = draggedObject;
        const deltaX = event.clientX - lightJoystickLastFrameScreenPos.x;
        const deltaY = event.clientY - lightJoystickLastFrameScreenPos.y;

        // Control light rotation and elevation
        SceneManager.rotateDirectionalLightHorizontal(-deltaX * LIGHT_JOYSTICK_SENSITIVITY_H);
        SceneManager.adjustDirectionalLightHeight(deltaY * LIGHT_JOYSTICK_SENSITIVITY_V);

        // Control light intensity with total vertical displacement from anchor
        const totalDeltaYFromAnchorIntensity = event.clientY - lightJoystickDragAnchorScreenPos.y;
        let intensityChange = -totalDeltaYFromAnchorIntensity * LIGHT_JOYSTICK_SENSITIVITY_INTENSITY;
        SceneManager.setDirectionalLightIntensity(initialLightIntensity + intensityChange);

        // Update last screen position for the next frame's delta calculation
        lightJoystickLastFrameScreenPos.set(event.clientX, event.clientY);

        // Update light joystick stick's visual position based on total displacement from drag start
        const totalDeltaXFromAnchorVisual = event.clientX - lightJoystickDragAnchorScreenPos.x;
        const totalDeltaYFromAnchorVisual = event.clientY - lightJoystickDragAnchorScreenPos.y;

        let visualStickOffsetX = totalDeltaXFromAnchorVisual * 0.01;
        let visualStickOffsetZ = -totalDeltaYFromAnchorVisual * 0.01;

        const displacement = Math.sqrt(visualStickOffsetX * visualStickOffsetX + visualStickOffsetZ * visualStickOffsetZ);
        if (displacement > LIGHT_JOYSTICK_MAX_DISPLACEMENT) {
            const scale = LIGHT_JOYSTICK_MAX_DISPLACEMENT / displacement;
            visualStickOffsetX *= scale;
            visualStickOffsetZ *= scale;
        }
        stick.position.set(lightJoystickStickRestPosition.x + visualStickOffsetX, lightJoystickStickRestPosition.y, lightJoystickStickRestPosition.z + visualStickOffsetZ);
    }
    ControlsManager.updateDynamicControlLabels(); // Update labels
}
function onPointerUp(event) {
    if (isDraggingJoystick && draggedObject) {
        // Animate stick back to center
        // For simplicity, just snap back. A tweening library would be smoother.
        draggedObject.position.copy(joystickStickRestPosition);
        isDraggingJoystick = false;
        draggedObject = null;
        event.preventDefault();
    } else if (isDraggingKnob && draggedObject) {
        isDraggingKnob = false;
        draggedObject = null;
        event.preventDefault();
    } else if (isDraggingSlider && draggedObject) {
        isDraggingSlider = false;
        draggedObject = null;
        event.preventDefault();
    } else if (isDraggingLightJoystick && draggedObject) {
        draggedObject.position.copy(lightJoystickStickRestPosition);
        isDraggingLightJoystick = false;
        draggedObject = null;
        initialLightIntensity = 1.0; // Reset
        event.preventDefault();
    }
}

function onSceneClick(event) {
    // If a drag operation just finished, draggedObject would be null here.
    // This check is more about preventing clicks while a drag is *active*, which onPointerDown already handles.
    if (!localRenderer || !localCamera || !localScene || !localHitboxesGroup || !localMeasuresGroup) return;

    // Raycast against hitboxes for controls and direct meshes for measures
    const intersection = getClickedObject(event, [...localHitboxesGroup.children, ...localMeasuresGroup.children]);
    if (!intersection) {
        return;
    }

    const clickedMesh = intersection.object;
    // Monolithic doesn't use userData.visibleButton, it uses clickedMesh directly
    const targetObject = clickedMesh.userData.visibleButton || clickedMesh;
    const name = targetObject.name;

    let isButtonInteraction = false; // From monolithic

    if (name && !name.includes("Knob3D") && !name.includes("Slider3D") && !name.includes("Joystick")) { // Knobs, Sliders, Joysticks handled by pointer events
        // console.log(`3DInteraction: Processing click for ${name}`); // DEBUG

        const animateClick = (obj) => {
            const originalY = obj.position.y; // obj is the visible mesh (targetObject)
            obj.position.y -= 0.05; 
            isButtonInteraction = true; // Mark as button interaction
            setTimeout(() => { if(obj) obj.position.y = originalY; }, 100);
        };

        // Click handling logic - use targetObject for animation
        if (name === "startStopButton3D") { DOM.startStopBtn?.click(); animateClick(targetObject); }
        else if (name === "tapTempoButton3D") {
            DOM.tapTempoBtn?.click(); // Triggers AppState update via 2D button's listener
            animateClick(clickedMesh);
            ControlsManager.updateDynamicControlLabels(); // Update 3D labels
        }
        else if (name === "resetButton3D") { DOM.resetButton?.click(); animateClick(clickedMesh); }
        else if (name === "decreaseTempoButton3D") {
            DOM.decreaseTempoBtn?.click(); animateClick(clickedMesh);
            ControlsManager.updateDynamicControlLabels(); 
        } else if (name === "increaseTempoButton3D") {
            DOM.increaseTempoBtn?.click(); animateClick(clickedMesh);
            ControlsManager.updateDynamicControlLabels();
        } else if (name === "decreaseVolumeButton3D") {
            if (DOM.volumeSlider) { DOM.volumeSlider.stepDown(); DOM.volumeSlider.dispatchEvent(new Event('input')); } // Simulates 2D slider step
            animateClick(clickedMesh);
            ControlsManager.updateDynamicControlLabels(); // Updates 3D slider handle and text
        } else if (name === "increaseVolumeButton3D") {
            if (DOM.volumeSlider) { DOM.volumeSlider.stepUp(); DOM.volumeSlider.dispatchEvent(new Event('input')); } // Simulates 2D slider step
            animateClick(clickedMesh);
            ControlsManager.updateDynamicControlLabels(); // Updates 3D slider handle and text
        } else if (name === "decreaseBeatsButton3D") {
            DOM.decreaseMeasureLengthBtn?.click(); animateClick(clickedMesh);
            setTimeout(() => { // Allow AppState to update
                ControlsManager.updateDynamicControlLabels();
                MeasuresManager.createMeasuresAndBeats(localMeasuresGroup); // Rebuild measures
            }, 50);
        } else if (name === "increaseBeatsButton3D") {
            DOM.increaseMeasureLengthBtn?.click(); animateClick(clickedMesh);
            setTimeout(() => {
                ControlsManager.updateDynamicControlLabels();
                MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
            }, 50);
        } else if (name === "decreaseBarsButton3D") {
            DOM.decreaseBarLengthBtn?.click(); animateClick(clickedMesh);
            setTimeout(() => {
                ControlsManager.updateDynamicControlLabels();
                MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
            }, 50);
        } else if (name === "increaseBarsButton3D") {
            DOM.increaseBarLengthBtn?.click(); animateClick(clickedMesh);
            setTimeout(() => {
                ControlsManager.updateDynamicControlLabels();
                MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
            }, 50);
        } else if (name === "prevSubdivisionButton3D") {
            animateClick(clickedMesh);
            if (DOM.beatMultiplierSelect && DOM.beatMultiplierSelect.selectedIndex > 0) {
                DOM.beatMultiplierSelect.selectedIndex--;
                DOM.beatMultiplierSelect.dispatchEvent(new Event('change'));
                setTimeout(() => {
                    ControlsManager.updateDynamicControlLabels();
                    MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
                }, 50);
            }
        } else if (name === "nextSubdivisionButton3D") {
            animateClick(clickedMesh);
            if (DOM.beatMultiplierSelect && DOM.beatMultiplierSelect.selectedIndex < DOM.beatMultiplierSelect.options.length - 1) {
                DOM.beatMultiplierSelect.selectedIndex++;
                DOM.beatMultiplierSelect.dispatchEvent(new Event('change'));
                setTimeout(() => {
                    ControlsManager.updateDynamicControlLabels();
                    MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
                }, 50);
            }
        } else if (name === "prevPresetSlotButton3D") {
            animateClick(clickedMesh);
            if (DOM.presetSlotSelect && DOM.presetSlotSelect.selectedIndex > 0) {
                DOM.presetSlotSelect.selectedIndex--;
                // DOM.presetSlotSelect.dispatchEvent(new Event('change')); // Monolithic doesn't dispatch change here
                ControlsManager.updateDynamicControlLabels();
            }
        } else if (name === "nextPresetSlotButton3D") {
            animateClick(clickedMesh);
            if (DOM.presetSlotSelect && DOM.presetSlotSelect.selectedIndex < DOM.presetSlotSelect.options.length - 1) {
                DOM.presetSlotSelect.selectedIndex++;
                // DOM.presetSlotSelect.dispatchEvent(new Event('change'));
                ControlsManager.updateDynamicControlLabels();
            }
        } else if (name === "savePresetButton3D") {
            DOM.savePresetButton?.click(); animateClick(clickedMesh);
            ControlsManager.updateDynamicControlLabels(); // Update preset name display
        } else if (name === "loadPresetButton3D") {
            animateClick(clickedMesh);
            DOM.loadPresetButton?.click(); // This will trigger UI refresh including 3D in script.js
            // The monolithic file has a setTimeout to update labels and rebuild measures.
            // This should ideally be handled by the main refreshUIFromState in script.js after preset load.
            // For strict adherence, we can replicate, but it's better if script.js handles the full refresh.
            // Assuming script.js handles the full refresh including ThemeController.update3DScenePostStateChange()
        } else if (name.startsWith("measureBox_")) {
            const barIndex = parseInt(name.split('_')[1], 10);
            handleMeasureBoxClick(clickedMesh, barIndex); // Pass clickedMesh
            isButtonInteraction = true; // As per monolithic
        } else if (name === "prevMeasuresPageButton3D") {
            animateClick(clickedMesh);
            MeasuresManager.decrementPage();
            MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
            // Monolithic doesn't call camera adjustment here
        } else if (name === "nextMeasuresPageButton3D") {
            animateClick(clickedMesh);
            MeasuresManager.incrementPage();
            MeasuresManager.createMeasuresAndBeats(localMeasuresGroup);
            // Monolithic doesn't call camera adjustment here
        }
        // Theme switching from monolithic
        else if (name === "switchToDarkTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('dark'); }
        else if (name === "switchToLightTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('default'); } // Monolithic uses 'light', map to 'default'
        // Monolithic has switchToClassicTheme3D, but 'classic' is not in themeController's themes. Assuming 'default'.
        // else if (name === "switchToClassicTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('default'); }
        else if (name === "switchToSynthwaveTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('synthwave'); }
        else if (name === "switchToGundamTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('gundam'); }
        else if (name === "switchToHelloKittyTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('helloKitty'); }
        else if (name === "switchToBeachTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('beach'); }
        else if (name === "switchToIceCreamTheme3D") { animateClick(clickedMesh); ThemeController.applyTheme('iceCream'); }

        // Camera Controls
        else if (name === "cameraZoomInButton3D") { CameraManager.zoomCamera(-1); animateClick(clickedMesh); }
        else if (name === "cameraZoomOutButton3D") { CameraManager.zoomCamera(1); animateClick(clickedMesh); }
        else if (name === "cameraResetButton3D") { CameraManager.resetCameraView(); animateClick(clickedMesh); }
        // else if (name === "cameraOrbitLeftButton3D") { CameraManager.orbitCameraHorizontal(CAMERA_ORBIT_ANGLE_STEP); animateClick(clickedMesh); } // Removed
        // else if (name === "cameraOrbitRightButton3D") { CameraManager.orbitCameraHorizontal(-CAMERA_ORBIT_ANGLE_STEP); animateClick(clickedMesh); } // Removed        
        // else if (name === "cameraOrbitVerticalUpButton3D") { CameraManager.orbitCameraVertical(-CAMERA_ORBIT_ANGLE_STEP); animateClick(clickedMesh); } // Removed
        // else if (name === "cameraOrbitVerticalDownButton3D") { CameraManager.orbitCameraVertical(CAMERA_ORBIT_ANGLE_STEP); animateClick(clickedMesh); } // Removed

        // Light Controls
        else if (name === "lightIntensityUpButton3D") {
            const light = SceneManager.getDirectionalLight();
            if (light) SceneManager.setDirectionalLightIntensity(light.intensity + LIGHT_INTENSITY_STEP);
            ControlsManager.updateDynamicControlLabels(); // Update intensity display
            animateClick(clickedMesh);
        }
        else if (name === "lightIntensityDownButton3D") {
            const light = SceneManager.getDirectionalLight();
            if (light) SceneManager.setDirectionalLightIntensity(light.intensity - LIGHT_INTENSITY_STEP);
            ControlsManager.updateDynamicControlLabels();
            animateClick(clickedMesh);
        }
        else if (name === "lightResetButton3D") { SceneManager.resetDirectionalLight(); ControlsManager.updateDynamicControlLabels(); animateClick(clickedMesh); }
        // Light joystick handles rotation, elevation, and fine-tuned intensity via pointer events


        if (name.startsWith("switchTo") && name.endsWith("Theme3D")) {
            isButtonInteraction = true;
        }
        if (name.startsWith("camera") || name.startsWith("light")) { // Ensure these are also marked
            isButtonInteraction = true;
        }
    }
}

function handleMeasureBoxClick(clickedMeasureBoxObject, barIndex) {
    // Logic from monolithic handleMeasureBoxClick
    let actualMeasureBox = clickedMeasureBoxObject;
    if (clickedMeasureBoxObject.parent && clickedMeasureBoxObject.parent.name.startsWith("measureBox_")) {
        actualMeasureBox = clickedMeasureBoxObject.parent; // If wireframe was clicked
    }

    if (AppState.getSelectedBarIndex() !== barIndex) {
        AppState.setSelectedBarIndex(barIndex);

        const oldSelectedBox = MeasuresManager.getSelectedMeasureBoxMesh();
        const oldWireframe = MeasuresManager.getSelectedMeasureWireframeMesh();

        if (oldSelectedBox && oldWireframe) {
            oldWireframe.parent?.remove(oldWireframe);
            if (oldWireframe.geometry) oldWireframe.geometry.dispose();
            if (oldWireframe.material) oldWireframe.material.dispose();
            MeasuresManager.setSelectedMeasureWireframeMesh(null);

            // Reset material if not the current playhead bar
            const oldSelectedGlobalIndex = parseInt(oldSelectedBox.name.split('_')[1], 10);
            if (oldSelectedGlobalIndex !== AppState.getCurrentBar()) { // Check against AppState.getCurrentBar() for playhead
                oldSelectedBox.material.color.set(DEFAULT_MEASURE_COLOR);
                oldSelectedBox.material.opacity = DEFAULT_MEASURE_OPACITY;
            }
        }
        MeasuresManager.setSelectedMeasureBoxMesh(null);

        ControlsManager.updateDynamicControlLabels(); // Update beats display text

        if (actualMeasureBox && actualMeasureBox.name === `measureBox_${barIndex}`) {
            actualMeasureBox.material.color.set(SELECTED_MEASURE_COLOR);
            actualMeasureBox.material.opacity = SELECTED_MEASURE_OPACITY;

            const wireframeGeometry = new THREE.WireframeGeometry(actualMeasureBox.geometry);
            const wireframeMaterial = new THREE.LineBasicMaterial({ color: SELECTED_MEASURE_COLOR, linewidth: 2 });
            const newWireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
            actualMeasureBox.add(newWireframe);
            MeasuresManager.setSelectedMeasureWireframeMesh(newWireframe);
            MeasuresManager.setSelectedMeasureBoxMesh(actualMeasureBox);
        }
    }
}


export function initializeEventHandlers(renderer, camera, scene, hitboxesGroup, measuresGroup, font, draggablePartsGroup) {
    localRenderer = renderer;
    localCamera = camera;
    localScene = scene;
    localHitboxesGroup = hitboxesGroup;
    localMeasuresGroup = measuresGroup;
    localFont = font;
    localDraggablePartsGroup = draggablePartsGroup; // Store for potential direct access if needed
    
    // Add pointer events for dragging joystick and knobs
    renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
    window.addEventListener('pointermove', onPointerMove, false); // Listen on window for moves outside canvas
    window.addEventListener('pointerup', onPointerUp, false);   // Listen on window for mouse up anywhere
    renderer.domElement.addEventListener('click', onSceneClick, false);
}

export function removeEventHandlers() {
    if (localRenderer) {
        localRenderer.domElement.removeEventListener('pointerdown', onPointerDown, false);
        localRenderer.domElement.removeEventListener('click', onSceneClick);
    }
    window.removeEventListener('pointermove', onPointerMove, false);
    window.removeEventListener('pointerup', onPointerUp, false);
    localRenderer = null; localCamera = null; localScene = null;
    localHitboxesGroup = null; localMeasuresGroup = null; localFont = null;
    localDraggablePartsGroup = null;
}