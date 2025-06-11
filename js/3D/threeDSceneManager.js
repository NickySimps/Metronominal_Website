/**
 * threeDSceneManager.js
 * Manages the core Three.js scene, camera, renderer, lights, and font loading.
 */
import * as THREE from 'three';
import AppState from '../appState.js'; // Import AppState
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'; // Correct path
import { DefaultThemeColors3D, BUTTON_Y_POSITION } from './threeDConstants.js';

let scene, camera, renderer, animationFrameId;
let threeJsCanvas = null;
let mainContainerRef = null; // 2D UI container
let loadedFont = null;

let directionalLight; // Make directional light accessible

// Initial/Default light parameters
const INITIAL_LIGHT_POSITION = new THREE.Vector3(40, 40, -50);
const INITIAL_LIGHT_INTENSITY = 0.9;

// Store orbital parameters for the light
let lightOrbitRadius = Math.sqrt(INITIAL_LIGHT_POSITION.x**2 + INITIAL_LIGHT_POSITION.z**2);
let lightOrbitAngle = Math.atan2(INITIAL_LIGHT_POSITION.z, INITIAL_LIGHT_POSITION.x);
let lightYPosition = INITIAL_LIGHT_POSITION.y;

let controlsGroup = null;
let measuresGroup = null; 
let interactionGroup = null; 

let onFontLoadedCreateControlsCallback = null;
let onFontLoadedCreateMeasuresCallback = null;

function onThreeJSWindowResize() {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

function animateScene() {
    animationFrameId = requestAnimationFrame(animateScene);
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

export function initializeScene(_mainContainerRef, createControlsCb, createMeasuresCb) {
    if (renderer) return; // Already initialized
    if (!THREE) {
        console.error("THREE.js is not loaded. Cannot initialize 3D scene.");
        return;
    }
    mainContainerRef = _mainContainerRef;
    onFontLoadedCreateControlsCallback = createControlsCb;
    onFontLoadedCreateMeasuresCallback = createMeasuresCb;

    scene = new THREE.Scene();
    scene.background = DefaultThemeColors3D.alt1;

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 1000);

    // Attempt to restore camera position and lookAt from AppState
    const storedCamPos = AppState.getCameraPosition3D();
    const storedLookAt = AppState.getCameraLookAtPoint3D();

    let initialLookAt;

    if (storedCamPos) {
        camera.position.set(storedCamPos.x, storedCamPos.y, storedCamPos.z);
    } else {
        camera.position.set(7, 7, 10); // Default position (matches resetCameraView)
    }

    if (storedLookAt) {
        initialLookAt = new THREE.Vector3(storedLookAt.x, storedLookAt.y, storedLookAt.z);
    } else {
        initialLookAt = new THREE.Vector3(0, -1.5, 0); // Default lookAt
    }
    camera.lookAt(initialLookAt);
    camera.userData.lookAtPoint = initialLookAt.clone(); // Initialize for CameraManager

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);
    directionalLight = new THREE.DirectionalLight(0xffffff, INITIAL_LIGHT_INTENSITY); // Assign to module-scoped variable
    directionalLight.name = "mainDirectionalLight"; // Give it a name
    directionalLight.position.copy(INITIAL_LIGHT_POSITION);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    threeJsCanvas = renderer.domElement;
    threeJsCanvas.id = 'threejs-canvas';
    document.body.appendChild(threeJsCanvas);

    const floorGeometry = new THREE.PlaneGeometry(30, 25); // Wider and slightly deeper floor
    const floorMaterial = new THREE.MeshStandardMaterial({ color: DefaultThemeColors3D.background, side: THREE.DoubleSide }); // Changed floor color from monolithic
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = BUTTON_Y_POSITION;
    floor.receiveShadow = true;
    scene.add(floor);

    // Groups are created here and passed to callbacks
    controlsGroup = new THREE.Group(); 
    scene.add(controlsGroup);
    measuresGroup = new THREE.Group(); 
    scene.add(measuresGroup);
    interactionGroup = new THREE.Group(); 
    interactionGroup.name = "InteractionHitboxGroup"; // For easier debugging
    scene.add(interactionGroup);

    const fontLoader = new FontLoader();
    fontLoader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json',
        (font) => {
            loadedFont = font;
            console.log("3dTheme: Font loaded successfully.");
            if (onFontLoadedCreateControlsCallback) onFontLoadedCreateControlsCallback(loadedFont, controlsGroup, interactionGroup);
            if (onFontLoadedCreateMeasuresCallback) onFontLoadedCreateMeasuresCallback(measuresGroup); // Pass measuresGroup
        },
        undefined,
        (error) => {
            console.error('3dTheme: Font loading failed:', error);
            // Proceed without font, callbacks will handle null font
            if (onFontLoadedCreateControlsCallback) onFontLoadedCreateControlsCallback(null, controlsGroup, interactionGroup); // Proceed without font
            if (onFontLoadedCreateMeasuresCallback) onFontLoadedCreateMeasuresCallback(measuresGroup); // Pass measuresGroup
        }
    );

    animateScene();
    window.addEventListener('resize', onThreeJSWindowResize, false);
    if (mainContainerRef) mainContainerRef.style.display = 'none';
    console.log("3dTheme: Scene initialization sequence started.");
}

export function disposeScene() {
    if (!renderer) return;

    cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', onThreeJSWindowResize);

    // The main 3dTheme.js dispose will handle the actual scene.clear() and renderer.dispose()
    // This function is for cleaning up SceneManager's specific resources.
    // The mainContainerRef.style.display is handled by the main ThemeManager.


    // Nullify internal references to allow for re-initialization
    renderer = null;
    scene = null;
    camera = null;
    loadedFont = null;
    controlsGroup = null;
    measuresGroup = null;
    interactionGroup = null;
    threeJsCanvas = null; 
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getLoadedFont() { return loadedFont; }
export function getControlsGroup() { return controlsGroup; }
export function getMeasuresGroup() { return measuresGroup; }
export function getInteractionGroup() { return interactionGroup; }
export function isSceneActive() { return !!renderer; } // Scene is active if renderer exists

export function getDirectionalLight() { return directionalLight; }

export function setDirectionalLightIntensity(intensity) {
    if (directionalLight) {
        directionalLight.intensity = Math.max(0, Math.min(5, intensity)); // Clamp intensity (0 to 5)
    }
}

export function rotateDirectionalLightHorizontal(angleDelta) {
    if (directionalLight) {
        lightOrbitAngle += angleDelta;
        directionalLight.position.x = lightOrbitRadius * Math.cos(lightOrbitAngle);
        directionalLight.position.z = lightOrbitRadius * Math.sin(lightOrbitAngle);
        directionalLight.position.y = lightYPosition;
        directionalLight.lookAt(0, 0, 0); // Assuming light always points to scene origin
    }
}

export function adjustDirectionalLightHeight(yDelta) {
    if (directionalLight) {
        lightYPosition = Math.max(5, Math.min(100, lightYPosition + yDelta)); // Clamp Y position
        directionalLight.position.y = lightYPosition;
    }
}

export function resetDirectionalLight() {
    if (directionalLight) {
        directionalLight.position.copy(INITIAL_LIGHT_POSITION);
        directionalLight.intensity = INITIAL_LIGHT_INTENSITY;
        // Recalculate orbital parameters based on reset position
        lightOrbitRadius = Math.sqrt(INITIAL_LIGHT_POSITION.x**2 + INITIAL_LIGHT_POSITION.z**2);
        lightOrbitAngle = Math.atan2(INITIAL_LIGHT_POSITION.z, INITIAL_LIGHT_POSITION.x);
        lightYPosition = INITIAL_LIGHT_POSITION.y;
        directionalLight.lookAt(0, 0, 0);
    }
}