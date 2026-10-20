/**
 * Official NFI colour system — mirror of the CSS custom properties declared
 * in `tailwind.css`. Exported as TypeScript constants so non-CSS consumers
 * (MapLibre style specs, Chart.js datasets, Three.js materials, etc.) can
 * reference the same sanctioned palette without duplicating hex literals.
 *
 * Keep this file in sync with `src/assets/tailwind.css`.
 */

/** Neutral palette */
export const WHITE = '#f6f6f6'
export const LIGHTER = '#f6f6f6'
export const LIGHT = '#999997'
export const GREY = '#484847'
export const DARK = '#1f1f1f'
export const DARKER = '#141414'
export const DARKEST = '#000000'

/** Accent */
export const ACCENT = '#5076ff'
export const NFI_GREEN = '#04943c'

/** Delta / comparison signals */
export const DELTA_POSITIVE = NFI_GREEN
export const DELTA_NEGATIVE = '#ff5820'
export const DELTA_NEUTRAL = LIGHTER

/** Gradient-ramp identity colours */
export const DEEP_BLUE = '#120db3'
export const AURORA = '#e344a3'
export const EARTH = '#86370d'
export const FOREST = '#7cc715'
export const EMBER = '#ff5820'
export const EMERALD = '#3cb28d'
export const AMETHYST = '#6c52ff'
export const SUNSET = '#ed6353'
export const SOLAR = '#faff44'
export const ICE = '#d6dfff'

/**
 * Domain-specific extensions — not part of the core brand palette but
 * sanctioned for specific semantic uses where no brand colour fits.
 */
/** Proxemic "personal" zone (Hall 1966) — amber caution. */
export const PROXEMIC_PERSONAL = '#f7cb15'
/** Proxemic "intimate" zone (Hall 1966) — alert red. */
export const PROXEMIC_INTIMATE = '#bf211e'
