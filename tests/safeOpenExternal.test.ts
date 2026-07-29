import assert from 'node:assert/strict'
import { isSafeExternalUrl } from '../electron/utils/safeOpenExternal'

assert.equal(isSafeExternalUrl('https://example.com/a'), true)
assert.equal(isSafeExternalUrl('http://localhost:3000'), true)
assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
assert.equal(isSafeExternalUrl('file:///C:/Windows/System32'), false)
assert.equal(isSafeExternalUrl('not a url'), false)
assert.equal(isSafeExternalUrl(''), false)

console.log('safeOpenExternal result: protocol whitelist ok')
