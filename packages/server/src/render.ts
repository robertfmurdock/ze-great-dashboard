import type { ClientEnv } from '@ze-great-dashboard/shared'
import { ASSET_PATH_SENTINEL } from './template.ts'

/**
 * Turns the published template into the document a browser receives.
 *
 * Two operations, both deliberately dumb: replace the asset-path sentinel, and inject the
 * `window.env` block. `index.html` is deployable configuration rather than a build artifact, and
 * this function is the whole of that deployment step.
 */
export function renderIndexHtml(template: string, env: ClientEnv): string {
  return injectClientEnv(replaceAssetPath(template, env.assetPath), env)
}

function replaceAssetPath(template: string, assetPath: string): string {
  return template.replaceAll(ASSET_PATH_SENTINEL, assetPath)
}

/**
 * The block goes in as the first element of `<head>` so it runs before anything else on the page
 * loads — the client's own modules read it during their initial evaluation.
 */
function injectClientEnv(html: string, env: ClientEnv): string {
  const block = `<script>window.env = ${serializeForScriptTag(env)};</script>`

  const headMatch = /<head[^>]*>/i.exec(html)
  if (!headMatch) {
    // A template without a <head> is a broken build, not something to paper over.
    throw new Error(
      'The client template has no <head> element, so there is nowhere to inject configuration.',
    )
  }

  const insertAt = headMatch.index + headMatch[0].length
  return html.slice(0, insertAt) + block + html.slice(insertAt)
}

/**
 * JSON is very nearly script-safe, but not entirely: an unescaped `</script>` in any string value
 * would close the tag early, and U+2028/U+2029 are literal line terminators in JS source.
 */
function serializeForScriptTag(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}
