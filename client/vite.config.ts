import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const designSystemPath = path.resolve(__dirname, './node_modules/@jybrd/design-system')
const shimPath = path.resolve(__dirname, './src/lib/use-sync-external-store-shim')

// Plugin to redirect use-sync-external-store to React 19 compatible shims
function useSyncExternalStoreShimPlugin(): Plugin {
  return {
    name: 'use-sync-external-store-shim',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'use-sync-external-store/shim/with-selector') {
        return `${shimPath}/with-selector.ts`
      }
      if (source === 'use-sync-external-store/shim' || source === 'use-sync-external-store/shim/index.js') {
        return `${shimPath}/index.ts`
      }
      return null
    },
  }
}

// Plugin to resolve @/ imports from within the design system to point to design system internals
function designSystemAliasPlugin(): Plugin {
  return {
    name: 'design-system-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      // Only handle @/ imports from within the design system package
      if (importer && source.startsWith('@/')) {
        // Check if the importer is from the design system
        const normalizedImporter = importer.replace(/\\/g, '/')
        if (normalizedImporter.includes('node_modules/@jybrd/design-system')) {
          const resolvedPath = source.replace('@/', `${designSystemPath}/`)
          return { id: resolvedPath, external: false }
        }
      }
      return null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [useSyncExternalStoreShimPlugin(), designSystemAliasPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward original host for proper redirect handling
            const originalHost = req.headers.host
            if (originalHost) {
              proxyReq.setHeader('X-Forwarded-Host', originalHost)
              proxyReq.setHeader('X-Forwarded-Proto', 'http')
            }
          })
        },
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward original host for OAuth redirect
            const originalHost = req.headers.host
            if (originalHost) {
              proxyReq.setHeader('X-Forwarded-Host', originalHost)
              proxyReq.setHeader('X-Forwarded-Proto', 'http')
            }
          })
        },
      },
    },
  },
})
