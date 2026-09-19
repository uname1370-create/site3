"use client"
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * CameraControls — Cinematic 3D Camera Auto-Zoom
 * Parametric orthographic zoom & pan per service, lerp 60fps
 * - brows: upper face 75% frame
 * - lips: macro mouth
 * - eyeliner: eye contour
 * - full: centered face
 *
 * Uses viewCrop {x,y,w,h} normalized (0..1) -> converts to camera frustum
 * Maintains pixel-perfect alignment for Before/After by sharing same viewCrop
 */
export default function CameraControls({ viewCrop, baseCrop, isActive = true, lerpSpeed = 0.09 }) {
  const { camera } = useThree()
  const target = useRef({ x: 0, y: 0, zoom: 1 })
  const current = useRef({ x: 0, y: 0, zoom: 1 })

  // Compute orthographic frustum from normalized crop
  // Canvas plane is 2x2 world units centered at 0,0; image UV 0..1 maps to -1..1
  // viewCrop.x/y/w/h -> camera position + zoom
  useFrame(() => {
    if (!isActive || !viewCrop) return

    // target camera: center = crop center, zoom = 1 / crop.w  (approx, keep aspect)
    const cx = viewCrop.x + viewCrop.w / 2
    const cy = viewCrop.y + viewCrop.h / 2
    // orthographic camera centered at 0.5,0.5 in UV; convert to -1..1
    const targetX = (cx - 0.5) * 2
    const targetY = -(cy - 0.5) * 2
    // zoom: base is 1 / baseCrop.w, target is 1 / viewCrop.w  -> relative
    const baseW = baseCrop?.w || 0.72
    const targetZoom = (baseW / viewCrop.w) * 1.0

    target.current.x = targetX
    target.current.y = targetY
    target.current.zoom = THREE.MathUtils.clamp(targetZoom, 0.9, 2.4)

    // smooth lerp 60fps
    current.current.x = THREE.MathUtils.lerp(current.current.x, target.current.x, lerpSpeed)
    current.current.y = THREE.MathUtils.lerp(current.current.y, target.current.y, lerpSpeed)
    current.current.zoom = THREE.MathUtils.lerp(current.current.zoom, target.current.zoom, lerpSpeed * 0.9)

    if (camera.isOrthographicCamera) {
      camera.position.x = current.current.x
      camera.position.y = current.current.y
      camera.zoom = current.current.zoom
      camera.updateProjectionMatrix()
    } else {
      // perspective fallback: dolly
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX * 1.2, lerpSpeed)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY * 1.2, lerpSpeed)
      camera.updateProjectionMatrix()
    }
  })

  return null
}

// Helper: Framer-motion style parametric presets (export for UI sync)
export const CAMERA_PRESETS = {
  full: { zoom: 1.0, panY: 0 },
  brows: { zoom: 1.55, panY: 0.22 },   // upper face fills 75%
  eyeliner: { zoom: 1.85, panY: 0.12 }, // eye macro
  lips: { zoom: 1.65, panY: -0.18 }    // mouth macro
}
