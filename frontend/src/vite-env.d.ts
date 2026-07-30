/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected at build time via vite.config.ts `define` from package.json.
declare const __APP_VERSION__: string

// The File Handling API, which backs "Open with" for an installed PWA. Not in
// TypeScript's DOM library, and Chrome/Edge desktop are the only implementors,
// so every use is behind a `'launchQueue' in window` check.
interface LaunchParams {
  files?: FileSystemFileHandle[]
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void
}
