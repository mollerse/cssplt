(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer)) return new Buffer(subject, encoding, noZero)

  var type = typeof subject
  var length

  if (type === 'number') {
    length = +subject
  } else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) {
    // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data)) subject = subject.data
    length = +subject.length
  } else {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (length > kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum size: 0x' +
      kMaxLength.toString(16) + ' bytes')
  }

  if (length < 0) length = 0
  else length >>>= 0 // coerce to uint32

  var self = this
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    /*eslint-disable consistent-this */
    self = Buffer._augment(new Uint8Array(length))
    /*eslint-enable consistent-this */
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    self.length = length
    self._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    self._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++) {
        self[i] = subject.readUInt8(i)
      }
    } else {
      for (i = 0; i < length; i++) {
        self[i] = ((subject[i] % 256) + 256) % 256
      }
    }
  } else if (type === 'string') {
    self.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      self[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize) self.parent = rootParent

  return self
}

function SlowBuffer (subject, encoding, noZero) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding, noZero)

  var buf = new Buffer(subject, encoding, noZero)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function byteLength (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, target_start, start, end) {
  var self = this // source

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || self.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= self.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - target_start < end - start) {
    end = target.length - target_start + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
(function (Buffer){


var slides = Buffer("PHN0eWxlPg0KDQogICogew0KICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7DQogIH0NCg0KICAubGlnaHQgew0KICAgIGJhY2tncm91bmQ6ICNlNGViZWU7DQogICAgY29sb3I6ICMxYzIwMmI7DQogIH0NCg0KICAuZW1waGFzaXMgew0KICAgIGJhY2tncm91bmQ6ICNmYjU0NGQ7DQogICAgY29sb3I6ICNmZmY7DQogIH0NCg0KICAuZW1waGFzaXMgaDEsDQogIC5lbXBoYXNpcyBoMiwNCiAgLmVtcGhhc2lzIGgzLA0KICAuZW1waGFzaXMgaDQgew0KICAgIGNvbG9yOiAjMWMyMDJiOw0KICB9DQoNCiAgLmxpZ2h0IGgxLA0KICAubGlnaHQgaDIsDQogIC5saWdodCBoMywNCiAgLmxpZ2h0IGg0IHsNCiAgICBjb2xvcjogIzFjMjAyYjsNCiAgfQ0KDQogIC5kYXJrIHsNCiAgICBiYWNrZ3JvdW5kOiAjMWMyMDJiOw0KICB9DQoNCiAgLnJldmVhbCAuc3VidGl0bGUgew0KICAgIGZvbnQtZmFtaWx5OiAnSmFhcG9ra2ktcmVndWxhcicsIHNhbnMtc2VyaWY7DQogIH0NCg0KICAuc2xpZGVzPnNlY3Rpb24gew0KICAgIHBhZGRpbmc6IDElICFpbXBvcnRhbnQ7DQogIH0NCg0KICAubWlkdGVuIHsNCiAgICBoZWlnaHQ6IDEwMCU7DQogICAgZGlzcGxheTogZmxleCAhaW1wb3J0YW50Ow0KICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47DQogICAganVzdGlmeS1jb250ZW50OiBjZW50ZXI7DQogIH0NCg0KICAubWlkdGVuID4gKiB7DQogICAgdGV4dC1hbGlnbjogY2VudGVyICFpbXBvcnRhbnQ7DQogIH0NCg0KICBoMSwgaDIsIGgzLCBoNCB7DQogICAgdGV4dC1hbGlnbjogbGVmdDsNCiAgfQ0KDQogIC5yZXZlYWwgcCB7DQogICAgZm9udC1zaXplOiAxNTAlOw0KICAgIHRleHQtYWxpZ246IGxlZnQ7DQogIH0NCiAgc3Bhbi51dGhldiB7DQogICAgY29sb3I6ICNmYjU0NGQ7DQogIH0NCg0KICBpbWcgew0KICAgIGJvcmRlcjogbm9uZSAhaW1wb3J0YW50Ow0KICAgIGJhY2tncm91bmQ6IGluaGVyaXQgIWltcG9ydGFudDsNCiAgICBib3gtc2hhZG93OiBub25lICFpbXBvcnRhbnQ7DQogIH0NCg0KICAuc3RyaWtlLnZpc2libGU6bm90KC5jdXJyZW50LWZyYWdtZW50KSB7DQogICAgdGV4dC1kZWNvcmF0aW9uOiBsaW5lLXRocm91Z2g7DQogIH0NCg0KPC9zdHlsZT4NCg0KPHNlY3Rpb24gY2xhc3M9Im1pZHRlbiI+DQogIDxoMj5DU1M8L2gyPg0KICA8aDM+Jm1kYXNoOzwvaDM+DQogIDxoMj5FdCBwcm9ncmFtbWVyaW5ncy10ZW9yZXRpc2sgc2tyw6VibGlrazwvaDI+DQogIDxoNz5TdGlhbiBWZXVtIE3DuGxsZXJzZW4gLyBAbW9sbGVyc2U8L2g3Pg0KICA8aDc+QkVLSzwvaDc+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPg0KICA8aDI+S09NUE9TSVNKT048L2gyPg0KPC9zZWN0aW9uPg0KDQo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIGxpZ2h0IiBkYXRhLWJhY2tncm91bmQ9IiNlNGViZWUiPg0KICA8cD5Lb21wb3Npc2pvbiBlciDDpSBzZXR0ZSBzYW1tZW4gPHNwYW4gY2xhc3M9InV0aGV2Ij5sw7hzbmluZ2VyPC9zcGFuPiBww6UgZW5rbGVyZSA8c3BhbiBjbGFzcz0idXRoZXYiPmRlbHByb2JsZW1lcjwvc3Bhbj4gZm9yIMOlIGzDuHNlIGV0IG1lciBrb21wbGVrc3QgPHNwYW4gY2xhc3M9InV0aGV2Ij5wcm9ibGVtPC9zcGFuPi48L3A+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uPg0KICA8aDI+S29tcG9zaXNqb248L2gyPg0KICA8cD5EZSBmbGVzdGUga2plbm5lciBrb21wb3Npc2pvbiBmcmEgb2JqZWt0IG9yaWVudGVyaW5nOjwvcD4NCiAgPHByZSA+PGNvZGUgY2xhc3M9ImphdmEiPmNsYXNzIEFuaW1hbCB7DQogIC8vLi4uDQp9DQoNCmNsYXNzIERvZyBleHRlbmRzIEFuaW1hbCB7DQogIC8vLi4uDQp9DQoNCmNsYXNzIE93bmVyIHsNCiAgcHJpdmF0ZSBEb2cgYmphcm5lID0gbmV3IERvZygpOw0KICAvLy4uLg0KfTwvY29kZT48L3ByZT4NCjwvc2VjdGlvbj4NCg0KPHNlY3Rpb24+DQogIDxoMj5Lb21wb3Npc2pvbjwvaDI+DQogIDxwPi4uLmVsbGVyIGZyYSBmdW5rc2pvbmVsbCBwcm9ncmFtbWVyaW5nPC9wPg0KICA8cHJlID48Y29kZSBjbGFzcz0iamF2YXNjcmlwdCI+ZnVuY3Rpb24gY29tcG9zZShmLCBnKSB7DQogIHJldHVybiBmdW5jdGlvbih4KSB7DQogICAgZihnKHgpKTsNCiAgfQ0KfQ0KDQpmdW5jdGlvbiBtYXBXaXRoKGEsIGYpIHsNCiAgcmV0dXJuIGEubWFwKGVsID0+IGYoZWwpKTsNCn08L2NvZGU+PC9wcmU+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4gZW1waGFzaXMiIGRhdGEtYmFja2dyb3VuZD0iI2ZiNTQ0ZCI+DQogIDxoMz5Gb3IgYXQga29tcG9zaXNqb24gc2thbCBmdW5nZXJlIG3DpSBlZmZla3RlbiBhdiBrb21wb3Npc2pvbmVuIHbDpnJlIGxva2FsaXNlcnQgb2cgZm9ydXRzaWdiYXIuPC9oMz4NCiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+DQogICAgPHA+RmVrcyBpIG9iamVrdCBvcmllbnRlcmluZyBzw6UgYnJ5dGVyIGtvbXBvc2lzam9uIHNhbW1lbiBodmlzIGR1IGthbiBlbmRyZQ0KZm9yZWxkcmUtb2JqZWt0ZXQgZnJhIGJhcm5lLW9iamVrdGV0LiBFbGxlciBpIGZ1bmtzam9uZWxsIHByb2dyYW1tZXJpbmcgdmlsDQprb21wb3Npc2pvbiBicnl0ZSBzYW1tZW4gaHZpcyBmdW5rc2pvbmVyIGthbiBlbmRyZSBvcHBmw7hyc2VsIGV0dGVyIGF0IGRlIGhhcg0KYmxpdHQgZGVrbGFyZXJ0LjwvcD4NCiAgPC9hc2lkZT4NCjwvc2VjdGlvbj4NCg0KPHNlY3Rpb24+DQogIDxoMj5Lb21wb3Npc2pvbiBpIENTUzwvaDI+DQpDU1M6DQogICAgPHByZT48Y29kZT4uYnRuIHsNCiAgY29sb3I6IHJlZDsNCiAgYmFja2dyb3VuZDogc2lsdmVyOw0KICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7DQp9DQoNCi5zaWRlYmFyIC5idG4gew0KICBjb2xvcjogYmxhY2s7DQogIGJhY2tncm91bmQ6IHJlZDsNCn08L2NvZGU+PC9wcmU+DQpIVE1MOg0KICA8cHJlPjxjb2RlPjxkaXYgY2xhc3M9InNpZGViYXIiPg0KICA8YnV0dG9uIGNsYXNzPSJidG4iPlByZXNzPC9idXR0b24+DQo8L2Rpdj4NCjwhLS0gY29sb3I6IGJsYWNrOyBiYWNrZ3JvdW5kOiByZWQ7IGRpc3BsYXk6IGlubGluZS1ibG9jazsgLS0+PC9jb2RlPjwvcHJlPg0KPGFzaWRlIGNsYXNzPSJub3RlcyI+DQogIDxwPkhlciBoYXIgdmkgbGFnZXQgb3NzIGVuIGdlbmVyZWxsIHN0aWwgZm9yIGFsbGUgZWxlbWVudGVyIG1lZCBrbGFzc2VuIC5idG4uIFPDpQ0KbGFnZXIgdmkgb3NzIGVuIHNwZXNpYWxpc2VyaW5nIGF2IC5idG4gc29tIGdqZWxkZXIgZm9yIC5idG5zIGkgc2lkZWJhci4NClJlc3VsdGF0ZXQgZXIgZW4gYnV0dG9uIHNvbSBoYXIgcsO4ZCBiYWtncnVubiBvZyBzdmFydCB0ZWtzdC4gRGV0IGVyIHNsaWsgbXllIENTUw0Kc2tyaXZlcyBpIGRhZy4gVmkgYXJ2ZXIgbm9lbiBhdiBzdGlsZW5lIG9nIHPDpSBvdmVyc2tyaXZlciB2aSBub2VuIGF0dHJpYnV0dGVyDQpmb3Igw6Ugc3Blc2lhbGlzZXJlIGRlbS48L3A+DQo8L2FzaWRlPg0KPC9zZWN0aW9uPg0KDQo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIGxpZ2h0IiBkYXRhLWJhY2tncm91bmQ9IiMxYzIwMmIiPg0KICA8aDM+Q1NTIGhhciA8c3BhbiBjbGFzcz0idXRoZXYiPmlra2U8L3NwYW4+IGRlIGVnZW5za2FwZW5lIHNvbSBnasO4ciBhdCBrb21wb3Npc2pvbiA8c3BhbiBjbGFzcz0idXRoZXYiPmZ1bmdlcmVyPC9zcGFuPi48L2gzPg0KPC9zZWN0aW9uPg0KDQo8c2VjdGlvbj4NCiAgPGgyPktvbXBvc2lzam9uIGkgQ1NTPC9oMj4NCiAgPHA+RWZmZWt0ZW4gYXYgZW4gYml0IG1lZCBDU1MgZXIgcG90ZW5zaWVsdCBhdmhlbmdpZyBhdiBhbGwgYW5uZW4gQ1NTIHDDpSBzaWRlbi48L3A+DQogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPg0KICAgIDxwPkVuIGJpdCBtZWQgQ1NTIGthbiBwb3RlbnNpZWx0IHDDpXZpcmtlcyBhdiBlbiB2aWxrw6VybGlnIG9nIHRpbHN5bmVsYXRlbmRlDQppa2tlLXJlbGF0ZXJ0IGJpdCBtZWQgQ1NTLiBEZXQgc29tIGhhciBub2Ugw6Ugc2kgZm9yIGRldCBlbmRlbGlnZSByZXN1bHRhdGV0IGF2DQpDU1MgcMOlIGV0IEhUTUwtZWxlbWVudCBlciBhdmhlbmdpZyBhdiBodmlsa2UgcmVnbGVyIHNvbSBtYXRjaGVyIGVsZW1lbnRldC48L3A+DQogIDwvYXNpZGU+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uPg0KICA8aDI+RXR0IGVrc2VtcGVsPC9oMj4NCkNTUzoNCiAgPHByZT48Y29kZT4uc2lkZWJhciAuaGVhZGVyIHsNCiAgZm9udC13ZWlnaHQ6IDcwMDsNCiAgdGV4dC1kZWNvcmF0aW9uOiB1bmRlcmxpbmU7DQp9DQoubmV3cy1pdGVtIGgyIHsNCiAgY29sb3I6IGJsdWU7DQp9PC9jb2RlPjwvcHJlPg0KSFRNTDoNCiAgPHByZT48Y29kZT48ZGl2IGNsYXNzPSJzaWRlYmFyIj4NCiAgPGgxIGNsYXNzPSJoZWFkZXIiPlNpZGViYXI8L2gxPg0KICA8ZGl2IGNsYXNzPSJuZXdzLWl0ZW0iPg0KICAgIDxoMiBjbGFzcz0iaGVhZGVyIj5OZXdzPC9oMj4NCiAgICA8cD5UaGVyZSB3ZXJlIG5ld3MuPC9wPg0KICA8L2Rpdj4NCjwvZGl2Pg0KPCEtLSBmb250LXdlaWdodDogNzAwOyB0ZXh0LWRlY29yYXRpb246IHVuZGVybGluZTsgY29sb3I6IGJsdWU7IC0tPjwvY29kZT48L3ByZT4NCjxhc2lkZSBjbGFzcz0ibm90ZXMiPg0KICA8cD5EZXR0ZSBlciBpa2tlIGV0IGhlbHQgdXZhbmxpZyBwcm9ibGVtIGkgQ1NTLiBFdCBzdWItdHJlIGdpciBtYXRjaCBww6UgdG8gdWxpa2UNCnJlZ2xlciBvZyB2aSBmw6VyIGVuIHXDuG5za2V0IHNhbW1lbnNsw6VpbmdzIGVmZmVrdC4gSHZvcmRhbiBza2FsIHZpIGzDuHNlIGRldHRlPzwvcD4NCjwvYXNpZGU+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uPg0KICA8aDI+VG8gbMO4c25pbmdlcjwvaDI+DQogIDxwIGNsYXNzPSJmcmFnbWVudCI+MSkgU2tyaXYgb20gZGVuIHXDuG5za2VkZSByZWdlbGVuIHRpbCDDpSBtYXRjaGUgc21hbGVyZS48L3A+DQogIDxicj4NCiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4yKSBPdmVyc2tyaXZlIHXDuG5za2VkZSBhdHRyaWJ1dHRlciBvZyDDuGtlIHNwZXNpZmlzaXRldC48L3A+DQogIDxicj4NCiAgPHAgY2xhc3M9ImZyYWdtZW50Ij48c3BhbiBjbGFzcz0idXRoZXYiPkluZ2VuPC9zcGFuPiBhdiBsw7hzbmluZ2VuZSBlciBvcHRpbWFsZTwvcD4NCiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+DQogICAgPHA+RGVuIGbDuHJzdGUgbMO4c25pbmdlbiBnw6VyIHV0IHDDpSDDpSBza3JpdmUgb20gZGVuIGbDuHJzdGUgcmVnZWxlbiB0aWwgw6UgbWF0Y2hlDQpzbWFsZXJlLiBEZXR0ZSBrYW4gcG90ZW5zaWVsdCBmw7hyZSB0aWwgcmluZ3ZpcmtuaW5nZXIgaSBtYXJrdXAgaHZvciBtYW4gZm9ydCBtw6UNCmfDpSBvdmVyIG9nIGxlZ2dlIHRpbCBrbGFzc2VyIHDDpSBhbGxlIGgyLWVsZW1lbnRlci4gRGVuIGFuZHJlIGzDuHNuaW5nZW4gZ8OlciB1dCBww6Ugw6UNCm92ZXJza3JpdmUgZGUgdcO4bnNrZWRlIGF0dHJpYnV0dGVuZSBtZWQgcmVzZXRzIGVsbGVyIGFuZHJlIHZlcmRpZXIsIGZvciDDpSB0aWwNCmRldCBtw6Ugc3Blc2lmaWZpc2V0ZXRlbiB0aWwgcmVnZWxlbiDDuGtlcy48L3A+DQogIDwvYXNpZGU+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4gZW1waGFzaXMiIGRhdGEtYmFja2dyb3VuZD0iI2ZiNTQ0ZCI+DQogIDxoMj5Nw6V0ZW4gdmkgZ2plbmJydWtlciBDU1Mgb3ZlcnNlciBkZSBpYm9lbmRlIHN2YWtoZXRlbmUgaSBDU1MnIGtvbXBvc2lzam9uc21la2FuaXNtZS48L2gyPg0KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4NCiAgICA8cD5Nw6V0ZW4gdmkgZ2plbmJydWtlciBDU1Mgb3ZlcnNlciBoZWx0IGRlIHN2YWtoZXRlbmUgc29tIGVyIGlib2VuZGUgaSBtw6V0ZW4gQ1NTDQprb21wb25lcmVyIHDDpS4gVmkgbGFnZXIgb3NzIGFic3RyYWtzam9uZXIgc29tIHZpIGdqZW5icnVrZXIgYmFzZXJ0IHDDpSBodm9yZGFuDQp0aW5nIHNlciB1dCwgZGV0IGZ1bmdlcmVyIGlra2UuIDwvcD4NCiAgPC9hc2lkZT4NCjwvc2VjdGlvbj4NCg0KPHNlY3Rpb24+DQogIDxoMj5Mw7hzbmluZz88L2gyPg0KICA8cCBjbGFzcz0iZnJhZ21lbnQiPkJlZ3JlbnNlIGFuc3ZhcmV0IHRpbCBDU1MtcmVnbGVyIHZlZCDDpSBhYnN0cmFoZXJlIHDDpSBmYWt0aXNrIGxpa2hldCwgb2cgaWtrZSBiYXJlIG92ZXJmbGFkaXNrIGxpa2hldC48L3A+DQogIDxicj4NCiAgPHAgY2xhc3M9ImZyYWdtZW50Ij5EZXQgZXIgT0sgw6Ugc2tyaXZlIGRlbiBzYW1tZSBrb2RlbiB0byBnYW5nZXIgZm9yIHVsaWtlIGdydW5uZXIuPC9wPg0KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4NCiAgICA8cD5IdmEga2FuIHZpIGdqw7hyZSBtZWQgbcOldGVuIHZpIHNrcml2ZXIgQ1NTIHDDpSBmb3Igw6UgdW5uZ8OlIGRldHRlPyBWaSBrYW4gaWtrZQ0Ka29tcG9uZXJlIENTUyB1dGlmcmEgb3ZlcmZsYWRpc2sgbGlrZXQgLS0gaHZvcmRhbiB0aW5nIHNlciB1dC4gw4UgZ2plbmJydWtlIENTUw0KYmFzZXJ0IHDDpSBhdCB0byB0aW5nIHNlciBsaWtlIHV0IGVyIGVuIHNuYXJ2ZWkgdGlsIHVow6VuZHRlcmJhciBDU1MuIEh2aXMgdmkNCmlzdGVkZW4ga29uc2VudHJlcmVyIG9zcyBvbSDDpSBnamVuYnJ1a2UgdGluZyBkZXIgdG8gdGluZyBmYWt0aXNrIGVyIHNhbW1lIHRpbmdlbg0Kb2cgcMOlIGRlbiBtw6V0ZW4gcmVkdXNlcmVyIGh2b3IgbWFuZ2UgdWxpa2UgZWxlbWVudGVyIGh2ZXIgcmVnZWwgcMOldmlya2VyLjwvcD4NCiAgICA8cD5EZXQgZXIgZmFrdGlzayBpa2tlIG5vZSBwcm9ibGVtIMOlIHNrcml2ZSBkZW4gc2FtbWUga29kZW4gdG8gZ2FuZ2VyLCBodmlzIGRldCBlciBmb3IgdG8gdWxpa2UgZ3J1bm5lci48L3A+DQogIDwvYXNpZGU+DQo8L3NlY3Rpb24+DQoNCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPg0KICA8aDE+VEFLSyBGT1IgTUVHPC9oMT4NCiAgPHA+U3RpYW4gVmV1bSBNw7hsbGVyc2VuIC8gQG1vbGxlcnNlPC9wPg0KICA8cD5CRUtLPC9wPg0KPC9zZWN0aW9uPg0K","base64");
var title = 'CSS - Et programmerings-teoretisk skråblikk';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;

}).call(this,require("buffer").Buffer)
},{"buffer":1}]},{},[5]);
