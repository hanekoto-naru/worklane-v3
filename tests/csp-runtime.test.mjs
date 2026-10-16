import assert from 'node:assert/strict'
import test from 'node:test'

test('Zodの初期化・正常/異常データ検証で動的コード生成を試みない', async () => {
  const original = globalThis.Function
  let attempts = 0
  globalThis.Function = new Proxy(original, { construct() { attempts++; throw new Error('CSP blocked') }, apply() { attempts++; throw new Error('CSP blocked') } })
  try {
    const { initialState } = await import('./sample-data.mjs')
    const { serialize, parseDocument } = await import('../src/persistence.ts')
    assert.equal(parseDocument(serialize(initialState, 1)).revision, 1)
    assert.throws(() => parseDocument('{}'))
    assert.equal(attempts, 0)
  } finally { globalThis.Function = original }
})
