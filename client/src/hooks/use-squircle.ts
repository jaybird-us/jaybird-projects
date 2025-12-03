"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  generateSquirclePolygon,
  TAILWIND_RADII,
  type TailwindRadius,
} from "@/lib/squircle"

export interface UseSquircleOptions {
  /**
   * Corner radius - can be a number in pixels or a Tailwind radius key
   * @default "md" (6px)
   */
  cornerRadius?: number | TailwindRadius
  /**
   * Superellipse exponent (controls squareness)
   * - 2 = ellipse
   * - 4-5 = Apple-style squircle
   * @default 5
   */
  exponent?: number
  /**
   * Number of points per corner curve
   * @default 8
   */
  cornerPoints?: number
  /**
   * Whether the squircle is enabled
   * @default true
   */
  enabled?: boolean
}

export interface UseSquircleReturn {
  /** Ref to attach to the element */
  ref: React.RefCallback<HTMLElement>
  /** CSS style object to apply to the element */
  style: React.CSSProperties
  /** Current clip-path value */
  clipPath: string | undefined
}

/**
 * Hook that applies a squircle (superellipse) clip-path to an element
 * Uses ResizeObserver to update the clip-path when the element resizes
 *
 * @example
 * ```tsx
 * function SquircleButton() {
 *   const { ref, style } = useSquircle({ cornerRadius: "lg" })
 *   return <button ref={ref} style={style}>Click me</button>
 * }
 * ```
 */
export function useSquircle(
  options: UseSquircleOptions = {}
): UseSquircleReturn {
  const {
    cornerRadius = "md",
    exponent = 5,
    cornerPoints = 8,
    enabled = true,
  } = options

  const [clipPath, setClipPath] = useState<string | undefined>(undefined)
  const elementRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  // Resolve corner radius from Tailwind key or number
  const resolvedRadius =
    typeof cornerRadius === "number"
      ? cornerRadius
      : TAILWIND_RADII[cornerRadius] ?? 6

  const updateClipPath = useCallback(() => {
    if (!elementRef.current || !enabled) {
      setClipPath(undefined)
      return
    }

    const rect = elementRef.current.getBoundingClientRect()
    const { width, height } = rect

    if (width > 0 && height > 0) {
      const polygon = generateSquirclePolygon({
        width,
        height,
        cornerRadius: resolvedRadius,
        exponent,
        cornerPoints,
      })
      setClipPath(polygon)
    }
  }, [resolvedRadius, exponent, cornerPoints, enabled])

  // Ref callback to set up ResizeObserver
  const ref = useCallback(
    (element: HTMLElement | null) => {
      // Clean up previous observer
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }

      elementRef.current = element

      if (element && enabled) {
        // Initial update
        updateClipPath()

        // Set up ResizeObserver for dynamic sizing
        observerRef.current = new ResizeObserver(() => {
          updateClipPath()
        })
        observerRef.current.observe(element)
      }
    },
    [updateClipPath, enabled]
  )

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [])

  // Update when options change
  useEffect(() => {
    updateClipPath()
  }, [updateClipPath])

  // Use CSS custom property so pseudo-elements can access the same clip-path
  const style: React.CSSProperties = enabled && clipPath
    ? {
        '--squircle-path': clipPath,
        clipPath: 'var(--squircle-path)',
      } as React.CSSProperties
    : {}

  return { ref, style, clipPath }
}

/**
 * Merges multiple refs into a single ref callback
 * Useful when combining useSquircle ref with other refs
 */
export function mergeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (element: T | null) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(element)
      } else if (ref && "current" in ref) {
        ;(ref as React.MutableRefObject<T | null>).current = element
      }
    })
  }
}
