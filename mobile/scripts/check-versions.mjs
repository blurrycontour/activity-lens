// Fails the build when the Capacitor packages bundled into the web app and the
// ones compiled into the APK disagree.
//
// Every Capacitor plugin is two halves: JavaScript that Vite bundles from
// frontend/node_modules, and Java that Gradle compiles from mobile/node_modules.
// They talk over a bridge whose call signatures are only guaranteed to match
// within a version. When they drift, nothing fails at build time — the app
// installs, runs, and then a plugin call rejects at runtime on a real device,
// which is the most expensive place to find out.
//
// Two package.json files is the price of keeping the Capacitor tooling out of
// the frontend. This check is what makes that price safe to pay: the versions
// must be identical, and saying so out loud here is cheaper than a dependency
// bump quietly breaking storage on Android.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileRoot = resolve(here, '..')
const frontendRoot = resolve(mobileRoot, '../frontend')

/** Packages that exist on both sides and must agree exactly. */
const SHARED = ['@capacitor/core', '@capacitor/preferences']

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** The version actually installed, which is what gets built — not the range. */
function installedVersion(root, pkg) {
  try {
    return readJSON(resolve(root, 'node_modules', pkg, 'package.json')).version
  } catch {
    return null
  }
}

const problems = []
for (const pkg of SHARED) {
  const web = installedVersion(frontendRoot, pkg)
  const native = installedVersion(mobileRoot, pkg)
  if (web === null) {
    problems.push(`${pkg}: not installed in frontend/ — run "pnpm install" there first`)
    continue
  }
  if (native === null) {
    problems.push(`${pkg}: not installed in mobile/ — run "pnpm install" here first`)
    continue
  }
  if (web !== native) {
    problems.push(`${pkg}: frontend has ${web}, mobile has ${native} — pin both to the same version`)
  }
}

if (problems.length > 0) {
  console.error('Capacitor versions do not match between frontend/ and mobile/:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nThe web bundle and the native code must be built from the same versions.')
  process.exit(1)
}

console.log(`Capacitor versions match (${SHARED.map(p => `${p}@${installedVersion(mobileRoot, p)}`).join(', ')})`)
