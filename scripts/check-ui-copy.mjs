// Fails the build if user facing copy breaks the house rules:
//   1. The word "worker" never appears. People who do the work are called Xperts.
//   2. No em dashes or en dashes, and no spaced hyphens used as punctuation.
// It scans the web app, the API (its messages reach the screen) and the shared
// package. Comments and tests are ignored.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const roots = ['apps/web/src', 'apps/api/src', 'packages/shared/src']
const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (['.ts', '.tsx'].includes(extname(p)) && !/\.test\.tsx?$/.test(p)) files.push(p)
  }
}
roots.forEach(walk)

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/(^|\s)\/\/\s.*$/, '$1')))
    .join('\n')

const problems = []
for (const file of files) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`
    if (/[—–]/.test(line)) problems.push(`${where} dash character: ${line.trim()}`)
    if (/\bworkers?\b/i.test(line)) problems.push(`${where} says worker, use Xpert: ${line.trim()}`)
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (/\s-\s/.test(m[2] ?? '')) problems.push(`${where} spaced hyphen in text: ${line.trim()}`)
    }
    // JSX text between tags
    for (const m of line.matchAll(/>([^<>{}]+)</g)) {
      if (/\s-\s|^\s*-\s/.test(m[1] ?? '')) problems.push(`${where} spaced hyphen in JSX text: ${line.trim()}`)
    }
  })
}

if (problems.length) {
  console.error(`Copy check failed (${problems.length}):\n` + problems.join('\n'))
  process.exit(1)
}
console.log(`Copy check passed for ${files.length} files.`)
