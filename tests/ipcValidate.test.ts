import assert from 'node:assert/strict'
import { isBookId, isSettingsPartial, isNonEmptyString } from '../electron/utils/ipcValidate'

assert.equal(isBookId('abc-123'), true)
assert.equal(isBookId('../etc/passwd'), false)
assert.equal(isBookId(''), false)
assert.equal(isBookId(null), false)

assert.equal(isSettingsPartial({ theme: 'dark' }), true)
assert.equal(isSettingsPartial(null), false)
assert.equal(isSettingsPartial([]), false)

assert.equal(isNonEmptyString('ok'), true)
assert.equal(isNonEmptyString(''), false)

console.log('ipcValidate result: basic guards ok')
