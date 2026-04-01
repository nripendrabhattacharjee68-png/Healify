import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  JOINTS,
  clamp,
  getCompensatedRomAngle,
  getFormAccuracy,
  getHipAnkleDistance,
  getTrunkLeanDegrees,
  getVisibilityScore,
  normalizeCoordinates3D,
} from '../lib/math3d';

const MIN_VISIBILITY = 0.45;
const NEON_TEAL = '#00FFD5';
const ALERT_RED = '#FF0000';
const MEDIAPIPE_POSE_SCRIPT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js';
const MEDIAPIPE_POSE_TAG = 'data-mediapipe-pose';

let poseScriptPromise = null;

function ensureMediaPipePoseLoaded() {
  if (globalThis.Pose && globalThis.POSE_CONNECTIONS) {
    return Promise.resolve();
  }

  if (poseScriptPromise) {
    return poseScriptPromise;
  }

  poseScriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('MediaPipe Pose requires a browser document context.'));
      return;
    }

    const completeLoad = () => {
      if (globalThis.Pose && globalThis.POSE_CONNECTIONS) {
        resolve();
        return;
      }
      reject(new Error('MediaPipe Pose script loaded, but Pose globals are unavailable.'));
    };

    const failLoad = () => {
      reject(new Error(`Failed to load MediaPipe Pose script from ${MEDIAPIPE_POSE_SCRIPT}`));
    };

    const existingScript = document.querySelector(`script[${MEDIAPIPE_POSE_TAG}="1"]`);
    if (existingScript) {
      if (globalThis.Pose && globalThis.POSE_CONNECTIONS) {
        resolve();
        return;
      }
      existingScript.addEventListener('load', completeLoad, { once: true });
      existingScript.addEventListener('error', failLoad, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = MEDIAPIPE_POSE_SCRIPT;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute(MEDIAPIPE_POSE_TAG, '1');
    script.addEventListener('load', completeLoad, { once: true });
    script.addEventListener('error', failLoad, { once: true });
    document.head.appendChild(script);
  });

  return poseScriptPromise;
}

function drawSegment(ctx, from, to, color) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.stroke();
}

function drawJoint(ctx, point, color) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();
}

function drawNeonSkeleton(ctx, landmarks, color) {
  if (!ctx || !landmarks) {
    return;
  }

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const poseConnections = globalThis.POSE_CONNECTIONS ?? [];

  for (const connection of poseConnections) {
    const start = landmarks[connection[0]];
    const end = landmarks[connection[1]];

    if (!start || !end) {
      continue;
    }

    if ((start.visibility ?? 1) < MIN_VISIBILITY || (end.visibility ?? 1) < MIN_VISIBILITY) {
      continue;
    }

    drawSegment(
      ctx,
      { x: start.x * ctx.canvas.width, y: start.y * ctx.canvas.height },
      { x: end.x * ctx.canvas.width, y: end.y * ctx.canvas.height },
      color,
    );
  }

  for (const landmark of landmarks) {
    if ((landmark.visibility ?? 1) < MIN_VISIBILITY) {
      continue;
    }

    drawJoint(
      ctx,
      { x: landmark.x * ctx.canvas.width, y: landmark.y * ctx.canvas.height },
      color,
    );
  }

  ctx.shadowBlur = 0;
}

export function usePose({ videoRef, canvasRef, targetAngle = 45, onRep, onCheat, onMetrics }) {
  const [isReady, setIsReady] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [error, setError] = useState('');
  const [fps, setFps] = useState(0);
  const [lastMetrics, setLastMetrics] = useState(null);

  const poseRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const isActiveRef = useRef(false);
  const isInferencePendingRef = useRef(false);
  const lastTimestampRef = useRef(0);

  const repStateRef = useRef({
    inLift: false,
    startedAt: 0,
    peakRom: 0,
    peakAccuracy: 0,
    lastRepAt: 0,
    trunkLeanActive: false,
    hipLiftActive: false,
    baselineHipY: null,
  });

  const initializeModel = useCallback(async () => {
    if (poseRef.current) {
      return poseRef.current;
    }

    await ensureMediaPipePoseLoaded();

    await tf.setBackend('webgl');
    await tf.ready();

    const PoseCtor = globalThis.Pose;
    if (!PoseCtor) {
      throw new Error('MediaPipe Pose global not found. Ensure @mediapipe/pose is loaded.');
    }

    const pose = new PoseCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
    });

    pose.setOptions({
      modelComplexity: 2,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

    poseRef.current = pose;
    setIsReady(true);
    return pose;
  }, []);

  const handleResults = useCallback(
    (results) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const poseLandmarks = results.poseLandmarks;

      if (!canvas || !video || !poseLandmarks) {
        return;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const normalized = normalizeCoordinates3D(poseLandmarks);
      if (!normalized.length) {
        return;
      }

      const hipAnkleDistance = getHipAnkleDistance(normalized);
      const { rawHipAngle, compensatedHipAngle, romAngle, depthCompensation } =
        getCompensatedRomAngle(normalized);
      const trunkLeanDegrees = getTrunkLeanDegrees(normalized);
      const visibilityScore = getVisibilityScore(normalized, [
        JOINTS.LEFT_SHOULDER,
        JOINTS.RIGHT_SHOULDER,
        JOINTS.LEFT_HIP,
        JOINTS.RIGHT_HIP,
        JOINTS.RIGHT_KNEE,
        JOINTS.RIGHT_ANKLE,
      ]);

      const formAccuracy = getFormAccuracy({
        romAngle,
        targetAngle,
        trunkLean: trunkLeanDegrees,
        visibilityScore,
        depthCompensation,
      });

      const trunkLeanState = trunkLeanDegrees > 15 && romAngle > targetAngle * 0.45;
      const rightHip = poseLandmarks[JOINTS.RIGHT_HIP];
      const repState = repStateRef.current;

      if (rightHip && romAngle < targetAngle * 0.35) {
        repState.baselineHipY =
          repState.baselineHipY == null
            ? rightHip.y
            : repState.baselineHipY * 0.8 + rightHip.y * 0.2;
      }

      const hipLiftDelta =
        rightHip && repState.baselineHipY != null ? repState.baselineHipY - rightHip.y : 0;
      const hipLiftState = romAngle > targetAngle * 0.45 && hipLiftDelta > 0.04;

      const cheatState = trunkLeanState || hipLiftState;
      const color = cheatState ? ALERT_RED : NEON_TEAL;

      const ctx = canvas.getContext('2d');
      drawNeonSkeleton(ctx, poseLandmarks, color);

      const now = performance.now();
      if (lastTimestampRef.current > 0) {
        const instantFps = 1000 / Math.max(now - lastTimestampRef.current, 1);
        setFps((prev) => (prev ? prev * 0.85 + instantFps * 0.15 : instantFps));
      }
      lastTimestampRef.current = now;

      const upThreshold = targetAngle * 0.9;
      const downThreshold = targetAngle * 0.35;

      if (!repState.inLift && romAngle >= upThreshold) {
        repState.inLift = true;
        repState.startedAt = now;
        repState.peakRom = romAngle;
        repState.peakAccuracy = formAccuracy;
      }

      if (repState.inLift) {
        repState.peakRom = Math.max(repState.peakRom, romAngle);
        repState.peakAccuracy = Math.max(repState.peakAccuracy, formAccuracy);
      }

      if (repState.inLift && romAngle <= downThreshold && now - repState.lastRepAt > 350) {
        const durationMs = now - repState.startedAt;
        const repFormAccuracy = clamp(repState.peakAccuracy, 0, 100);

        onRep?.({
          peakRom: repState.peakRom,
          formAccuracy: repFormAccuracy,
          durationMs,
          slow: durationMs > 1800,
          tooFast: durationMs < 650,
        });

        repState.inLift = false;
        repState.lastRepAt = now;
        repState.startedAt = 0;
        repState.peakRom = 0;
        repState.peakAccuracy = 0;
      }

      if (trunkLeanState && !repState.trunkLeanActive) {
        onCheat?.({
          type: 'TRUNK_LEAN',
          tiltDegrees: trunkLeanDegrees,
          threshold: 15,
        });
      }
      repState.trunkLeanActive = trunkLeanState;

      if (hipLiftState && !repState.hipLiftActive) {
        onCheat?.({
          type: 'HIP_LIFT',
          hipLiftDelta,
          threshold: 0.04,
        });
      }
      repState.hipLiftActive = hipLiftState;

      const payload = {
        romAngle,
        rawHipAngle,
        compensatedHipAngle,
        depthCompensation,
        hipAnkleDistance,
        trunkLeanDegrees,
        trunkLeanState,
        hipLiftState,
        hipLiftDelta,
        formAccuracy,
        color,
      };

      setLastMetrics(payload);
      onMetrics?.(payload);
    },
    [canvasRef, onCheat, onMetrics, onRep, targetAngle, videoRef],
  );

  const stopCamera = useCallback(() => {
    isActiveRef.current = false;
    setIsCameraActive(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, [videoRef]);

  const runLoop = useCallback(async () => {
    const pose = poseRef.current;
    const video = videoRef.current;

    if (!isActiveRef.current || !pose || !video) {
      return;
    }

    if (video.readyState >= 2 && !isInferencePendingRef.current) {
      isInferencePendingRef.current = true;
      try {
        await pose.send({ image: video });
      } catch (loopError) {
        setError(loopError instanceof Error ? loopError.message : 'Pose inference failed');
      } finally {
        isInferencePendingRef.current = false;
      }
    }

    rafRef.current = requestAnimationFrame(runLoop);
  }, [videoRef]);

  const startCamera = useCallback(async () => {
    try {
      setError('');
      const pose = await initializeModel();
      pose.onResults(handleResults);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element not available');
      }

      video.srcObject = stream;
      await video.play();

      isActiveRef.current = true;
      setIsCameraActive(true);
      runLoop();
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : 'Camera initialization failed');
      stopCamera();
    }
  }, [handleResults, initializeModel, runLoop, stopCamera, videoRef]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return useMemo(
    () => ({
      isReady,
      isCameraActive,
      fps,
      error,
      lastMetrics,
      startCamera,
      stopCamera,
      neonColor: lastMetrics?.color ?? NEON_TEAL,
    }),
    [error, fps, isCameraActive, isReady, lastMetrics, startCamera, stopCamera],
  );
}
