import type { Locator, Page } from '@playwright/test'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'

export const assetPath = `${process.env.PW_TEST_ASSET_ORIGIN}/build`

/** Reads browser text geometry for visibility, size, and panel-boundary assertions. */
export async function renderedTextGeometry(locator: Locator) {
  return locator.evaluate((text) => {
    const panel = text.closest<HTMLElement>('[data-panel]')
    if (!panel) throw new Error('Expected text to be inside a panel')
    const range = document.createRange()
    range.selectNodeContents(text)
    const fragments = [...range.getClientRects()]
    const panelRect = panel.getBoundingClientRect()
    const box = text.getBoundingClientRect()
    const style = getComputedStyle(text)
    return {
      visible:
        style.position !== 'absolute' &&
        fragments.some((rect) => rect.width > 0 && rect.height > 0),
      contained: fragments.every(
        (rect) =>
          rect.left >= panelRect.left &&
          rect.right <= panelRect.right &&
          rect.top >= panelRect.top &&
          rect.bottom <= panelRect.bottom,
      ),
      width: box.width,
      height: box.height,
    }
  })
}

export const positionedBoard = {
  panels: [
    { id: 'build-a', type: 'pipeline-status', position: { x: 0, y: 0, w: 6, h: 4 } },
    { id: 'build-b', type: 'pipeline-status', position: { x: 6, y: 0, w: 6, h: 4 } },
    { id: 'dashboard', type: 'pipeline-status', position: { x: 0, y: 8, w: 12, h: 4 } },
    { id: 'version', type: 'http-value', position: { x: 0, y: 12, w: 3, h: 2 } },
  ],
}

function browserEnv(board = 'ze-great-team') {
  return {
    assetPath,
    assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
    proxyPath: '/api',
    board,
    clientVersion: 'browser-test',
  }
}

export function stubClientEnv(page: Page, env: ClientEnv) {
  // The packaged entrypoint assigns its own env after Playwright's initialization scripts.
  return page.addInitScript((fixture) => {
    let value = fixture
    let firstServerAssignment = true
    Object.defineProperty(window, 'env', {
      configurable: true,
      get: () => value,
      set: (next: typeof fixture) => {
        if (firstServerAssignment) firstServerAssignment = false
        else value = next
      },
    })
  }, env)
}

export function stubDashboard(
  page: Page,
  board: unknown,
  boardName = 'ze-great-team',
  security?: ClientEnv['security'],
) {
  return Promise.all([
    stubClientEnv(page, { ...browserEnv(boardName), security }),
    page.route(`**/api/boards/${boardName}`, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(board) }),
    ),
    page.route('**/api/client', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          assetPath,
          assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
          serverVersion: 'browser-test-server',
        }),
      }),
    ),
  ])
}
