import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadGoogleFonts } from './lib/font-loader'
import App from './App.tsx'

// Dynamically load Google Fonts after CSS is parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => loadGoogleFonts())
} else {
  // DOM already ready, but wait a tick for CSS to be applied
  requestAnimationFrame(() => loadGoogleFonts())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
