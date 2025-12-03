/**
 * Squircle (Superellipse) utilities for continuous curvature corners
 *
 * A superellipse uses the formula |x/a|ⁿ + |y/b|ⁿ = 1
 * where n controls the "squareness":
 * - n = 2: regular ellipse
 * - n ≈ 4-5: Apple-style squircle
 * - n → ∞: rectangle
 *
 * This creates smooth G2/G3 continuous curvature transitions
 * instead of the abrupt straight-to-arc junction of standard border-radius.
 */

export interface SquircleOptions {
  /** Width of the shape in pixels */
  width: number
  /** Height of the shape in pixels */
  height: number
  /** Corner radius in pixels (similar to border-radius) */
  cornerRadius: number
  /**
   * Superellipse exponent (controls squareness)
   * - 2 = ellipse
   * - 4-5 = Apple-style squircle (default: 5)
   * - Higher = more rectangular
   */
  exponent?: number
  /**
   * Number of points to generate per corner curve
   * Higher = smoother curve (default: 8)
   */
  cornerPoints?: number
}

/**
 * Generates a point on a superellipse corner
 */
function superellipsePoint(
  t: number,
  rx: number,
  ry: number,
  n: number
): { x: number; y: number } {
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  return {
    x: Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n) * rx,
    y: Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n) * ry,
  }
}

/**
 * Generates a pure superellipse path that fills the bounding box
 * Used for capsule/pill shapes where there should be NO straight edges
 */
function generatePureSuperellipsePath(
  width: number,
  height: number,
  exponent: number,
  totalPoints: number = 64
): string {
  const points: string[] = []
  const cx = width / 2
  const cy = height / 2
  const rx = width / 2
  const ry = height / 2

  // Generate points around the full superellipse
  for (let i = 0; i <= totalPoints; i++) {
    const t = (i / totalPoints) * 2 * Math.PI - Math.PI / 2 // Start from top
    const p = superellipsePoint(t, rx, ry, exponent)
    const x = cx + p.x
    const y = cy + p.y

    if (i === 0) {
      points.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`)
    } else {
      points.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
    }
  }

  points.push("Z")
  return points.join(" ")
}

/**
 * Generates an SVG path for a squircle (superellipse rounded rectangle)
 * When cornerRadius >= min(width, height) / 2 (capsule mode),
 * generates a pure superellipse with NO straight edges
 */
export function generateSquirclePath(options: SquircleOptions): string {
  const {
    width,
    height,
    cornerRadius,
    exponent = 5,
    cornerPoints = 8,
  } = options

  // If dimensions are too small, return simple rect
  if (width <= 0 || height <= 0) {
    return `M 0 0 H ${width} V ${height} H 0 Z`
  }

  // If corner radius is 0, return simple rect
  if (cornerRadius <= 0) {
    return `M 0 0 H ${width} V ${height} H 0 Z`
  }

  const maxRadius = Math.min(width, height) / 2

  // CAPSULE MODE: When radius >= half the smaller dimension,
  // generate a pure superellipse (no straight edges)
  if (cornerRadius >= maxRadius) {
    return generatePureSuperellipsePath(width, height, exponent, cornerPoints * 8)
  }

  // ROUNDED RECT MODE: Squircle corners with straight edges
  const r = cornerRadius

  const points: string[] = []

  // Start at top-left, after the corner
  points.push(`M ${r} 0`)

  // Top edge
  points.push(`L ${width - r} 0`)

  // Top-right corner (quarter from 3π/2 to 2π, i.e., -π/2 to 0)
  for (let i = 0; i <= cornerPoints; i++) {
    const t = -Math.PI / 2 + (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(`L ${width - r + p.x} ${r + p.y}`)
  }

  // Right edge
  points.push(`L ${width} ${height - r}`)

  // Bottom-right corner (quarter from 0 to π/2)
  for (let i = 0; i <= cornerPoints; i++) {
    const t = (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(`L ${width - r + p.x} ${height - r + p.y}`)
  }

  // Bottom edge
  points.push(`L ${r} ${height}`)

  // Bottom-left corner (quarter from π/2 to π)
  for (let i = 0; i <= cornerPoints; i++) {
    const t = Math.PI / 2 + (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(`L ${r + p.x} ${height - r + p.y}`)
  }

  // Left edge
  points.push(`L 0 ${r}`)

  // Top-left corner (quarter from π to 3π/2)
  for (let i = 0; i <= cornerPoints; i++) {
    const t = Math.PI + (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(`L ${r + p.x} ${r + p.y}`)
  }

  points.push("Z")

  return points.join(" ")
}

/**
 * Generates an SVG data URL for use as a clip-path
 */
export function generateSquircleClipPath(options: SquircleOptions): string {
  const path = generateSquirclePath(options)
  const { width, height } = options

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path}" /></svg>`

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * Generates a pure superellipse polygon (CSS format) for capsule shapes
 */
function generatePureSuperellipsePolygon(
  width: number,
  height: number,
  exponent: number,
  totalPoints: number = 64
): string {
  const points: string[] = []
  const cx = width / 2
  const cy = height / 2
  const rx = width / 2
  const ry = height / 2

  // Convert to percentages for CSS polygon
  const toPercent = (x: number, y: number) =>
    `${((x / width) * 100).toFixed(2)}% ${((y / height) * 100).toFixed(2)}%`

  // Generate points around the full superellipse
  for (let i = 0; i <= totalPoints; i++) {
    const t = (i / totalPoints) * 2 * Math.PI - Math.PI / 2 // Start from top
    const p = superellipsePoint(t, rx, ry, exponent)
    const x = cx + p.x
    const y = cy + p.y
    points.push(toPercent(x, y))
  }

  return `polygon(${points.join(", ")})`
}

/**
 * Generates inline CSS for clip-path using polygon approximation
 * This is more performant than SVG clip-path for simple shapes
 * When cornerRadius >= min(width, height) / 2 (capsule mode),
 * generates a pure superellipse polygon with NO straight edges
 */
export function generateSquirclePolygon(options: SquircleOptions): string {
  const {
    width,
    height,
    cornerRadius,
    exponent = 5,
    cornerPoints = 8,
  } = options

  if (width <= 0 || height <= 0) {
    return "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)"
  }

  if (cornerRadius <= 0) {
    return "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)"
  }

  const maxRadius = Math.min(width, height) / 2

  // CAPSULE MODE: When radius >= half the smaller dimension,
  // generate a pure superellipse (no straight edges)
  if (cornerRadius >= maxRadius) {
    return generatePureSuperellipsePolygon(width, height, exponent, cornerPoints * 8)
  }

  // ROUNDED RECT MODE: Squircle corners with straight edges
  const r = cornerRadius

  const points: string[] = []

  // Convert to percentages for CSS polygon
  const toPercent = (x: number, y: number) =>
    `${((x / width) * 100).toFixed(2)}% ${((y / height) * 100).toFixed(2)}%`

  // Start at top-left, after the corner
  points.push(toPercent(r, 0))

  // Top edge end
  points.push(toPercent(width - r, 0))

  // Top-right corner
  for (let i = 0; i <= cornerPoints; i++) {
    const t = -Math.PI / 2 + (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(toPercent(width - r + p.x, r + p.y))
  }

  // Bottom-right corner
  for (let i = 0; i <= cornerPoints; i++) {
    const t = (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(toPercent(width - r + p.x, height - r + p.y))
  }

  // Bottom edge end
  points.push(toPercent(r, height))

  // Bottom-left corner
  for (let i = 0; i <= cornerPoints; i++) {
    const t = Math.PI / 2 + (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(toPercent(r + p.x, height - r + p.y))
  }

  // Top-left corner
  for (let i = 0; i <= cornerPoints; i++) {
    const t = Math.PI + (i / cornerPoints) * (Math.PI / 2)
    const p = superellipsePoint(t, r, r, exponent)
    points.push(toPercent(r + p.x, r + p.y))
  }

  return `polygon(${points.join(", ")})`
}

/**
 * Pre-calculated corner radius values for common Tailwind sizes
 * These map to Tailwind's rounded-* classes
 */
export const TAILWIND_RADII = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
} as const

export type TailwindRadius = keyof typeof TAILWIND_RADII
