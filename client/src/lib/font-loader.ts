/**
 * Dynamic Google Fonts loader
 *
 * Reads font names from CSS custom properties and automatically loads them
 * from Google Fonts. Just update --font-sans, --font-serif, or --font-mono
 * in index.css and the fonts will load automatically.
 */

// Load WebFont loader script
function loadWebFontScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.WebFont) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load WebFont loader'));
    document.head.appendChild(script);
  });
}

// Extract font family name from CSS value (e.g., '"Open Sans", sans-serif' -> 'Open Sans')
function extractFontFamily(cssValue: string): string | null {
  if (!cssValue) return null;

  // Match quoted font name or unquoted font name before comma
  const match = cssValue.match(/^["']?([^"',]+)["']?/);
  if (match) {
    const fontName = match[1].trim();
    // Skip generic font families
    const generics = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
    if (generics.includes(fontName.toLowerCase())) {
      return null;
    }
    return fontName;
  }
  return null;
}

// Get font families from CSS custom properties
function getFontFamiliesFromCSS(): string[] {
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);

  const fontVars = ['--font-sans', '--font-serif', '--font-mono', '--font-heading'];
  const families: string[] = [];

  console.log('[FontLoader] Reading CSS variables...');
  for (const varName of fontVars) {
    const value = computedStyle.getPropertyValue(varName).trim();
    console.log(`[FontLoader] ${varName} = "${value}"`);
    const family = extractFontFamily(value);
    if (family && !families.includes(family)) {
      families.push(family);
    }
  }

  return families;
}

// Format font family for Google Fonts API (with weights)
function formatForGoogleFonts(family: string): string {
  // Request common weights: 300, 400, 500, 600, 700 and italic variants
  return `${family}:300,400,500,600,700,300i,400i,500i,600i,700i`;
}

// Main function to load fonts
export async function loadGoogleFonts(): Promise<void> {
  const families = getFontFamiliesFromCSS();

  if (families.length === 0) {
    console.log('[FontLoader] No custom fonts to load');
    return;
  }

  console.log('[FontLoader] Loading fonts:', families);

  try {
    await loadWebFontScript();

    return new Promise((resolve, reject) => {
      window.WebFont.load({
        google: {
          families: families.map(formatForGoogleFonts),
        },
        active: () => {
          console.log('[FontLoader] All fonts loaded successfully');
          resolve();
        },
        inactive: () => {
          console.warn('[FontLoader] Some fonts failed to load');
          resolve(); // Still resolve, app should work with fallback fonts
        },
        timeout: 3000,
      });
    });
  } catch (error) {
    console.error('[FontLoader] Failed to load fonts:', error);
  }
}

// Type declaration for WebFont global
declare global {
  interface Window {
    WebFont: {
      load: (config: {
        google?: { families: string[] };
        active?: () => void;
        inactive?: () => void;
        timeout?: number;
      }) => void;
    };
  }
}
