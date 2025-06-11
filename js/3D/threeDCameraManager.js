/**
 * threeDCameraManager.js
 * Manages camera adjustments and potentially other camera-related logic.
 * Relies on SceneManager to get the camera instance and its initial lookAt point.
 */
import * as THREE from 'three';
import * as SceneManager from './threeDSceneManager.js';
import AppState from '../appState.js'; // Import AppState

const CAMERA_ZOOM_SPEED = 0.1; // Percentage of current distance to target
const CAMERA_ORBIT_ANGLE_STEP = THREE.MathUtils.degToRad(5);
// const CAMERA_PAN_SPEED = 0.5; // World units, for vertical pan if implemented differently

// The monolithic 3dTheme.js sets up the camera initially in SceneManager
// and handles window resize for aspect ratio.
// It does not have a dynamic "fit to content" logic like the original context file.
// Therefore, this manager will be minimal.

function getCamera() {
    return SceneManager.getCamera();
}

function getLookAtPoint(camera) {
    // camera.userData.lookAtPoint is initialized in SceneManager
    return camera.userData.lookAtPoint ? camera.userData.lookAtPoint.clone() : new THREE.Vector3(0, -1.5, 0);
}

export function zoomCamera(direction) { // direction: 1 for zoom in, -1 for zoom out
    const camera = getCamera();
    if (!camera) return;

    const lookAtPoint = getLookAtPoint(camera);
    const distanceToTarget = camera.position.distanceTo(lookAtPoint);
    const zoomAmount = distanceToTarget * CAMERA_ZOOM_SPEED * direction;

    // Prevent zooming too close or too far
    if (distanceToTarget - zoomAmount < 1 && direction > 0) return; // Min distance
    if (distanceToTarget - zoomAmount > 100 && direction < 0) return; // Max distance

    const directionVector = new THREE.Vector3();
    // Vector from camera towards lookAtPoint
    directionVector.subVectors(lookAtPoint, camera.position).normalize();

    // Move camera along this vector (negative zoomAmount to move closer for direction=1)
    camera.position.addScaledVector(directionVector, -zoomAmount);
}

export function orbitCameraHorizontal(angle) {
    const camera = getCamera();
    if (!camera) return;

    const lookAtPoint = getLookAtPoint(camera);
    const offset = new THREE.Vector3().subVectors(camera.position, lookAtPoint);

    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    offset.applyQuaternion(quaternion);

    camera.position.copy(lookAtPoint).add(offset);
    camera.lookAt(lookAtPoint);
}

export function orbitCameraVertical(angle) {
    const camera = getCamera();
    if (!camera) return;

    const lookAtPoint = getLookAtPoint(camera);
    const offset = new THREE.Vector3().subVectors(camera.position, lookAtPoint);

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).normalize(); // Camera's local X (right)

    const quaternion = new THREE.Quaternion().setFromAxisAngle(right, angle);
    offset.applyQuaternion(quaternion);

    // Prevent flipping over by checking angle with world up vector
    const newCameraDirection = offset.clone().normalize().negate(); // Points from lookAt to new camera pos
    const worldUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(newCameraDirection.dot(worldUp)) > 0.99) { // If camera is looking almost straight up or down
        return; // Limit reached
    }

    camera.position.copy(lookAtPoint).add(offset);
    camera.lookAt(lookAtPoint);
}

export function resetCameraView() {
    const camera = getCamera();
    if (!camera) return;
    // Consistent initial/reset view
    camera.position.set(-0.2, 14, 1); // Default position (matches resetCameraView)
    const lookAtPoint = new THREE.Vector3(0, -1.5, 0); // Default lookAt from SceneManager

    camera.lookAt(lookAtPoint);
    camera.userData.lookAtPoint = lookAtPoint.clone(); // Reset stored lookAtPoint
    // Update AppState with the reset camera position and lookAt
    AppState.setCameraPosition3D(camera.position);
    AppState.setCameraLookAtPoint3D(lookAtPoint);
}

export function adjustCameraToFitSceneContent(camera, measureBoxes, controlsGroup) {
    // This function is not used by the monolithic logic.
    // console.log("CameraManager: adjustCameraToFitSceneContent called, but not implemented as per monolithic logic.");
}