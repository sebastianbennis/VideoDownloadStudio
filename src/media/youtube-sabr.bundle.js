// node_modules/@bufbuild/protobuf/dist/esm/wire/varint.js
function varint64read() {
  const buf = this.buf;
  let pos = this.pos;
  let lo = 0;
  let hi = 0;
  for (let shift = 0; shift < 28; shift += 7) {
    const b = buf[pos++];
    lo |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.pos = pos;
      this.assertBounds();
      this.varint64Lo = lo;
      this.varint64Hi = hi;
      return;
    }
  }
  const middleByte = buf[pos++];
  lo |= (middleByte & 15) << 28;
  hi = (middleByte & 112) >> 4;
  if ((middleByte & 128) == 0) {
    this.pos = pos;
    this.assertBounds();
    this.varint64Lo = lo;
    this.varint64Hi = hi;
    return;
  }
  for (let shift = 3; shift <= 31; shift += 7) {
    const b = buf[pos++];
    hi |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.pos = pos;
      this.assertBounds();
      this.varint64Lo = lo;
      this.varint64Hi = hi;
      return;
    }
  }
  throw new Error("invalid varint");
}
var TWO_PWR_32_DBL = 4294967296;
function int64FromString(dec) {
  const minus = dec[0] === "-";
  if (minus) {
    dec = dec.slice(1);
  }
  const base = 1e6;
  let lowBits = 0;
  let highBits = 0;
  function add1e6digit(begin, end) {
    const digit1e6 = Number(dec.slice(begin, end));
    highBits *= base;
    lowBits = lowBits * base + digit1e6;
    if (lowBits >= TWO_PWR_32_DBL) {
      highBits = highBits + (lowBits / TWO_PWR_32_DBL | 0);
      lowBits = lowBits % TWO_PWR_32_DBL;
    }
  }
  add1e6digit(-24, -18);
  add1e6digit(-18, -12);
  add1e6digit(-12, -6);
  add1e6digit(-6);
  return minus ? negate(lowBits, highBits) : newBits(lowBits, highBits);
}
function int64ToString(lo, hi) {
  let bits = newBits(lo, hi);
  const negative = bits.hi & 2147483648;
  if (negative) {
    bits = negate(bits.lo, bits.hi);
  }
  const result = uInt64ToString(bits.lo, bits.hi);
  return negative ? "-" + result : result;
}
function uInt64ToString(lo, hi) {
  ({ lo, hi } = toUnsigned(lo, hi));
  if (hi <= 2097151) {
    return String(TWO_PWR_32_DBL * hi + lo);
  }
  const low = lo & 16777215;
  const mid = (lo >>> 24 | hi << 8) & 16777215;
  const high = hi >> 16 & 65535;
  let digitA = low + mid * 6777216 + high * 6710656;
  let digitB = mid + high * 8147497;
  let digitC = high * 2;
  const base = 1e7;
  if (digitA >= base) {
    digitB += Math.floor(digitA / base);
    digitA %= base;
  }
  if (digitB >= base) {
    digitC += Math.floor(digitB / base);
    digitB %= base;
  }
  return digitC.toString() + decimalFrom1e7WithLeadingZeros(digitB) + decimalFrom1e7WithLeadingZeros(digitA);
}
function toUnsigned(lo, hi) {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}
function newBits(lo, hi) {
  return { lo: lo | 0, hi: hi | 0 };
}
function negate(lowBits, highBits) {
  highBits = ~highBits;
  if (lowBits) {
    lowBits = ~lowBits + 1;
  } else {
    highBits += 1;
  }
  return newBits(lowBits, highBits);
}
var decimalFrom1e7WithLeadingZeros = (digit1e7) => {
  const partial = String(digit1e7);
  return "0000000".slice(partial.length) + partial;
};
function varint32read() {
  let b = this.buf[this.pos++];
  if ((b & 128) === 0) {
    this.assertBounds();
    return b;
  }
  let result = b & 127;
  b = this.buf[this.pos++];
  result |= (b & 127) << 7;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 14;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 21;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 15) << 28;
  for (let readBytes = 5; (b & 128) !== 0 && readBytes < 10; readBytes++)
    b = this.buf[this.pos++];
  if ((b & 128) !== 0)
    throw new Error("invalid varint");
  this.assertBounds();
  return result >>> 0;
}

// node_modules/@bufbuild/protobuf/dist/esm/proto-int64.js
var protoInt64 = /* @__PURE__ */ makeInt64Support();
function makeInt64Support() {
  const dv = new DataView(new ArrayBuffer(8));
  const ok = typeof BigInt === "function" && typeof dv.getBigInt64 === "function" && typeof dv.getBigUint64 === "function" && typeof dv.setBigInt64 === "function" && typeof dv.setBigUint64 === "function" && (!!globalThis.Deno || !!globalThis.Bun || typeof process != "object" || typeof process.env != "object" || process.env.BUF_BIGINT_DISABLE !== "1");
  if (ok) {
    const MIN = BigInt("-9223372036854775808");
    const MAX = BigInt("9223372036854775807");
    const UMIN = BigInt("0");
    const UMAX = BigInt("18446744073709551615");
    return {
      zero: BigInt(0),
      supported: true,
      parse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > MAX || bi < MIN) {
          throw new Error(`invalid int64: ${value}`);
        }
        return bi;
      },
      uParse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > UMAX || bi < UMIN) {
          throw new Error(`invalid uint64: ${value}`);
        }
        return bi;
      },
      enc(value) {
        dv.setBigInt64(0, this.parse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      uEnc(value) {
        dv.setBigInt64(0, this.uParse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      dec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigInt64(0, true);
      },
      uDec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigUint64(0, true);
      }
    };
  }
  return {
    zero: "0",
    supported: false,
    parse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return value;
    },
    uParse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return value;
    },
    enc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return int64FromString(value);
    },
    uEnc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return int64FromString(value);
    },
    dec(lo, hi) {
      return int64ToString(lo, hi);
    },
    uDec(lo, hi) {
      return uInt64ToString(lo, hi);
    }
  };
}
function assertInt64String(value) {
  if (!/^-?[0-9]+$/.test(value)) {
    throw new Error("invalid int64: " + value);
  }
}
function assertUInt64String(value) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid uint64: " + value);
  }
}

// node_modules/@bufbuild/protobuf/dist/esm/wire/text-encoding.js
var te;
function configureTextEncoding(textEncoding) {
  var _a;
  te = Object.assign(Object.assign({}, textEncoding), { encodeUtf8Into: (_a = textEncoding.encodeUtf8Into) !== null && _a !== void 0 ? _a : emulateEncodeInto(textEncoding.encodeUtf8.bind(textEncoding)) });
}
function getTextEncoding() {
  if (!te) {
    const globals = globalThis;
    if (!globals.TextEncoder || !globals.TextDecoder) {
      throw new Error("encoding API missing: install TextEncoder and TextDecoder on globalThis");
    }
    const textEncoder = new globals.TextEncoder();
    const textDecoder = new globals.TextDecoder();
    let textDecoderStrict;
    const config = {
      encodeUtf8(text) {
        return textEncoder.encode(text);
      },
      decodeUtf8(bytes, strict) {
        if (strict) {
          if (!textDecoderStrict) {
            textDecoderStrict = new globals.TextDecoder("utf-8", {
              fatal: true
            });
          }
          return textDecoderStrict.decode(bytes);
        }
        return textDecoder.decode(bytes);
      },
      checkUtf8(text) {
        try {
          encodeURIComponent(text);
          return true;
        } catch (_) {
          return false;
        }
      }
    };
    if (textEncoder.encodeInto) {
      config.encodeUtf8Into = textEncoder.encodeInto.bind(textEncoder);
    }
    const nativeStringIsWellFormed = String.prototype.isWellFormed;
    if (nativeStringIsWellFormed) {
      config.checkUtf8 = (text) => {
        return nativeStringIsWellFormed.call(text);
      };
    }
    configureTextEncoding(config);
  }
  return te;
}
function emulateEncodeInto(encodeUtf8) {
  return (text, dest) => {
    const bytes = encodeUtf8(text);
    dest.set(bytes);
    return { written: bytes.byteLength };
  };
}

// node_modules/@bufbuild/protobuf/dist/esm/wire/binary-encoding.js
var WireType;
(function(WireType2) {
  WireType2[WireType2["Varint"] = 0] = "Varint";
  WireType2[WireType2["Bit64"] = 1] = "Bit64";
  WireType2[WireType2["LengthDelimited"] = 2] = "LengthDelimited";
  WireType2[WireType2["StartGroup"] = 3] = "StartGroup";
  WireType2[WireType2["EndGroup"] = 4] = "EndGroup";
  WireType2[WireType2["Bit32"] = 5] = "Bit32";
})(WireType || (WireType = {}));
var UINT32_MAX = 4294967295;
var INT32_MAX = 2147483647;
var INT32_MIN = -2147483648;
var BinaryWriter = class {
  constructor(encodeUtf8) {
    this.stackPos = [];
    this.encodeUtf8Into = encodeUtf8 ? emulateEncodeInto(encodeUtf8) : getTextEncoding().encodeUtf8Into;
    this.buffer = EMPTY_BUFFER;
    this.viewCache = EMPTY_VIEW;
    this.pos = 0;
  }
  ensureCapacity(size) {
    const required = this.pos + size;
    if (required > this.buffer.length) {
      let newLen = this.buffer.length || INITIAL_SIZE;
      while (newLen < required)
        newLen *= 2;
      const newBuf = new Uint8Array(newLen);
      if (this.pos > 0)
        newBuf.set(this.buffer);
      this.buffer = newBuf;
    }
  }
  /**
   * The DataView over `buffer`, rebuilt only if the buffer has grown since it
   * was last used.
   */
  view() {
    const bytes = this.buffer;
    const view = this.viewCache;
    if (view.byteLength === bytes.byteLength)
      return view;
    const newView = new DataView(bytes.buffer);
    this.viewCache = newView;
    return newView;
  }
  /**
   * Return all bytes written and reset this writer.
   */
  finish() {
    const result = this.buffer.slice(0, this.pos);
    this.pos = 0;
    this.stackPos = [];
    return result;
  }
  /**
   * Start a new fork for length-delimited data like a message
   * or a packed repeated field.
   *
   * Must be joined later with `join()`.
   */
  fork() {
    this.stackPos.push(this.pos);
    this.ensureCapacity(DEFAULT_LEN_PREFIX_SIZE);
    this.buffer[this.pos++] = 0;
    return this;
  }
  /**
   * Join the last fork. Write its length and bytes, then
   * return to the previous state.
   */
  join() {
    const forkPos = this.stackPos.pop();
    if (forkPos === void 0)
      throw new Error("invalid state, fork stack empty");
    const len = this.pos - forkPos - DEFAULT_LEN_PREFIX_SIZE;
    const lenPrefixSize = varint32Size(len);
    if (lenPrefixSize > DEFAULT_LEN_PREFIX_SIZE) {
      this.ensureCapacity(lenPrefixSize - DEFAULT_LEN_PREFIX_SIZE);
      this.buffer.copyWithin(forkPos + lenPrefixSize, forkPos + DEFAULT_LEN_PREFIX_SIZE, this.pos);
    }
    this.pos = forkPos;
    this.uint32(len);
    this.pos += len;
    return this;
  }
  /**
   * Writes a tag (field number and wire type).
   *
   * Equivalent to `uint32( (fieldNo << 3 | type) >>> 0 )`.
   *
   * Generated code should compute the tag ahead of time and call `uint32()`.
   */
  tag(fieldNo, type) {
    return this.uint32((fieldNo << 3 | type) >>> 0);
  }
  /**
   * Write a chunk of raw bytes.
   */
  raw(chunk) {
    this.ensureCapacity(chunk.length);
    this.buffer.set(chunk, this.pos);
    this.pos += chunk.length;
    return this;
  }
  /**
   * Write a `uint32` value, an unsigned 32 bit varint.
   */
  uint32(value) {
    assertUInt32(value);
    this.ensureCapacity(5);
    if (value < 128) {
      this.buffer[this.pos++] = value;
      return this;
    }
    while (value > 127) {
      this.buffer[this.pos++] = value & 127 | 128;
      value >>>= 7;
    }
    this.buffer[this.pos++] = value;
    return this;
  }
  /**
   * Write a `int32` value, a signed 32 bit varint.
   */
  int32(value) {
    assertInt32(value);
    if (value >= 0) {
      return this.uint32(value);
    }
    this.ensureCapacity(10);
    for (let i = 0; i < 9; i++) {
      this.buffer[this.pos++] = value & 127 | 128;
      value >>= 7;
    }
    this.buffer[this.pos++] = 1;
    return this;
  }
  /**
   * Write a `bool` value, a varint.
   */
  bool(value) {
    this.ensureCapacity(1);
    this.buffer[this.pos++] = value ? 1 : 0;
    return this;
  }
  /**
   * Write a `bytes` value, length-delimited arbitrary data.
   */
  bytes(value) {
    this.uint32(value.byteLength);
    return this.raw(value);
  }
  /**
   * Write a `string` value, length-delimited data converted to UTF-8 text.
   */
  string(value) {
    if (typeof value !== "string") {
      value = String(value);
    }
    const len = value.length;
    if (len <= ASCII_MAX_LENGTH) {
      this.ensureCapacity(len + 1);
      const ascii = this.buffer;
      let pos = this.pos;
      ascii[pos++] = len;
      let i = 0;
      for (; i < len; i++) {
        const code = value.charCodeAt(i);
        if (code > 127)
          break;
        ascii[pos++] = code;
      }
      if (i == len) {
        this.pos = pos;
        return this;
      }
    }
    this.ensureCapacity(len * 3 + 5);
    const lenPrefixSizeGuess = varint32Size(len);
    const buf = this.buffer;
    const start = this.pos;
    const { written } = this.encodeUtf8Into(value, buf.subarray(start + lenPrefixSizeGuess));
    const lenPrefixSize = varint32Size(written);
    if (lenPrefixSize != lenPrefixSizeGuess) {
      buf.copyWithin(start + lenPrefixSize, start + lenPrefixSizeGuess, start + lenPrefixSizeGuess + written);
    }
    this.uint32(written);
    this.pos += written;
    return this;
  }
  /**
   * Write a `float` value, 32-bit floating point number.
   */
  float(value) {
    assertFloat32(value);
    this.ensureCapacity(4);
    this.view().setFloat32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `double` value, a 64-bit floating point number.
   */
  double(value) {
    this.ensureCapacity(8);
    this.view().setFloat64(this.pos, value, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `fixed32` value, an unsigned, fixed-length 32-bit integer.
   */
  fixed32(value) {
    assertUInt32(value);
    this.ensureCapacity(4);
    this.view().setUint32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `sfixed32` value, a signed, fixed-length 32-bit integer.
   */
  sfixed32(value) {
    assertInt32(value);
    this.ensureCapacity(4);
    this.view().setInt32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `sint32` value, a signed, zigzag-encoded 32-bit varint.
   */
  sint32(value) {
    assertInt32(value);
    return this.uint32((value << 1 ^ value >> 31) >>> 0);
  }
  /**
   * Write a `sfixed64` value, a signed, fixed-length 64-bit integer.
   */
  sfixed64(value) {
    const tc = protoInt64.enc(value);
    this.ensureCapacity(8);
    const view = this.view();
    view.setInt32(this.pos, tc.lo, true);
    view.setInt32(this.pos + 4, tc.hi, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `fixed64` value, an unsigned, fixed-length 64 bit integer.
   */
  fixed64(value) {
    const tc = protoInt64.uEnc(value);
    this.ensureCapacity(8);
    const view = this.view();
    view.setInt32(this.pos, tc.lo, true);
    view.setInt32(this.pos + 4, tc.hi, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `int64` value, a signed 64-bit varint.
   */
  int64(value) {
    const tc = protoInt64.enc(value);
    return this.writeVarint64(tc.lo, tc.hi);
  }
  /**
   * Write a `sint64` value, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64(value) {
    const tc = protoInt64.enc(value), sign = tc.hi >> 31, lo = tc.lo << 1 ^ sign, hi = (tc.hi << 1 | tc.lo >>> 31) ^ sign;
    return this.writeVarint64(lo, hi);
  }
  /**
   * Write a `uint64` value, an unsigned 64-bit varint.
   */
  uint64(value) {
    const tc = protoInt64.uEnc(value);
    return this.writeVarint64(tc.lo, tc.hi);
  }
  /**
   * Write a 64-bit varint directly into the buffer. Accepts the value as
   * split low/high 32-bit words.
   *
   * Ported from varint64write() to avoid the intermediate number[] buffer.
   * See https://github.com/protocolbuffers/protobuf/blob/8a71927d74a4ce34efe2d8769fda198f52d20d12/js/experimental/runtime/kernel/writer.js#L344
   */
  writeVarint64(lo, hi) {
    this.ensureCapacity(10);
    const buf = this.buffer;
    let pos = this.pos;
    for (let i = 0; i < 28; i = i + 7) {
      const shift = lo >>> i;
      const hasNext = !(shift >>> 7 == 0 && hi == 0);
      buf[pos++] = (hasNext ? shift | 128 : shift) & 255;
      if (!hasNext) {
        this.pos = pos;
        return this;
      }
    }
    const splitBits = lo >>> 28 & 15 | (hi & 7) << 4;
    const hasMoreBits = !(hi >> 3 == 0);
    buf[pos++] = (hasMoreBits ? splitBits | 128 : splitBits) & 255;
    if (!hasMoreBits) {
      this.pos = pos;
      return this;
    }
    for (let i = 3; i < 31; i = i + 7) {
      const shift = hi >>> i;
      const hasNext = !(shift >>> 7 == 0);
      buf[pos++] = (hasNext ? shift | 128 : shift) & 255;
      if (!hasNext) {
        this.pos = pos;
        return this;
      }
    }
    buf[pos++] = hi >>> 31 & 1;
    this.pos = pos;
    return this;
  }
};
var INITIAL_SIZE = 128;
var DEFAULT_LEN_PREFIX_SIZE = 1;
var EMPTY_BUFFER = new Uint8Array(0);
var EMPTY_VIEW = new DataView(EMPTY_BUFFER.buffer);
var ASCII_MAX_LENGTH = 32;
function varint32Size(value) {
  if (value < 128)
    return 1;
  if (value < 16384)
    return 2;
  if (value < 2097152)
    return 3;
  if (value < 268435456)
    return 4;
  return 5;
}
var BinaryReader = class {
  constructor(buf, decodeUtf8 = getTextEncoding().decodeUtf8) {
    this.decodeUtf8 = decodeUtf8;
    this.varint64Lo = 0;
    this.varint64Hi = 0;
    this.varint64 = varint64read;
    this.uint32 = varint32read;
    this.buf = buf;
    this.len = buf.length;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  /**
   * Reads a tag - field number and wire type. Tags are uint32 varints; values
   * that do not fit in uint32 are rejected.
   */
  tag() {
    const start = this.pos;
    const tag = this.uint32();
    const bytesRead = this.pos - start;
    if (bytesRead > 5 || bytesRead == 5 && this.buf[this.pos - 1] > 15) {
      throw new Error("illegal tag: varint overflows uint32");
    }
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNo <= 0 || wireType > 5) {
      throw new Error("illegal tag: field no " + fieldNo + " wire type " + wireType);
    }
    return [fieldNo, wireType];
  }
  /**
   * Skip one element and return the skipped data.
   *
   * When skipping StartGroup, provide the tags field number to check for
   * matching field number in the EndGroup tag. Recursion into nested groups
   * is guarded by the `recursionLimit` argument: When the limit is reached,
   * this method throws.
   */
  skip(wireType, fieldNo, recursionLimit = 100) {
    let start = this.pos;
    switch (wireType) {
      case WireType.Varint:
        while (this.buf[this.pos++] & 128) {
        }
        break;
      // @ts-ignore TS7029: Fallthrough case in switch -- ignore instead of expect-error for compiler settings without noFallthroughCasesInSwitch: true
      case WireType.Bit64:
        this.pos += 4;
      case WireType.Bit32:
        this.pos += 4;
        break;
      case WireType.LengthDelimited:
        let len = this.uint32();
        this.pos += len;
        break;
      case WireType.StartGroup:
        if (recursionLimit <= 0) {
          throw new Error("maximum recursion depth reached");
        }
        for (; ; ) {
          const [fn, wt] = this.tag();
          if (wt === WireType.EndGroup) {
            if (fieldNo !== void 0 && fn !== fieldNo) {
              throw new Error("invalid end group tag");
            }
            break;
          }
          this.skip(wt, fn, recursionLimit - 1);
        }
        break;
      default:
        throw new Error("cant skip wire type " + wireType);
    }
    this.assertBounds();
    return this.buf.subarray(start, this.pos);
  }
  /**
   * Throws error if position in byte array is out of range.
   */
  assertBounds() {
    if (this.pos > this.len)
      throw new RangeError("premature EOF");
  }
  /**
   * Read a `int32` field, a signed 32 bit varint.
   */
  int32() {
    return this.uint32() | 0;
  }
  /**
   * Read a `sint32` field, a signed, zigzag-encoded 32-bit varint.
   */
  sint32() {
    let zze = this.uint32();
    return zze >>> 1 ^ -(zze & 1);
  }
  /**
   * Read a `int64` field, a signed 64-bit varint.
   */
  int64() {
    this.varint64();
    return protoInt64.dec(this.varint64Lo, this.varint64Hi);
  }
  /**
   * Read a `uint64` field, an unsigned 64-bit varint.
   */
  uint64() {
    this.varint64();
    return protoInt64.uDec(this.varint64Lo, this.varint64Hi);
  }
  /**
   * Read a `sint64` field, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64() {
    this.varint64();
    let lo = this.varint64Lo;
    let hi = this.varint64Hi;
    let s = -(lo & 1);
    lo = (lo >>> 1 | (hi & 1) << 31) ^ s;
    hi = hi >>> 1 ^ s;
    return protoInt64.dec(lo, hi);
  }
  /**
   * Read a `bool` field, a variant.
   */
  bool() {
    const b = this.buf[this.pos];
    if (b < 128) {
      this.pos++;
      return b !== 0;
    }
    this.varint64();
    return this.varint64Lo !== 0 || this.varint64Hi !== 0;
  }
  /**
   * Read a `fixed32` field, an unsigned, fixed-length 32-bit integer.
   */
  fixed32() {
    return this.view.getUint32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `sfixed32` field, a signed, fixed-length 32-bit integer.
   */
  sfixed32() {
    return this.view.getInt32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `fixed64` field, an unsigned, fixed-length 64 bit integer.
   */
  fixed64() {
    return protoInt64.uDec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `fixed64` field, a signed, fixed-length 64-bit integer.
   */
  sfixed64() {
    return protoInt64.dec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `float` field, 32-bit floating point number.
   */
  float() {
    return this.view.getFloat32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `double` field, a 64-bit floating point number.
   */
  double() {
    return this.view.getFloat64((this.pos += 8) - 8, true);
  }
  /**
   * Read a `bytes` field, length-delimited arbitrary data.
   */
  bytes() {
    let len = this.uint32(), start = this.pos;
    this.pos += len;
    this.assertBounds();
    return this.buf.subarray(start, start + len);
  }
  /**
   * Read a `string` field, length-delimited data converted to UTF-8 text. If
   * `strict` is true, throw on invalid UTF-8 instead of substituting U+FFFD.
   */
  string(strict) {
    const bytes = this.bytes();
    const len = bytes.length;
    if (len <= ASCII_MAX_LENGTH) {
      const codes = new Array(len);
      for (let i = 0; i < len; i++) {
        const byte = bytes[i];
        if (byte > 127) {
          return this.decodeUtf8(bytes, strict);
        }
        codes[i] = byte;
      }
      return String.fromCharCode.apply(String, codes);
    }
    return this.decodeUtf8(bytes, strict);
  }
};
function assertInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid int32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > INT32_MAX || arg < INT32_MIN)
    throw new Error("invalid int32: " + arg);
}
function assertUInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid uint32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > UINT32_MAX || arg < 0)
    throw new Error("invalid uint32: " + arg);
}
function assertFloat32(arg) {
  if (typeof arg == "string") {
    const o = arg;
    arg = Number(arg);
    if (Number.isNaN(arg) && o !== "NaN") {
      throw new Error("invalid float32: " + o);
    }
  } else if (typeof arg != "number") {
    throw new Error("invalid float32: " + typeof arg);
  }
  if (!Number.isFinite(Math.fround(arg)) && Number.isFinite(arg)) {
    throw new Error("invalid float32: " + arg);
  }
}

// node_modules/googlevideo/dist/protos/generated/misc/common.js
function createBaseFormatId() {
  return { itag: 0, lastModified: "0", xtags: "" };
}
var FormatId = {
  encode(message, writer = new BinaryWriter()) {
    if (message.itag !== void 0 && message.itag !== 0) {
      writer.uint32(8).int32(message.itag);
    }
    if (message.lastModified !== void 0 && message.lastModified !== "0") {
      writer.uint32(16).uint64(message.lastModified);
    }
    if (message.xtags !== void 0 && message.xtags !== "") {
      writer.uint32(26).string(message.xtags);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseFormatId();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.itag = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.lastModified = reader.uint64().toString();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.xtags = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseRange() {
  return { legacyStart: 0, legacyEnd: 0, start: 0, end: 0 };
}
var Range = {
  encode(message, writer = new BinaryWriter()) {
    if (message.legacyStart !== void 0 && message.legacyStart !== 0) {
      writer.uint32(8).int32(message.legacyStart);
    }
    if (message.legacyEnd !== void 0 && message.legacyEnd !== 0) {
      writer.uint32(16).int32(message.legacyEnd);
    }
    if (message.start !== void 0 && message.start !== 0) {
      writer.uint32(24).int32(message.start);
    }
    if (message.end !== void 0 && message.end !== 0) {
      writer.uint32(32).int32(message.end);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseRange();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.legacyStart = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.legacyEnd = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.start = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.end = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseAuthorizedFormat() {
  return { trackType: 0, isHdr: false };
}
var AuthorizedFormat = {
  encode(message, writer = new BinaryWriter()) {
    if (message.trackType !== void 0 && message.trackType !== 0) {
      writer.uint32(8).int32(message.trackType);
    }
    if (message.isHdr !== void 0 && message.isHdr !== false) {
      writer.uint32(16).bool(message.isHdr);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseAuthorizedFormat();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.trackType = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.isHdr = reader.bool();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBasePlaybackAuthorization() {
  return { authorizedFormats: [], sabrLicenseConstraint: new Uint8Array(0) };
}
var PlaybackAuthorization = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.authorizedFormats) {
      AuthorizedFormat.encode(v, writer.uint32(10).fork()).join();
    }
    if (message.sabrLicenseConstraint !== void 0 && message.sabrLicenseConstraint.length !== 0) {
      writer.uint32(18).bytes(message.sabrLicenseConstraint);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBasePlaybackAuthorization();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.authorizedFormats.push(AuthorizedFormat.decode(reader, reader.uint32()));
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.sabrLicenseConstraint = reader.bytes();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/format_initialization_metadata.js
function createBaseFormatInitializationMetadata() {
  return {
    videoId: "",
    formatId: void 0,
    endTimeMs: "0",
    endSegmentNumber: "0",
    mimeType: "",
    initRange: void 0,
    indexRange: void 0,
    field8: "0",
    durationUnits: "0",
    durationTimescale: "0"
  };
}
var FormatInitializationMetadata = {
  encode(message, writer = new BinaryWriter()) {
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(10).string(message.videoId);
    }
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(18).fork()).join();
    }
    if (message.endTimeMs !== void 0 && message.endTimeMs !== "0") {
      writer.uint32(24).int64(message.endTimeMs);
    }
    if (message.endSegmentNumber !== void 0 && message.endSegmentNumber !== "0") {
      writer.uint32(32).int64(message.endSegmentNumber);
    }
    if (message.mimeType !== void 0 && message.mimeType !== "") {
      writer.uint32(42).string(message.mimeType);
    }
    if (message.initRange !== void 0) {
      Range.encode(message.initRange, writer.uint32(50).fork()).join();
    }
    if (message.indexRange !== void 0) {
      Range.encode(message.indexRange, writer.uint32(58).fork()).join();
    }
    if (message.field8 !== void 0 && message.field8 !== "0") {
      writer.uint32(64).int64(message.field8);
    }
    if (message.durationUnits !== void 0 && message.durationUnits !== "0") {
      writer.uint32(72).int64(message.durationUnits);
    }
    if (message.durationTimescale !== void 0 && message.durationTimescale !== "0") {
      writer.uint32(80).int64(message.durationTimescale);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseFormatInitializationMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.endTimeMs = reader.int64().toString();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.endSegmentNumber = reader.int64().toString();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.mimeType = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.initRange = Range.decode(reader, reader.uint32());
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.indexRange = Range.decode(reader, reader.uint32());
          continue;
        }
        case 8: {
          if (tag !== 64) {
            break;
          }
          message.field8 = reader.int64().toString();
          continue;
        }
        case 9: {
          if (tag !== 72) {
            break;
          }
          message.durationUnits = reader.int64().toString();
          continue;
        }
        case 10: {
          if (tag !== 80) {
            break;
          }
          message.durationTimescale = reader.int64().toString();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/time_range.js
function createBaseTimeRange() {
  return { startTicks: "0", durationTicks: "0", timescale: 0 };
}
var TimeRange = {
  encode(message, writer = new BinaryWriter()) {
    if (message.startTicks !== void 0 && message.startTicks !== "0") {
      writer.uint32(8).int64(message.startTicks);
    }
    if (message.durationTicks !== void 0 && message.durationTicks !== "0") {
      writer.uint32(16).int64(message.durationTicks);
    }
    if (message.timescale !== void 0 && message.timescale !== 0) {
      writer.uint32(24).int32(message.timescale);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseTimeRange();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.startTicks = reader.int64().toString();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.durationTicks = reader.int64().toString();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.timescale = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/media_header.js
function createBaseMediaHeader() {
  return {
    headerId: 0,
    videoId: "",
    itag: 0,
    lmt: "0",
    xtags: "",
    startRange: "0",
    compressionAlgorithm: 0,
    isInitSeg: false,
    sequenceNumber: 0,
    bitrateBps: "0",
    startMs: "0",
    durationMs: "0",
    formatId: void 0,
    contentLength: "0",
    timeRange: void 0,
    sequenceLmt: "0"
  };
}
var MediaHeader = {
  encode(message, writer = new BinaryWriter()) {
    if (message.headerId !== void 0 && message.headerId !== 0) {
      writer.uint32(8).uint32(message.headerId);
    }
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(18).string(message.videoId);
    }
    if (message.itag !== void 0 && message.itag !== 0) {
      writer.uint32(24).int32(message.itag);
    }
    if (message.lmt !== void 0 && message.lmt !== "0") {
      writer.uint32(32).uint64(message.lmt);
    }
    if (message.xtags !== void 0 && message.xtags !== "") {
      writer.uint32(42).string(message.xtags);
    }
    if (message.startRange !== void 0 && message.startRange !== "0") {
      writer.uint32(48).int64(message.startRange);
    }
    if (message.compressionAlgorithm !== void 0 && message.compressionAlgorithm !== 0) {
      writer.uint32(56).int32(message.compressionAlgorithm);
    }
    if (message.isInitSeg !== void 0 && message.isInitSeg !== false) {
      writer.uint32(64).bool(message.isInitSeg);
    }
    if (message.sequenceNumber !== void 0 && message.sequenceNumber !== 0) {
      writer.uint32(72).int32(message.sequenceNumber);
    }
    if (message.bitrateBps !== void 0 && message.bitrateBps !== "0") {
      writer.uint32(80).int64(message.bitrateBps);
    }
    if (message.startMs !== void 0 && message.startMs !== "0") {
      writer.uint32(88).int64(message.startMs);
    }
    if (message.durationMs !== void 0 && message.durationMs !== "0") {
      writer.uint32(96).int64(message.durationMs);
    }
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(106).fork()).join();
    }
    if (message.contentLength !== void 0 && message.contentLength !== "0") {
      writer.uint32(112).int64(message.contentLength);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(122).fork()).join();
    }
    if (message.sequenceLmt !== void 0 && message.sequenceLmt !== "0") {
      writer.uint32(128).uint64(message.sequenceLmt);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.headerId = reader.uint32();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.itag = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.lmt = reader.uint64().toString();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.xtags = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.startRange = reader.int64().toString();
          continue;
        }
        case 7: {
          if (tag !== 56) {
            break;
          }
          message.compressionAlgorithm = reader.int32();
          continue;
        }
        case 8: {
          if (tag !== 64) {
            break;
          }
          message.isInitSeg = reader.bool();
          continue;
        }
        case 9: {
          if (tag !== 72) {
            break;
          }
          message.sequenceNumber = reader.int32();
          continue;
        }
        case 10: {
          if (tag !== 80) {
            break;
          }
          message.bitrateBps = reader.int64().toString();
          continue;
        }
        case 11: {
          if (tag !== 88) {
            break;
          }
          message.startMs = reader.int64().toString();
          continue;
        }
        case 12: {
          if (tag !== 96) {
            break;
          }
          message.durationMs = reader.int64().toString();
          continue;
        }
        case 13: {
          if (tag !== 106) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 14: {
          if (tag !== 112) {
            break;
          }
          message.contentLength = reader.int64().toString();
          continue;
        }
        case 15: {
          if (tag !== 122) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 16: {
          if (tag !== 128) {
            break;
          }
          message.sequenceLmt = reader.uint64().toString();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/buffered_range.js
function createBaseBufferedRange() {
  return {
    formatId: void 0,
    startTimeMs: "0",
    durationMs: "0",
    startSegmentIndex: 0,
    endSegmentIndex: 0,
    timeRange: void 0,
    field9: void 0,
    field11: void 0,
    field12: void 0
  };
}
var BufferedRange = {
  encode(message, writer = new BinaryWriter()) {
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(10).fork()).join();
    }
    if (message.startTimeMs !== "0") {
      writer.uint32(16).int64(message.startTimeMs);
    }
    if (message.durationMs !== "0") {
      writer.uint32(24).int64(message.durationMs);
    }
    if (message.startSegmentIndex !== 0) {
      writer.uint32(32).int32(message.startSegmentIndex);
    }
    if (message.endSegmentIndex !== 0) {
      writer.uint32(40).int32(message.endSegmentIndex);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(50).fork()).join();
    }
    if (message.field9 !== void 0) {
      BufferedRange_UnknownMessage1.encode(message.field9, writer.uint32(74).fork()).join();
    }
    if (message.field11 !== void 0) {
      BufferedRange_UnknownMessage2.encode(message.field11, writer.uint32(90).fork()).join();
    }
    if (message.field12 !== void 0) {
      BufferedRange_UnknownMessage2.encode(message.field12, writer.uint32(98).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.startTimeMs = reader.int64().toString();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.durationMs = reader.int64().toString();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.startSegmentIndex = reader.int32();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.endSegmentIndex = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 9: {
          if (tag !== 74) {
            break;
          }
          message.field9 = BufferedRange_UnknownMessage1.decode(reader, reader.uint32());
          continue;
        }
        case 11: {
          if (tag !== 90) {
            break;
          }
          message.field11 = BufferedRange_UnknownMessage2.decode(reader, reader.uint32());
          continue;
        }
        case 12: {
          if (tag !== 98) {
            break;
          }
          message.field12 = BufferedRange_UnknownMessage2.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseBufferedRange_UnknownMessage1() {
  return { field1: [] };
}
var BufferedRange_UnknownMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.field1) {
      BufferedRange_UnknownMessage1_UnknownInnerMessage.encode(v, writer.uint32(10).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange_UnknownMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.field1.push(BufferedRange_UnknownMessage1_UnknownInnerMessage.decode(reader, reader.uint32()));
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseBufferedRange_UnknownMessage1_UnknownInnerMessage() {
  return { videoId: "", lmt: "0" };
}
var BufferedRange_UnknownMessage1_UnknownInnerMessage = {
  encode(message, writer = new BinaryWriter()) {
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(10).string(message.videoId);
    }
    if (message.lmt !== void 0 && message.lmt !== "0") {
      writer.uint32(16).uint64(message.lmt);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange_UnknownMessage1_UnknownInnerMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.lmt = reader.uint64().toString();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseBufferedRange_UnknownMessage2() {
  return { field1: 0, field2: 0, field3: 0 };
}
var BufferedRange_UnknownMessage2 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.field1 !== void 0 && message.field1 !== 0) {
      writer.uint32(8).int32(message.field1);
    }
    if (message.field2 !== void 0 && message.field2 !== 0) {
      writer.uint32(16).int32(message.field2);
    }
    if (message.field3 !== void 0 && message.field3 !== 0) {
      writer.uint32(24).int32(message.field3);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange_UnknownMessage2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.field1 = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.field2 = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.field3 = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/media_capabilities.js
function createBaseMediaCapabilities() {
  return { videoFormatCapabilities: [], audioFormatCapabilities: [], hdrModeBitmask: 0 };
}
var MediaCapabilities = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.videoFormatCapabilities) {
      MediaCapabilities_VideoFormatCapability.encode(v, writer.uint32(10).fork()).join();
    }
    for (const v of message.audioFormatCapabilities) {
      MediaCapabilities_AudioFormatCapability.encode(v, writer.uint32(18).fork()).join();
    }
    if (message.hdrModeBitmask !== void 0 && message.hdrModeBitmask !== 0) {
      writer.uint32(40).int32(message.hdrModeBitmask);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaCapabilities();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.videoFormatCapabilities.push(MediaCapabilities_VideoFormatCapability.decode(reader, reader.uint32()));
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.audioFormatCapabilities.push(MediaCapabilities_AudioFormatCapability.decode(reader, reader.uint32()));
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.hdrModeBitmask = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseMediaCapabilities_VideoFormatCapability() {
  return { videoCodec: 0, maxHeight: 0, maxWidth: 0, maxFramerate: 0, maxBitrateBps: 0, is10BitSupported: false };
}
var MediaCapabilities_VideoFormatCapability = {
  encode(message, writer = new BinaryWriter()) {
    if (message.videoCodec !== void 0 && message.videoCodec !== 0) {
      writer.uint32(8).int32(message.videoCodec);
    }
    if (message.maxHeight !== void 0 && message.maxHeight !== 0) {
      writer.uint32(24).int32(message.maxHeight);
    }
    if (message.maxWidth !== void 0 && message.maxWidth !== 0) {
      writer.uint32(32).int32(message.maxWidth);
    }
    if (message.maxFramerate !== void 0 && message.maxFramerate !== 0) {
      writer.uint32(88).int32(message.maxFramerate);
    }
    if (message.maxBitrateBps !== void 0 && message.maxBitrateBps !== 0) {
      writer.uint32(96).int32(message.maxBitrateBps);
    }
    if (message.is10BitSupported !== void 0 && message.is10BitSupported !== false) {
      writer.uint32(120).bool(message.is10BitSupported);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaCapabilities_VideoFormatCapability();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.videoCodec = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.maxHeight = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.maxWidth = reader.int32();
          continue;
        }
        case 11: {
          if (tag !== 88) {
            break;
          }
          message.maxFramerate = reader.int32();
          continue;
        }
        case 12: {
          if (tag !== 96) {
            break;
          }
          message.maxBitrateBps = reader.int32();
          continue;
        }
        case 15: {
          if (tag !== 120) {
            break;
          }
          message.is10BitSupported = reader.bool();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseMediaCapabilities_AudioFormatCapability() {
  return { audioCodec: 0, numChannels: 0, maxBitrateBps: 0, spatialCapabilityBitmask: 0 };
}
var MediaCapabilities_AudioFormatCapability = {
  encode(message, writer = new BinaryWriter()) {
    if (message.audioCodec !== void 0 && message.audioCodec !== 0) {
      writer.uint32(8).int32(message.audioCodec);
    }
    if (message.numChannels !== void 0 && message.numChannels !== 0) {
      writer.uint32(16).int32(message.numChannels);
    }
    if (message.maxBitrateBps !== void 0 && message.maxBitrateBps !== 0) {
      writer.uint32(24).int32(message.maxBitrateBps);
    }
    if (message.spatialCapabilityBitmask !== void 0 && message.spatialCapabilityBitmask !== 0) {
      writer.uint32(48).int32(message.spatialCapabilityBitmask);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaCapabilities_AudioFormatCapability();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.audioCodec = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.numChannels = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.maxBitrateBps = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.spatialCapabilityBitmask = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/playback_cookie.js
function createBasePlaybackCookie() {
  return { resolution: 0, field2: 0, videoFmt: void 0, audioFmt: void 0 };
}
var PlaybackCookie = {
  encode(message, writer = new BinaryWriter()) {
    if (message.resolution !== void 0 && message.resolution !== 0) {
      writer.uint32(8).int32(message.resolution);
    }
    if (message.field2 !== void 0 && message.field2 !== 0) {
      writer.uint32(16).int32(message.field2);
    }
    if (message.videoFmt !== void 0) {
      FormatId.encode(message.videoFmt, writer.uint32(58).fork()).join();
    }
    if (message.audioFmt !== void 0) {
      FormatId.encode(message.audioFmt, writer.uint32(66).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBasePlaybackCookie();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.resolution = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.field2 = reader.int32();
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.videoFmt = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.audioFmt = FormatId.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/client_abr_state.js
function createBaseClientAbrState() {
  return {
    timeSinceLastManualFormatSelectionMs: "0",
    lastManualDirection: 0,
    lastManualSelectedResolution: 0,
    detailedNetworkType: 0,
    clientViewportWidth: 0,
    clientViewportHeight: 0,
    clientBitrateCapBytesPerSec: "0",
    stickyResolution: 0,
    clientViewportIsFlexible: false,
    bandwidthEstimate: "0",
    minAudioQuality: 0,
    maxAudioQuality: 0,
    videoQualitySetting: 0,
    audioRoute: 0,
    playerTimeMs: "0",
    timeSinceLastSeek: "0",
    dataSaverMode: false,
    networkMeteredState: 0,
    visibility: 0,
    playbackRate: 0,
    elapsedWallTimeMs: "0",
    mediaCapabilities: void 0,
    timeSinceLastActionMs: "0",
    enabledTrackTypesBitfield: 0,
    maxPacingRate: 0,
    playerState: "0",
    drcEnabled: false,
    field48: 0,
    field50: 0,
    field51: 0,
    sabrReportRequestCancellationInfo: 0,
    disableStreamingXhr: false,
    field57: "0",
    preferVp9: false,
    av1QualityThreshold: 0,
    field60: 0,
    isPrefetch: false,
    sabrSupportQualityConstraints: false,
    sabrLicenseConstraint: new Uint8Array(0),
    allowProximaLiveLatency: 0,
    sabrForceProxima: 0,
    field67: 0,
    sabrForceMaxNetworkInterruptionDurationMs: "0",
    audioTrackId: "",
    enableVoiceBoost: false,
    playbackAuthorization: void 0
  };
}
var ClientAbrState = {
  encode(message, writer = new BinaryWriter()) {
    if (message.timeSinceLastManualFormatSelectionMs !== void 0 && message.timeSinceLastManualFormatSelectionMs !== "0") {
      writer.uint32(104).int64(message.timeSinceLastManualFormatSelectionMs);
    }
    if (message.lastManualDirection !== void 0 && message.lastManualDirection !== 0) {
      writer.uint32(112).sint32(message.lastManualDirection);
    }
    if (message.lastManualSelectedResolution !== void 0 && message.lastManualSelectedResolution !== 0) {
      writer.uint32(128).int32(message.lastManualSelectedResolution);
    }
    if (message.detailedNetworkType !== void 0 && message.detailedNetworkType !== 0) {
      writer.uint32(136).int32(message.detailedNetworkType);
    }
    if (message.clientViewportWidth !== void 0 && message.clientViewportWidth !== 0) {
      writer.uint32(144).int32(message.clientViewportWidth);
    }
    if (message.clientViewportHeight !== void 0 && message.clientViewportHeight !== 0) {
      writer.uint32(152).int32(message.clientViewportHeight);
    }
    if (message.clientBitrateCapBytesPerSec !== void 0 && message.clientBitrateCapBytesPerSec !== "0") {
      writer.uint32(160).int64(message.clientBitrateCapBytesPerSec);
    }
    if (message.stickyResolution !== void 0 && message.stickyResolution !== 0) {
      writer.uint32(168).int32(message.stickyResolution);
    }
    if (message.clientViewportIsFlexible !== void 0 && message.clientViewportIsFlexible !== false) {
      writer.uint32(176).bool(message.clientViewportIsFlexible);
    }
    if (message.bandwidthEstimate !== void 0 && message.bandwidthEstimate !== "0") {
      writer.uint32(184).int64(message.bandwidthEstimate);
    }
    if (message.minAudioQuality !== void 0 && message.minAudioQuality !== 0) {
      writer.uint32(192).int32(message.minAudioQuality);
    }
    if (message.maxAudioQuality !== void 0 && message.maxAudioQuality !== 0) {
      writer.uint32(200).int32(message.maxAudioQuality);
    }
    if (message.videoQualitySetting !== void 0 && message.videoQualitySetting !== 0) {
      writer.uint32(208).int32(message.videoQualitySetting);
    }
    if (message.audioRoute !== void 0 && message.audioRoute !== 0) {
      writer.uint32(216).int32(message.audioRoute);
    }
    if (message.playerTimeMs !== void 0 && message.playerTimeMs !== "0") {
      writer.uint32(224).int64(message.playerTimeMs);
    }
    if (message.timeSinceLastSeek !== void 0 && message.timeSinceLastSeek !== "0") {
      writer.uint32(232).int64(message.timeSinceLastSeek);
    }
    if (message.dataSaverMode !== void 0 && message.dataSaverMode !== false) {
      writer.uint32(240).bool(message.dataSaverMode);
    }
    if (message.networkMeteredState !== void 0 && message.networkMeteredState !== 0) {
      writer.uint32(256).int32(message.networkMeteredState);
    }
    if (message.visibility !== void 0 && message.visibility !== 0) {
      writer.uint32(272).int32(message.visibility);
    }
    if (message.playbackRate !== void 0 && message.playbackRate !== 0) {
      writer.uint32(285).float(message.playbackRate);
    }
    if (message.elapsedWallTimeMs !== void 0 && message.elapsedWallTimeMs !== "0") {
      writer.uint32(288).int64(message.elapsedWallTimeMs);
    }
    if (message.mediaCapabilities !== void 0) {
      MediaCapabilities.encode(message.mediaCapabilities, writer.uint32(306).fork()).join();
    }
    if (message.timeSinceLastActionMs !== void 0 && message.timeSinceLastActionMs !== "0") {
      writer.uint32(312).int64(message.timeSinceLastActionMs);
    }
    if (message.enabledTrackTypesBitfield !== void 0 && message.enabledTrackTypesBitfield !== 0) {
      writer.uint32(320).int32(message.enabledTrackTypesBitfield);
    }
    if (message.maxPacingRate !== void 0 && message.maxPacingRate !== 0) {
      writer.uint32(344).int32(message.maxPacingRate);
    }
    if (message.playerState !== void 0 && message.playerState !== "0") {
      writer.uint32(352).int64(message.playerState);
    }
    if (message.drcEnabled !== void 0 && message.drcEnabled !== false) {
      writer.uint32(368).bool(message.drcEnabled);
    }
    if (message.field48 !== void 0 && message.field48 !== 0) {
      writer.uint32(384).int32(message.field48);
    }
    if (message.field50 !== void 0 && message.field50 !== 0) {
      writer.uint32(400).int32(message.field50);
    }
    if (message.field51 !== void 0 && message.field51 !== 0) {
      writer.uint32(408).int32(message.field51);
    }
    if (message.sabrReportRequestCancellationInfo !== void 0 && message.sabrReportRequestCancellationInfo !== 0) {
      writer.uint32(432).int32(message.sabrReportRequestCancellationInfo);
    }
    if (message.disableStreamingXhr !== void 0 && message.disableStreamingXhr !== false) {
      writer.uint32(448).bool(message.disableStreamingXhr);
    }
    if (message.field57 !== void 0 && message.field57 !== "0") {
      writer.uint32(456).int64(message.field57);
    }
    if (message.preferVp9 !== void 0 && message.preferVp9 !== false) {
      writer.uint32(464).bool(message.preferVp9);
    }
    if (message.av1QualityThreshold !== void 0 && message.av1QualityThreshold !== 0) {
      writer.uint32(472).int32(message.av1QualityThreshold);
    }
    if (message.field60 !== void 0 && message.field60 !== 0) {
      writer.uint32(480).int32(message.field60);
    }
    if (message.isPrefetch !== void 0 && message.isPrefetch !== false) {
      writer.uint32(488).bool(message.isPrefetch);
    }
    if (message.sabrSupportQualityConstraints !== void 0 && message.sabrSupportQualityConstraints !== false) {
      writer.uint32(496).bool(message.sabrSupportQualityConstraints);
    }
    if (message.sabrLicenseConstraint !== void 0 && message.sabrLicenseConstraint.length !== 0) {
      writer.uint32(506).bytes(message.sabrLicenseConstraint);
    }
    if (message.allowProximaLiveLatency !== void 0 && message.allowProximaLiveLatency !== 0) {
      writer.uint32(512).int32(message.allowProximaLiveLatency);
    }
    if (message.sabrForceProxima !== void 0 && message.sabrForceProxima !== 0) {
      writer.uint32(528).int32(message.sabrForceProxima);
    }
    if (message.field67 !== void 0 && message.field67 !== 0) {
      writer.uint32(536).int32(message.field67);
    }
    if (message.sabrForceMaxNetworkInterruptionDurationMs !== void 0 && message.sabrForceMaxNetworkInterruptionDurationMs !== "0") {
      writer.uint32(544).int64(message.sabrForceMaxNetworkInterruptionDurationMs);
    }
    if (message.audioTrackId !== void 0 && message.audioTrackId !== "") {
      writer.uint32(554).string(message.audioTrackId);
    }
    if (message.enableVoiceBoost !== void 0 && message.enableVoiceBoost !== false) {
      writer.uint32(608).bool(message.enableVoiceBoost);
    }
    if (message.playbackAuthorization !== void 0) {
      PlaybackAuthorization.encode(message.playbackAuthorization, writer.uint32(634).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseClientAbrState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 13: {
          if (tag !== 104) {
            break;
          }
          message.timeSinceLastManualFormatSelectionMs = reader.int64().toString();
          continue;
        }
        case 14: {
          if (tag !== 112) {
            break;
          }
          message.lastManualDirection = reader.sint32();
          continue;
        }
        case 16: {
          if (tag !== 128) {
            break;
          }
          message.lastManualSelectedResolution = reader.int32();
          continue;
        }
        case 17: {
          if (tag !== 136) {
            break;
          }
          message.detailedNetworkType = reader.int32();
          continue;
        }
        case 18: {
          if (tag !== 144) {
            break;
          }
          message.clientViewportWidth = reader.int32();
          continue;
        }
        case 19: {
          if (tag !== 152) {
            break;
          }
          message.clientViewportHeight = reader.int32();
          continue;
        }
        case 20: {
          if (tag !== 160) {
            break;
          }
          message.clientBitrateCapBytesPerSec = reader.int64().toString();
          continue;
        }
        case 21: {
          if (tag !== 168) {
            break;
          }
          message.stickyResolution = reader.int32();
          continue;
        }
        case 22: {
          if (tag !== 176) {
            break;
          }
          message.clientViewportIsFlexible = reader.bool();
          continue;
        }
        case 23: {
          if (tag !== 184) {
            break;
          }
          message.bandwidthEstimate = reader.int64().toString();
          continue;
        }
        case 24: {
          if (tag !== 192) {
            break;
          }
          message.minAudioQuality = reader.int32();
          continue;
        }
        case 25: {
          if (tag !== 200) {
            break;
          }
          message.maxAudioQuality = reader.int32();
          continue;
        }
        case 26: {
          if (tag !== 208) {
            break;
          }
          message.videoQualitySetting = reader.int32();
          continue;
        }
        case 27: {
          if (tag !== 216) {
            break;
          }
          message.audioRoute = reader.int32();
          continue;
        }
        case 28: {
          if (tag !== 224) {
            break;
          }
          message.playerTimeMs = reader.int64().toString();
          continue;
        }
        case 29: {
          if (tag !== 232) {
            break;
          }
          message.timeSinceLastSeek = reader.int64().toString();
          continue;
        }
        case 30: {
          if (tag !== 240) {
            break;
          }
          message.dataSaverMode = reader.bool();
          continue;
        }
        case 32: {
          if (tag !== 256) {
            break;
          }
          message.networkMeteredState = reader.int32();
          continue;
        }
        case 34: {
          if (tag !== 272) {
            break;
          }
          message.visibility = reader.int32();
          continue;
        }
        case 35: {
          if (tag !== 285) {
            break;
          }
          message.playbackRate = reader.float();
          continue;
        }
        case 36: {
          if (tag !== 288) {
            break;
          }
          message.elapsedWallTimeMs = reader.int64().toString();
          continue;
        }
        case 38: {
          if (tag !== 306) {
            break;
          }
          message.mediaCapabilities = MediaCapabilities.decode(reader, reader.uint32());
          continue;
        }
        case 39: {
          if (tag !== 312) {
            break;
          }
          message.timeSinceLastActionMs = reader.int64().toString();
          continue;
        }
        case 40: {
          if (tag !== 320) {
            break;
          }
          message.enabledTrackTypesBitfield = reader.int32();
          continue;
        }
        case 43: {
          if (tag !== 344) {
            break;
          }
          message.maxPacingRate = reader.int32();
          continue;
        }
        case 44: {
          if (tag !== 352) {
            break;
          }
          message.playerState = reader.int64().toString();
          continue;
        }
        case 46: {
          if (tag !== 368) {
            break;
          }
          message.drcEnabled = reader.bool();
          continue;
        }
        case 48: {
          if (tag !== 384) {
            break;
          }
          message.field48 = reader.int32();
          continue;
        }
        case 50: {
          if (tag !== 400) {
            break;
          }
          message.field50 = reader.int32();
          continue;
        }
        case 51: {
          if (tag !== 408) {
            break;
          }
          message.field51 = reader.int32();
          continue;
        }
        case 54: {
          if (tag !== 432) {
            break;
          }
          message.sabrReportRequestCancellationInfo = reader.int32();
          continue;
        }
        case 56: {
          if (tag !== 448) {
            break;
          }
          message.disableStreamingXhr = reader.bool();
          continue;
        }
        case 57: {
          if (tag !== 456) {
            break;
          }
          message.field57 = reader.int64().toString();
          continue;
        }
        case 58: {
          if (tag !== 464) {
            break;
          }
          message.preferVp9 = reader.bool();
          continue;
        }
        case 59: {
          if (tag !== 472) {
            break;
          }
          message.av1QualityThreshold = reader.int32();
          continue;
        }
        case 60: {
          if (tag !== 480) {
            break;
          }
          message.field60 = reader.int32();
          continue;
        }
        case 61: {
          if (tag !== 488) {
            break;
          }
          message.isPrefetch = reader.bool();
          continue;
        }
        case 62: {
          if (tag !== 496) {
            break;
          }
          message.sabrSupportQualityConstraints = reader.bool();
          continue;
        }
        case 63: {
          if (tag !== 506) {
            break;
          }
          message.sabrLicenseConstraint = reader.bytes();
          continue;
        }
        case 64: {
          if (tag !== 512) {
            break;
          }
          message.allowProximaLiveLatency = reader.int32();
          continue;
        }
        case 66: {
          if (tag !== 528) {
            break;
          }
          message.sabrForceProxima = reader.int32();
          continue;
        }
        case 67: {
          if (tag !== 536) {
            break;
          }
          message.field67 = reader.int32();
          continue;
        }
        case 68: {
          if (tag !== 544) {
            break;
          }
          message.sabrForceMaxNetworkInterruptionDurationMs = reader.int64().toString();
          continue;
        }
        case 69: {
          if (tag !== 554) {
            break;
          }
          message.audioTrackId = reader.string();
          continue;
        }
        case 76: {
          if (tag !== 608) {
            break;
          }
          message.enableVoiceBoost = reader.bool();
          continue;
        }
        case 79: {
          if (tag !== 634) {
            break;
          }
          message.playbackAuthorization = PlaybackAuthorization.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/streamer_context.js
function createBaseStreamerContext() {
  return {
    clientInfo: void 0,
    poToken: new Uint8Array(0),
    playbackCookie: new Uint8Array(0),
    field4: new Uint8Array(0),
    sabrContexts: [],
    unsentSabrContexts: [],
    field7: "",
    field8: void 0
  };
}
var StreamerContext = {
  encode(message, writer = new BinaryWriter()) {
    if (message.clientInfo !== void 0) {
      StreamerContext_ClientInfo.encode(message.clientInfo, writer.uint32(10).fork()).join();
    }
    if (message.poToken !== void 0 && message.poToken.length !== 0) {
      writer.uint32(18).bytes(message.poToken);
    }
    if (message.playbackCookie !== void 0 && message.playbackCookie.length !== 0) {
      writer.uint32(26).bytes(message.playbackCookie);
    }
    if (message.field4 !== void 0 && message.field4.length !== 0) {
      writer.uint32(34).bytes(message.field4);
    }
    for (const v of message.sabrContexts) {
      StreamerContext_SabrContext.encode(v, writer.uint32(42).fork()).join();
    }
    writer.uint32(50).fork();
    for (const v of message.unsentSabrContexts) {
      writer.int32(v);
    }
    writer.join();
    if (message.field7 !== void 0 && message.field7 !== "") {
      writer.uint32(58).string(message.field7);
    }
    if (message.field8 !== void 0) {
      StreamerContext_UnknownMessage1.encode(message.field8, writer.uint32(66).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.clientInfo = StreamerContext_ClientInfo.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.poToken = reader.bytes();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.playbackCookie = reader.bytes();
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }
          message.field4 = reader.bytes();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.sabrContexts.push(StreamerContext_SabrContext.decode(reader, reader.uint32()));
          continue;
        }
        case 6: {
          if (tag === 48) {
            message.unsentSabrContexts.push(reader.int32());
            continue;
          }
          if (tag === 50) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.unsentSabrContexts.push(reader.int32());
            }
            continue;
          }
          break;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.field7 = reader.string();
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.field8 = StreamerContext_UnknownMessage1.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_ClientInfo() {
  return {
    deviceMake: "",
    deviceModel: "",
    clientName: 0,
    clientVersion: "",
    osName: "",
    osVersion: "",
    acceptLanguage: "",
    acceptRegion: "",
    screenWidthPoints: 0,
    screenHeightPoints: 0,
    screenWidthInches: 0,
    screenHeightInches: 0,
    screenPixelDensity: 0,
    clientFormFactor: 0,
    gmscoreVersionCode: 0,
    windowWidthPoints: 0,
    windowHeightPoints: 0,
    androidSdkVersion: 0,
    screenDensityFloat: 0,
    utcOffsetMinutes: "0",
    timeZone: "",
    chipset: "",
    glDeviceInfo: void 0
  };
}
var StreamerContext_ClientInfo = {
  encode(message, writer = new BinaryWriter()) {
    if (message.deviceMake !== void 0 && message.deviceMake !== "") {
      writer.uint32(98).string(message.deviceMake);
    }
    if (message.deviceModel !== void 0 && message.deviceModel !== "") {
      writer.uint32(106).string(message.deviceModel);
    }
    if (message.clientName !== void 0 && message.clientName !== 0) {
      writer.uint32(128).int32(message.clientName);
    }
    if (message.clientVersion !== void 0 && message.clientVersion !== "") {
      writer.uint32(138).string(message.clientVersion);
    }
    if (message.osName !== void 0 && message.osName !== "") {
      writer.uint32(146).string(message.osName);
    }
    if (message.osVersion !== void 0 && message.osVersion !== "") {
      writer.uint32(154).string(message.osVersion);
    }
    if (message.acceptLanguage !== void 0 && message.acceptLanguage !== "") {
      writer.uint32(170).string(message.acceptLanguage);
    }
    if (message.acceptRegion !== void 0 && message.acceptRegion !== "") {
      writer.uint32(178).string(message.acceptRegion);
    }
    if (message.screenWidthPoints !== void 0 && message.screenWidthPoints !== 0) {
      writer.uint32(296).int32(message.screenWidthPoints);
    }
    if (message.screenHeightPoints !== void 0 && message.screenHeightPoints !== 0) {
      writer.uint32(304).int32(message.screenHeightPoints);
    }
    if (message.screenWidthInches !== void 0 && message.screenWidthInches !== 0) {
      writer.uint32(317).float(message.screenWidthInches);
    }
    if (message.screenHeightInches !== void 0 && message.screenHeightInches !== 0) {
      writer.uint32(325).float(message.screenHeightInches);
    }
    if (message.screenPixelDensity !== void 0 && message.screenPixelDensity !== 0) {
      writer.uint32(328).int32(message.screenPixelDensity);
    }
    if (message.clientFormFactor !== void 0 && message.clientFormFactor !== 0) {
      writer.uint32(368).int32(message.clientFormFactor);
    }
    if (message.gmscoreVersionCode !== void 0 && message.gmscoreVersionCode !== 0) {
      writer.uint32(400).int32(message.gmscoreVersionCode);
    }
    if (message.windowWidthPoints !== void 0 && message.windowWidthPoints !== 0) {
      writer.uint32(440).int32(message.windowWidthPoints);
    }
    if (message.windowHeightPoints !== void 0 && message.windowHeightPoints !== 0) {
      writer.uint32(448).int32(message.windowHeightPoints);
    }
    if (message.androidSdkVersion !== void 0 && message.androidSdkVersion !== 0) {
      writer.uint32(512).int32(message.androidSdkVersion);
    }
    if (message.screenDensityFloat !== void 0 && message.screenDensityFloat !== 0) {
      writer.uint32(525).float(message.screenDensityFloat);
    }
    if (message.utcOffsetMinutes !== void 0 && message.utcOffsetMinutes !== "0") {
      writer.uint32(536).int64(message.utcOffsetMinutes);
    }
    if (message.timeZone !== void 0 && message.timeZone !== "") {
      writer.uint32(642).string(message.timeZone);
    }
    if (message.chipset !== void 0 && message.chipset !== "") {
      writer.uint32(738).string(message.chipset);
    }
    if (message.glDeviceInfo !== void 0) {
      StreamerContext_GLDeviceInfo.encode(message.glDeviceInfo, writer.uint32(818).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_ClientInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 12: {
          if (tag !== 98) {
            break;
          }
          message.deviceMake = reader.string();
          continue;
        }
        case 13: {
          if (tag !== 106) {
            break;
          }
          message.deviceModel = reader.string();
          continue;
        }
        case 16: {
          if (tag !== 128) {
            break;
          }
          message.clientName = reader.int32();
          continue;
        }
        case 17: {
          if (tag !== 138) {
            break;
          }
          message.clientVersion = reader.string();
          continue;
        }
        case 18: {
          if (tag !== 146) {
            break;
          }
          message.osName = reader.string();
          continue;
        }
        case 19: {
          if (tag !== 154) {
            break;
          }
          message.osVersion = reader.string();
          continue;
        }
        case 21: {
          if (tag !== 170) {
            break;
          }
          message.acceptLanguage = reader.string();
          continue;
        }
        case 22: {
          if (tag !== 178) {
            break;
          }
          message.acceptRegion = reader.string();
          continue;
        }
        case 37: {
          if (tag !== 296) {
            break;
          }
          message.screenWidthPoints = reader.int32();
          continue;
        }
        case 38: {
          if (tag !== 304) {
            break;
          }
          message.screenHeightPoints = reader.int32();
          continue;
        }
        case 39: {
          if (tag !== 317) {
            break;
          }
          message.screenWidthInches = reader.float();
          continue;
        }
        case 40: {
          if (tag !== 325) {
            break;
          }
          message.screenHeightInches = reader.float();
          continue;
        }
        case 41: {
          if (tag !== 328) {
            break;
          }
          message.screenPixelDensity = reader.int32();
          continue;
        }
        case 46: {
          if (tag !== 368) {
            break;
          }
          message.clientFormFactor = reader.int32();
          continue;
        }
        case 50: {
          if (tag !== 400) {
            break;
          }
          message.gmscoreVersionCode = reader.int32();
          continue;
        }
        case 55: {
          if (tag !== 440) {
            break;
          }
          message.windowWidthPoints = reader.int32();
          continue;
        }
        case 56: {
          if (tag !== 448) {
            break;
          }
          message.windowHeightPoints = reader.int32();
          continue;
        }
        case 64: {
          if (tag !== 512) {
            break;
          }
          message.androidSdkVersion = reader.int32();
          continue;
        }
        case 65: {
          if (tag !== 525) {
            break;
          }
          message.screenDensityFloat = reader.float();
          continue;
        }
        case 67: {
          if (tag !== 536) {
            break;
          }
          message.utcOffsetMinutes = reader.int64().toString();
          continue;
        }
        case 80: {
          if (tag !== 642) {
            break;
          }
          message.timeZone = reader.string();
          continue;
        }
        case 92: {
          if (tag !== 738) {
            break;
          }
          message.chipset = reader.string();
          continue;
        }
        case 102: {
          if (tag !== 818) {
            break;
          }
          message.glDeviceInfo = StreamerContext_GLDeviceInfo.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_GLDeviceInfo() {
  return { glRenderer: "", glEsVersionMajor: 0, glEsVersionMinor: 0 };
}
var StreamerContext_GLDeviceInfo = {
  encode(message, writer = new BinaryWriter()) {
    if (message.glRenderer !== void 0 && message.glRenderer !== "") {
      writer.uint32(10).string(message.glRenderer);
    }
    if (message.glEsVersionMajor !== void 0 && message.glEsVersionMajor !== 0) {
      writer.uint32(16).int32(message.glEsVersionMajor);
    }
    if (message.glEsVersionMinor !== void 0 && message.glEsVersionMinor !== 0) {
      writer.uint32(24).int32(message.glEsVersionMinor);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_GLDeviceInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.glRenderer = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.glEsVersionMajor = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.glEsVersionMinor = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_SabrContext() {
  return { type: 0, value: new Uint8Array(0) };
}
var StreamerContext_SabrContext = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== 0) {
      writer.uint32(8).int32(message.type);
    }
    if (message.value !== void 0 && message.value.length !== 0) {
      writer.uint32(18).bytes(message.value);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_SabrContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.type = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.value = reader.bytes();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_UnknownMessage1() {
  return { field1: new Uint8Array(0), field2: void 0 };
}
var StreamerContext_UnknownMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.field1 !== void 0 && message.field1.length !== 0) {
      writer.uint32(10).bytes(message.field1);
    }
    if (message.field2 !== void 0) {
      StreamerContext_UnknownMessage1_UnknownInnerMessage1.encode(message.field2, writer.uint32(18).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_UnknownMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.field1 = reader.bytes();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.field2 = StreamerContext_UnknownMessage1_UnknownInnerMessage1.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_UnknownMessage1_UnknownInnerMessage1() {
  return { code: 0, message: "" };
}
var StreamerContext_UnknownMessage1_UnknownInnerMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.code !== void 0 && message.code !== 0) {
      writer.uint32(8).int32(message.code);
    }
    if (message.message !== void 0 && message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_UnknownMessage1_UnknownInnerMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.code = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.message = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/video_playback_abr_request.js
function createBaseVideoPlaybackAbrRequest() {
  return {
    clientAbrState: void 0,
    selectedFormatIds: [],
    bufferedRanges: [],
    playerTimeMs: "0",
    videoPlaybackUstreamerConfig: new Uint8Array(0),
    field6: void 0,
    preferredAudioFormatIds: [],
    preferredVideoFormatIds: [],
    preferredSubtitleFormatIds: [],
    streamerContext: void 0,
    field21: void 0,
    field22: 0,
    field23: 0,
    field1000: []
  };
}
var VideoPlaybackAbrRequest = {
  encode(message, writer = new BinaryWriter()) {
    if (message.clientAbrState !== void 0) {
      ClientAbrState.encode(message.clientAbrState, writer.uint32(10).fork()).join();
    }
    for (const v of message.selectedFormatIds) {
      FormatId.encode(v, writer.uint32(18).fork()).join();
    }
    for (const v of message.bufferedRanges) {
      BufferedRange.encode(v, writer.uint32(26).fork()).join();
    }
    if (message.playerTimeMs !== void 0 && message.playerTimeMs !== "0") {
      writer.uint32(32).int64(message.playerTimeMs);
    }
    if (message.videoPlaybackUstreamerConfig !== void 0 && message.videoPlaybackUstreamerConfig.length !== 0) {
      writer.uint32(42).bytes(message.videoPlaybackUstreamerConfig);
    }
    if (message.field6 !== void 0) {
      UnknownMessage1.encode(message.field6, writer.uint32(50).fork()).join();
    }
    for (const v of message.preferredAudioFormatIds) {
      FormatId.encode(v, writer.uint32(130).fork()).join();
    }
    for (const v of message.preferredVideoFormatIds) {
      FormatId.encode(v, writer.uint32(138).fork()).join();
    }
    for (const v of message.preferredSubtitleFormatIds) {
      FormatId.encode(v, writer.uint32(146).fork()).join();
    }
    if (message.streamerContext !== void 0) {
      StreamerContext.encode(message.streamerContext, writer.uint32(154).fork()).join();
    }
    if (message.field21 !== void 0) {
      UnknownMessage2.encode(message.field21, writer.uint32(170).fork()).join();
    }
    if (message.field22 !== void 0 && message.field22 !== 0) {
      writer.uint32(176).int32(message.field22);
    }
    if (message.field23 !== void 0 && message.field23 !== 0) {
      writer.uint32(184).int32(message.field23);
    }
    for (const v of message.field1000) {
      UnknownMessage3.encode(v, writer.uint32(8002).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseVideoPlaybackAbrRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.clientAbrState = ClientAbrState.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.selectedFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.bufferedRanges.push(BufferedRange.decode(reader, reader.uint32()));
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.playerTimeMs = reader.int64().toString();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.videoPlaybackUstreamerConfig = reader.bytes();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.field6 = UnknownMessage1.decode(reader, reader.uint32());
          continue;
        }
        case 16: {
          if (tag !== 130) {
            break;
          }
          message.preferredAudioFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 17: {
          if (tag !== 138) {
            break;
          }
          message.preferredVideoFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 18: {
          if (tag !== 146) {
            break;
          }
          message.preferredSubtitleFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 19: {
          if (tag !== 154) {
            break;
          }
          message.streamerContext = StreamerContext.decode(reader, reader.uint32());
          continue;
        }
        case 21: {
          if (tag !== 170) {
            break;
          }
          message.field21 = UnknownMessage2.decode(reader, reader.uint32());
          continue;
        }
        case 22: {
          if (tag !== 176) {
            break;
          }
          message.field22 = reader.int32();
          continue;
        }
        case 23: {
          if (tag !== 184) {
            break;
          }
          message.field23 = reader.int32();
          continue;
        }
        case 1e3: {
          if (tag !== 8002) {
            break;
          }
          message.field1000.push(UnknownMessage3.decode(reader, reader.uint32()));
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseUnknownMessage1() {
  return { formatId: void 0, lmt: "0", sequenceNumber: 0, timeRange: void 0, field5: 0 };
}
var UnknownMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(10).fork()).join();
    }
    if (message.lmt !== void 0 && message.lmt !== "0") {
      writer.uint32(16).sint64(message.lmt);
    }
    if (message.sequenceNumber !== void 0 && message.sequenceNumber !== 0) {
      writer.uint32(24).int32(message.sequenceNumber);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(34).fork()).join();
    }
    if (message.field5 !== void 0 && message.field5 !== 0) {
      writer.uint32(40).int32(message.field5);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseUnknownMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.lmt = reader.sint64().toString();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.sequenceNumber = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.field5 = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseUnknownMessage2() {
  return { field1: [], field2: new Uint8Array(0), field3: "", field4: 0, field5: 0, field6: "" };
}
var UnknownMessage2 = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.field1) {
      writer.uint32(10).string(v);
    }
    if (message.field2 !== void 0 && message.field2.length !== 0) {
      writer.uint32(18).bytes(message.field2);
    }
    if (message.field3 !== void 0 && message.field3 !== "") {
      writer.uint32(26).string(message.field3);
    }
    if (message.field4 !== void 0 && message.field4 !== 0) {
      writer.uint32(32).int32(message.field4);
    }
    if (message.field5 !== void 0 && message.field5 !== 0) {
      writer.uint32(40).int32(message.field5);
    }
    if (message.field6 !== void 0 && message.field6 !== "") {
      writer.uint32(50).string(message.field6);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseUnknownMessage2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.field1.push(reader.string());
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.field2 = reader.bytes();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.field3 = reader.string();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.field4 = reader.int32();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.field5 = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.field6 = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseUnknownMessage3() {
  return { formatIds: [], ud: [], clipId: "" };
}
var UnknownMessage3 = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.formatIds) {
      FormatId.encode(v, writer.uint32(10).fork()).join();
    }
    for (const v of message.ud) {
      BufferedRange.encode(v, writer.uint32(18).fork()).join();
    }
    if (message.clipId !== void 0 && message.clipId !== "") {
      writer.uint32(26).string(message.clipId);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseUnknownMessage3();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.formatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.ud.push(BufferedRange.decode(reader, reader.uint32()));
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.clipId = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/next_request_policy.js
function createBaseNextRequestPolicy() {
  return {
    targetAudioReadaheadMs: 0,
    targetVideoReadaheadMs: 0,
    maxTimeSinceLastRequestMs: 0,
    backoffTimeMs: 0,
    minAudioReadaheadMs: 0,
    minVideoReadaheadMs: 0,
    playbackCookie: void 0,
    videoId: ""
  };
}
var NextRequestPolicy = {
  encode(message, writer = new BinaryWriter()) {
    if (message.targetAudioReadaheadMs !== void 0 && message.targetAudioReadaheadMs !== 0) {
      writer.uint32(8).int32(message.targetAudioReadaheadMs);
    }
    if (message.targetVideoReadaheadMs !== void 0 && message.targetVideoReadaheadMs !== 0) {
      writer.uint32(16).int32(message.targetVideoReadaheadMs);
    }
    if (message.maxTimeSinceLastRequestMs !== void 0 && message.maxTimeSinceLastRequestMs !== 0) {
      writer.uint32(24).int32(message.maxTimeSinceLastRequestMs);
    }
    if (message.backoffTimeMs !== void 0 && message.backoffTimeMs !== 0) {
      writer.uint32(32).int32(message.backoffTimeMs);
    }
    if (message.minAudioReadaheadMs !== void 0 && message.minAudioReadaheadMs !== 0) {
      writer.uint32(40).int32(message.minAudioReadaheadMs);
    }
    if (message.minVideoReadaheadMs !== void 0 && message.minVideoReadaheadMs !== 0) {
      writer.uint32(48).int32(message.minVideoReadaheadMs);
    }
    if (message.playbackCookie !== void 0) {
      PlaybackCookie.encode(message.playbackCookie, writer.uint32(58).fork()).join();
    }
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(66).string(message.videoId);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseNextRequestPolicy();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.targetAudioReadaheadMs = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.targetVideoReadaheadMs = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.maxTimeSinceLastRequestMs = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.backoffTimeMs = reader.int32();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.minAudioReadaheadMs = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.minVideoReadaheadMs = reader.int32();
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.playbackCookie = PlaybackCookie.decode(reader, reader.uint32());
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/sabr_error.js
function createBaseSabrError() {
  return { type: "", code: 0 };
}
var SabrError = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== "") {
      writer.uint32(10).string(message.type);
    }
    if (message.code !== void 0 && message.code !== 0) {
      writer.uint32(16).int32(message.code);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrError();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.type = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.code = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/sabr_redirect.js
function createBaseSabrRedirect() {
  return { url: "" };
}
var SabrRedirect = {
  encode(message, writer = new BinaryWriter()) {
    if (message.url !== void 0 && message.url !== "") {
      writer.uint32(10).string(message.url);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrRedirect();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.url = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/reload_player_response.js
function createBaseReloadPlaybackParams() {
  return { token: "" };
}
var ReloadPlaybackParams = {
  encode(message, writer = new BinaryWriter()) {
    if (message.token !== void 0 && message.token !== "") {
      writer.uint32(10).string(message.token);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseReloadPlaybackParams();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.token = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseReloadPlaybackContext() {
  return { reloadPlaybackParams: void 0 };
}
var ReloadPlaybackContext = {
  encode(message, writer = new BinaryWriter()) {
    if (message.reloadPlaybackParams !== void 0) {
      ReloadPlaybackParams.encode(message.reloadPlaybackParams, writer.uint32(10).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseReloadPlaybackContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.reloadPlaybackParams = ReloadPlaybackParams.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/sabr_context_update.js
var SabrContextUpdate_SabrContextWritePolicy = {
  UNSPECIFIED: 0,
  0: "UNSPECIFIED",
  OVERWRITE: 1,
  1: "OVERWRITE",
  KEEP_EXISTING: 2,
  2: "KEEP_EXISTING",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};
function createBaseSabrContextUpdate() {
  return { type: 0, scope: 0, value: new Uint8Array(0), sendByDefault: false, writePolicy: 0 };
}
var SabrContextUpdate = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== 0) {
      writer.uint32(8).int32(message.type);
    }
    if (message.scope !== void 0 && message.scope !== 0) {
      writer.uint32(16).int32(message.scope);
    }
    if (message.value !== void 0 && message.value.length !== 0) {
      writer.uint32(26).bytes(message.value);
    }
    if (message.sendByDefault !== void 0 && message.sendByDefault !== false) {
      writer.uint32(32).bool(message.sendByDefault);
    }
    if (message.writePolicy !== void 0 && message.writePolicy !== 0) {
      writer.uint32(40).int32(message.writePolicy);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrContextUpdate();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.type = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.scope = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.value = reader.bytes();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.sendByDefault = reader.bool();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.writePolicy = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/sabr_context_sending_policy.js
function createBaseSabrContextSendingPolicy() {
  return { startPolicy: [], stopPolicy: [], discardPolicy: [] };
}
var SabrContextSendingPolicy = {
  encode(message, writer = new BinaryWriter()) {
    writer.uint32(10).fork();
    for (const v of message.startPolicy) {
      writer.int32(v);
    }
    writer.join();
    writer.uint32(18).fork();
    for (const v of message.stopPolicy) {
      writer.int32(v);
    }
    writer.join();
    writer.uint32(26).fork();
    for (const v of message.discardPolicy) {
      writer.int32(v);
    }
    writer.join();
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrContextSendingPolicy();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag === 8) {
            message.startPolicy.push(reader.int32());
            continue;
          }
          if (tag === 10) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.startPolicy.push(reader.int32());
            }
            continue;
          }
          break;
        }
        case 2: {
          if (tag === 16) {
            message.stopPolicy.push(reader.int32());
            continue;
          }
          if (tag === 18) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.stopPolicy.push(reader.int32());
            }
            continue;
          }
          break;
        }
        case 3: {
          if (tag === 24) {
            message.discardPolicy.push(reader.int32());
            continue;
          }
          if (tag === 26) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.discardPolicy.push(reader.int32());
            }
            continue;
          }
          break;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/stream_protection_status.js
function createBaseStreamProtectionStatus() {
  return { status: 0, maxRetries: 0 };
}
var StreamProtectionStatus = {
  encode(message, writer = new BinaryWriter()) {
    if (message.status !== void 0 && message.status !== 0) {
      writer.uint32(8).int32(message.status);
    }
    if (message.maxRetries !== void 0 && message.maxRetries !== 0) {
      writer.uint32(16).int32(message.maxRetries);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamProtectionStatus();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.status = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.maxRetries = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// node_modules/googlevideo/dist/protos/generated/video_streaming/ump_part_id.js
var UMPPartId = {
  UNKNOWN: 0,
  0: "UNKNOWN",
  ONESIE_HEADER: 10,
  10: "ONESIE_HEADER",
  ONESIE_DATA: 11,
  11: "ONESIE_DATA",
  ONESIE_ENCRYPTED_MEDIA: 12,
  12: "ONESIE_ENCRYPTED_MEDIA",
  /** MEDIA_HEADER - Header for a media segment; includes sequence and timing information. */
  MEDIA_HEADER: 20,
  /** MEDIA_HEADER - Header for a media segment; includes sequence and timing information. */
  20: "MEDIA_HEADER",
  /** MEDIA - Chunk of media segment data. */
  MEDIA: 21,
  /** MEDIA - Chunk of media segment data. */
  21: "MEDIA",
  /** MEDIA_END - Indicates end of media segment; finalizes segment processing. */
  MEDIA_END: 22,
  /** MEDIA_END - Indicates end of media segment; finalizes segment processing. */
  22: "MEDIA_END",
  CONFIG: 30,
  30: "CONFIG",
  LIVE_METADATA: 31,
  31: "LIVE_METADATA",
  HOSTNAME_CHANGE_HINT_DEPRECATED: 32,
  32: "HOSTNAME_CHANGE_HINT_DEPRECATED",
  LIVE_METADATA_PROMISE: 33,
  33: "LIVE_METADATA_PROMISE",
  LIVE_METADATA_PROMISE_CANCELLATION: 34,
  34: "LIVE_METADATA_PROMISE_CANCELLATION",
  /** NEXT_REQUEST_POLICY - Server's policy for the next request; includes backoff time and playback cookie. */
  NEXT_REQUEST_POLICY: 35,
  /** NEXT_REQUEST_POLICY - Server's policy for the next request; includes backoff time and playback cookie. */
  35: "NEXT_REQUEST_POLICY",
  USTREAMER_VIDEO_AND_FORMAT_METADATA: 36,
  36: "USTREAMER_VIDEO_AND_FORMAT_METADATA",
  FORMAT_SELECTION_CONFIG: 37,
  37: "FORMAT_SELECTION_CONFIG",
  USTREAMER_SELECTED_MEDIA_STREAM: 38,
  38: "USTREAMER_SELECTED_MEDIA_STREAM",
  /** FORMAT_INITIALIZATION_METADATA - Metadata for format initialization; contains total number of segments, duration, etc. */
  FORMAT_INITIALIZATION_METADATA: 42,
  /** FORMAT_INITIALIZATION_METADATA - Metadata for format initialization; contains total number of segments, duration, etc. */
  42: "FORMAT_INITIALIZATION_METADATA",
  /** SABR_REDIRECT - Indicates a redirect to a different streaming URL. */
  SABR_REDIRECT: 43,
  /** SABR_REDIRECT - Indicates a redirect to a different streaming URL. */
  43: "SABR_REDIRECT",
  /** SABR_ERROR - Indicates a SABR error; happens when the payload is invalid or the server cannot process the request. */
  SABR_ERROR: 44,
  /** SABR_ERROR - Indicates a SABR error; happens when the payload is invalid or the server cannot process the request. */
  44: "SABR_ERROR",
  SABR_SEEK: 45,
  45: "SABR_SEEK",
  /** RELOAD_PLAYER_RESPONSE - Directive to reload the player with new parameters. */
  RELOAD_PLAYER_RESPONSE: 46,
  /** RELOAD_PLAYER_RESPONSE - Directive to reload the player with new parameters. */
  46: "RELOAD_PLAYER_RESPONSE",
  PLAYBACK_START_POLICY: 47,
  47: "PLAYBACK_START_POLICY",
  ALLOWED_CACHED_FORMATS: 48,
  48: "ALLOWED_CACHED_FORMATS",
  START_BW_SAMPLING_HINT: 49,
  49: "START_BW_SAMPLING_HINT",
  PAUSE_BW_SAMPLING_HINT: 50,
  50: "PAUSE_BW_SAMPLING_HINT",
  SELECTABLE_FORMATS: 51,
  51: "SELECTABLE_FORMATS",
  REQUEST_IDENTIFIER: 52,
  52: "REQUEST_IDENTIFIER",
  REQUEST_CANCELLATION_POLICY: 53,
  53: "REQUEST_CANCELLATION_POLICY",
  ONESIE_PREFETCH_REJECTION: 54,
  54: "ONESIE_PREFETCH_REJECTION",
  TIMELINE_CONTEXT: 55,
  55: "TIMELINE_CONTEXT",
  REQUEST_PIPELINING: 56,
  56: "REQUEST_PIPELINING",
  /** SABR_CONTEXT_UPDATE - Updates SABR context data; usually used for ads. */
  SABR_CONTEXT_UPDATE: 57,
  /** SABR_CONTEXT_UPDATE - Updates SABR context data; usually used for ads. */
  57: "SABR_CONTEXT_UPDATE",
  /** STREAM_PROTECTION_STATUS - Status of stream protection; indicates whether attestation is required. */
  STREAM_PROTECTION_STATUS: 58,
  /** STREAM_PROTECTION_STATUS - Status of stream protection; indicates whether attestation is required. */
  58: "STREAM_PROTECTION_STATUS",
  /** SABR_CONTEXT_SENDING_POLICY - Policy indicating which SABR contexts to send or discard in future requests. */
  SABR_CONTEXT_SENDING_POLICY: 59,
  /** SABR_CONTEXT_SENDING_POLICY - Policy indicating which SABR contexts to send or discard in future requests. */
  59: "SABR_CONTEXT_SENDING_POLICY",
  LAWNMOWER_POLICY: 60,
  60: "LAWNMOWER_POLICY",
  SABR_ACK: 61,
  61: "SABR_ACK",
  END_OF_TRACK: 62,
  62: "END_OF_TRACK",
  CACHE_LOAD_POLICY: 63,
  63: "CACHE_LOAD_POLICY",
  LAWNMOWER_MESSAGING_POLICY: 64,
  64: "LAWNMOWER_MESSAGING_POLICY",
  PREWARM_CONNECTION: 65,
  65: "PREWARM_CONNECTION",
  PLAYBACK_DEBUG_INFO: 66,
  66: "PLAYBACK_DEBUG_INFO",
  /** SNACKBAR_MESSAGE - Directive to show the user a notification message. */
  SNACKBAR_MESSAGE: 67,
  /** SNACKBAR_MESSAGE - Directive to show the user a notification message. */
  67: "SNACKBAR_MESSAGE",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};

// node_modules/googlevideo/dist/src/utils/Logger.js
var LogLevel = {
  NONE: 0,
  0: "NONE",
  ERROR: 1,
  1: "ERROR",
  WARN: 2,
  2: "WARN",
  INFO: 3,
  3: "INFO",
  DEBUG: 4,
  4: "DEBUG",
  ALL: 99,
  99: "ALL"
};
var Logger = class _Logger {
  constructor() {
    this.currentLogLevels = /* @__PURE__ */ new Set([LogLevel.INFO, LogLevel.ERROR]);
  }
  static getInstance() {
    if (!_Logger.instance) {
      _Logger.instance = new _Logger();
    }
    return _Logger.instance;
  }
  /**
   * Sets the active log levels.
   * Call with LogLevel.NONE or no arguments to turn off all logging.
   * Otherwise, specify one or more log levels to be active.
   * Use LogLevel.ALL to enable all log levels.
   */
  setLogLevels(...levels) {
    if (levels.length === 0 || levels.includes(LogLevel.NONE)) {
      this.currentLogLevels = /* @__PURE__ */ new Set();
    } else if (levels.includes(LogLevel.ALL)) {
      this.currentLogLevels = /* @__PURE__ */ new Set([
        LogLevel.ERROR,
        LogLevel.WARN,
        LogLevel.INFO,
        LogLevel.DEBUG
      ]);
    } else {
      this.currentLogLevels = new Set(levels.filter((level) => level !== LogLevel.NONE && level !== LogLevel.ALL));
    }
  }
  /**
   * Gets the current set of active log levels.
   * @returns A new Set containing the active LogLevel enums.
   */
  getLogLevels() {
    return new Set(this.currentLogLevels);
  }
  log(level, tag, ...messages) {
    if (level !== LogLevel.NONE && this.currentLogLevels.has(level)) {
      const prefix = `[${LogLevel[level]}] [${tag}]`;
      switch (level) {
        case LogLevel.ERROR:
          console.error(prefix, ...messages);
          break;
        case LogLevel.WARN:
          console.warn(prefix, ...messages);
          break;
        case LogLevel.INFO:
          console.info(prefix, ...messages);
          break;
        case LogLevel.DEBUG:
          console.debug(prefix, ...messages);
          break;
      }
    }
  }
  error(tag, ...messages) {
    this.log(LogLevel.ERROR, tag, ...messages);
  }
  warn(tag, ...messages) {
    this.log(LogLevel.WARN, tag, ...messages);
  }
  info(tag, ...messages) {
    this.log(LogLevel.INFO, tag, ...messages);
  }
  debug(tag, ...messages) {
    this.log(LogLevel.DEBUG, tag, ...messages);
  }
};

// node_modules/googlevideo/dist/src/utils/shared.js
var MAX_INT32_VALUE = "2147483647";
var EnabledTrackTypes = {
  VIDEO_AND_AUDIO: 0,
  0: "VIDEO_AND_AUDIO",
  AUDIO_ONLY: 1,
  1: "AUDIO_ONLY",
  VIDEO_ONLY: 2,
  2: "VIDEO_ONLY"
};
function base64ToU8(base64) {
  const standard_base64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padded_base64 = standard_base64.padEnd(standard_base64.length + (4 - standard_base64.length % 4) % 4, "=");
  return new Uint8Array(atob(padded_base64).split("").map((char) => char.charCodeAt(0)));
}
function concatenateChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// node_modules/googlevideo/dist/src/utils/EventEmitterLike.js
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _CustomEvent_detail;
var _EventEmitterLike_legacyListeners;
var CustomEvent = class extends Event {
  constructor(type, options) {
    super(type, options);
    _CustomEvent_detail.set(this, void 0);
    __classPrivateFieldSet(this, _CustomEvent_detail, options?.detail ?? null, "f");
  }
  get detail() {
    return __classPrivateFieldGet(this, _CustomEvent_detail, "f");
  }
};
_CustomEvent_detail = /* @__PURE__ */ new WeakMap();
var EventEmitterLike = class extends EventTarget {
  constructor() {
    super();
    _EventEmitterLike_legacyListeners.set(this, /* @__PURE__ */ new Map());
  }
  emit(type, ...args) {
    const event = new CustomEvent(type, { detail: args });
    this.dispatchEvent(event);
  }
  on(type, listener) {
    const wrapper = (ev) => {
      if (ev instanceof CustomEvent) {
        listener(...ev.detail);
      } else {
        listener(ev);
      }
    };
    __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").set(listener, { type, wrapper });
    this.addEventListener(type, wrapper);
  }
  once(type, listener) {
    const wrapper = (ev) => {
      if (ev instanceof CustomEvent) {
        listener(...ev.detail);
      } else {
        listener(ev);
      }
      this.off(type, listener);
    };
    __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").set(listener, { type, wrapper });
    this.addEventListener(type, wrapper);
  }
  off(type, listener) {
    const listenerData = __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").get(listener);
    if (listenerData && listenerData.type === type) {
      this.removeEventListener(type, listenerData.wrapper);
      __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").delete(listener);
    }
  }
  removeAllListeners(type) {
    if (type) {
      for (const [listener, listenerData] of __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").entries()) {
        if (listenerData.type === type) {
          this.removeEventListener(type, listenerData.wrapper);
          __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").delete(listener);
        }
      }
    } else {
      for (const [listener, listenerData] of __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").entries()) {
        this.removeEventListener(listenerData.type, listenerData.wrapper);
        __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").delete(listener);
      }
    }
  }
};
_EventEmitterLike_legacyListeners = /* @__PURE__ */ new WeakMap();

// node_modules/googlevideo/dist/src/utils/formatKeyUtils.js
function createKey(itag, xtags) {
  return `${itag || ""}:${xtags || ""}`;
}
function fromFormat(format) {
  if (!format)
    return void 0;
  return createKey(format.itag, format.xtags);
}
function fromMediaHeader(mediaHeader) {
  return createKey(mediaHeader.itag, mediaHeader.xtags);
}
function fromFormatInitializationMetadata(formatInitMetadata) {
  if (!formatInitMetadata.formatId)
    return "";
  return createKey(formatInitMetadata.formatId.itag, formatInitMetadata.formatId.xtags);
}

// node_modules/googlevideo/dist/src/utils/sabrStreamUtils.js
function getMediaType(initializedFormat) {
  return initializedFormat.formatInitializationMetadata?.mimeType?.includes("video") ? "video" : "audio";
}
function getTotalDownloadedDuration(initializedFormat) {
  return Array.from(initializedFormat.downloadedSegments.values()).reduce((sum, segment) => sum + parseInt(segment.durationMs || "0"), 0);
}
function filterFormatsByType(formats, isAudio) {
  return formats.filter((format) => {
    if (!format.mimeType)
      return false;
    return isAudio ? format.mimeType.includes("audio") : format.mimeType.includes("video");
  });
}
function chooseFormat(formats, formatOption, preferences) {
  if (!formats.length)
    return void 0;
  const typeFormats = filterFormatsByType(formats, preferences.isAudio);
  if (!typeFormats.length)
    return void 0;
  if (typeof formatOption === "number") {
    return typeFormats.find((format) => format.itag === formatOption);
  }
  if (formatOption && typeof formatOption !== "function") {
    return formatOption;
  }
  if (typeof formatOption === "function") {
    return formatOption(typeFormats);
  }
  let filteredFormats = typeFormats;
  if (preferences.language) {
    filteredFormats = filteredFormats.filter((format) => format.language === preferences.language);
  }
  if (preferences.quality) {
    filteredFormats = filteredFormats.filter((format) => preferences.isAudio ? !!format.audioQuality?.toLowerCase().includes(preferences.quality?.toLowerCase() || "") : !!format.qualityLabel?.toLowerCase().includes(preferences.quality?.toLowerCase() || ""));
  }
  if (preferences.isAudio) {
    if (preferences.preferOpus) {
      filteredFormats = applyMimeTypeFilter(filteredFormats, "opus");
    }
  } else if (preferences.preferH264) {
    filteredFormats = filteredFormats.filter((format) => !!format.mimeType && format.mimeType.includes("mp4") && format.mimeType.includes("avc"));
  }
  if (preferences.preferWebM) {
    filteredFormats = applyMimeTypeFilter(filteredFormats, "webm");
  } else if (preferences.preferMP4) {
    filteredFormats = applyMimeTypeFilter(filteredFormats, "mp4");
  }
  return preferences.isAudio ? filteredFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] : filteredFormats.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
}
function applyMimeTypeFilter(formats, mimeTypePart) {
  return formats.filter((format) => format.mimeType?.includes(mimeTypePart));
}

// node_modules/googlevideo/dist/src/core/CompositeBuffer.js
var CompositeBuffer = class _CompositeBuffer {
  constructor(chunks = []) {
    this.chunks = [];
    this.currentChunkOffset = this.currentChunkIndex = 0;
    this.currentDataView = void 0;
    this.totalLength = 0;
    chunks.forEach((chunk) => this.append(chunk));
  }
  append(chunk) {
    if (chunk instanceof Uint8Array) {
      if (this.canMergeWithLastChunk(chunk)) {
        const lastChunk = this.chunks[this.chunks.length - 1];
        this.chunks[this.chunks.length - 1] = new Uint8Array(lastChunk.buffer, lastChunk.byteOffset, lastChunk.length + chunk.length);
        this.resetFocus();
      } else {
        this.chunks.push(chunk);
      }
      this.totalLength += chunk.length;
    } else {
      chunk.chunks.forEach((c) => this.append(c));
    }
  }
  split(position) {
    const extractedBuffer = new _CompositeBuffer();
    const remainingBuffer = new _CompositeBuffer();
    const iterator = this.chunks[Symbol.iterator]();
    let item = iterator.next();
    while (!item.done) {
      const chunk = item.value;
      if (position >= chunk.length) {
        extractedBuffer.append(chunk);
        position -= chunk.length;
      } else if (position > 0) {
        extractedBuffer.append(new Uint8Array(chunk.buffer, chunk.byteOffset, position));
        remainingBuffer.append(new Uint8Array(chunk.buffer, chunk.byteOffset + position, chunk.length - position));
        position = 0;
      } else {
        remainingBuffer.append(chunk);
      }
      item = iterator.next();
    }
    return { extractedBuffer, remainingBuffer };
  }
  getLength() {
    return this.totalLength;
  }
  canReadBytes(position, length) {
    return position + length <= this.totalLength;
  }
  getUint8(position) {
    this.focus(position);
    return this.chunks[this.currentChunkIndex][position - this.currentChunkOffset];
  }
  focus(position) {
    if (!this.isFocused(position)) {
      if (position < this.currentChunkOffset)
        this.resetFocus();
      while (this.currentChunkOffset + this.chunks[this.currentChunkIndex].length <= position && this.currentChunkIndex < this.chunks.length - 1) {
        this.currentChunkOffset += this.chunks[this.currentChunkIndex].length;
        this.currentChunkIndex += 1;
      }
      this.currentDataView = void 0;
    }
  }
  isFocused(position) {
    return position >= this.currentChunkOffset && position < this.currentChunkOffset + this.chunks[this.currentChunkIndex].length;
  }
  resetFocus() {
    this.currentDataView = void 0;
    this.currentChunkIndex = 0;
    this.currentChunkOffset = 0;
  }
  canMergeWithLastChunk(chunk) {
    if (this.chunks.length === 0)
      return false;
    const lastChunk = this.chunks[this.chunks.length - 1];
    return lastChunk.buffer === chunk.buffer && lastChunk.byteOffset + lastChunk.length === chunk.byteOffset;
  }
};

// node_modules/googlevideo/dist/src/core/UmpReader.js
var UmpReader = class {
  constructor(compositeBuffer) {
    this.compositeBuffer = compositeBuffer;
  }
  /**
   * Parses parts from the buffer and calls the handler for each complete part.
   * @param handlePart - Function called with each complete part.
   * @returns Partial part if parsing is incomplete, undefined otherwise.
   */
  read(handlePart) {
    while (true) {
      let offset = 0;
      const [partType, newOffset] = this.readVarInt(offset);
      offset = newOffset;
      const [partSize, finalOffset] = this.readVarInt(offset);
      offset = finalOffset;
      if (partType < 0 || partSize < 0)
        break;
      if (!this.compositeBuffer.canReadBytes(offset, partSize)) {
        if (!this.compositeBuffer.canReadBytes(offset, 1))
          break;
        return {
          type: partType,
          size: partSize,
          data: this.compositeBuffer
        };
      }
      const splitResult = this.compositeBuffer.split(offset).remainingBuffer.split(partSize);
      offset = 0;
      handlePart({
        type: partType,
        size: partSize,
        data: splitResult.extractedBuffer
      });
      this.compositeBuffer = splitResult.remainingBuffer;
    }
  }
  /**
   * Reads a variable-length integer from the buffer.
   * @param offset - Position to start reading from.
   * @returns Tuple of [value, new offset] or [-1, offset] if incomplete.
   */
  readVarInt(offset) {
    let byteLength;
    if (this.compositeBuffer.canReadBytes(offset, 1)) {
      const firstByte = this.compositeBuffer.getUint8(offset);
      byteLength = firstByte < 128 ? 1 : firstByte < 192 ? 2 : firstByte < 224 ? 3 : firstByte < 240 ? 4 : 5;
    } else {
      byteLength = 0;
    }
    if (byteLength < 1 || !this.compositeBuffer.canReadBytes(offset, byteLength)) {
      return [-1, offset];
    }
    let value;
    switch (byteLength) {
      case 1:
        value = this.compositeBuffer.getUint8(offset++);
        break;
      case 2: {
        const byte1 = this.compositeBuffer.getUint8(offset++);
        const byte2 = this.compositeBuffer.getUint8(offset++);
        value = (byte1 & 63) + 64 * byte2;
        break;
      }
      case 3: {
        const byte1 = this.compositeBuffer.getUint8(offset++);
        const byte2 = this.compositeBuffer.getUint8(offset++);
        const byte3 = this.compositeBuffer.getUint8(offset++);
        value = (byte1 & 31) + 32 * (byte2 + 256 * byte3);
        break;
      }
      case 4: {
        const byte1 = this.compositeBuffer.getUint8(offset++);
        const byte2 = this.compositeBuffer.getUint8(offset++);
        const byte3 = this.compositeBuffer.getUint8(offset++);
        const byte4 = this.compositeBuffer.getUint8(offset++);
        value = (byte1 & 15) + 16 * (byte2 + 256 * (byte3 + 256 * byte4));
        break;
      }
      default: {
        const tempOffset = offset + 1;
        this.compositeBuffer.focus(tempOffset);
        if (this.canReadFromCurrentChunk(tempOffset, 4)) {
          value = this.getCurrentDataView().getUint32(tempOffset - this.compositeBuffer.currentChunkOffset, true);
        } else {
          const byte3 = this.compositeBuffer.getUint8(tempOffset + 2) + 256 * this.compositeBuffer.getUint8(tempOffset + 3);
          value = this.compositeBuffer.getUint8(tempOffset) + 256 * (this.compositeBuffer.getUint8(tempOffset + 1) + 256 * byte3);
        }
        offset += 5;
        break;
      }
    }
    return [value, offset];
  }
  /**
   * Checks if the specified bytes can be read from the current chunk.
   * @param offset - Position to start reading from.
   * @param length - Number of bytes to read.
   * @returns True if bytes can be read from current chunk, false otherwise.
   */
  canReadFromCurrentChunk(offset, length) {
    return offset - this.compositeBuffer.currentChunkOffset + length <= this.compositeBuffer.chunks[this.compositeBuffer.currentChunkIndex].length;
  }
  /**
   * Gets a DataView of the current chunk, creating it if necessary.
   * @returns DataView for the current chunk.
   */
  getCurrentDataView() {
    if (!this.compositeBuffer.currentDataView) {
      const currentChunk = this.compositeBuffer.chunks[this.compositeBuffer.currentChunkIndex];
      this.compositeBuffer.currentDataView = new DataView(currentChunk.buffer, currentChunk.byteOffset, currentChunk.length);
    }
    return this.compositeBuffer.currentDataView;
  }
};

// node_modules/googlevideo/dist/src/core/SabrStream.js
var TAG = "SabrStream";
var DEFAULT_MAX_RETRIES = 10;
var MAX_BACKOFF_MS = 8e3;
var BACKOFF_MULTIPLIER = 500;
var DEFAULT_STALL_DETECTION_MS = 3e4;
var MAX_STALLS = 5;
var SabrStream = class extends EventEmitterLike {
  on(event, listener) {
    super.on(event, listener);
  }
  once(event, listener) {
    super.once(event, listener);
  }
  constructor(config = {}) {
    super();
    this.logger = Logger.getInstance();
    this.formatIds = [];
    this.umpPartHandlers = /* @__PURE__ */ new Map([
      [UMPPartId.FORMAT_INITIALIZATION_METADATA, this.handleFormatInitializationMetadata.bind(this)],
      [UMPPartId.NEXT_REQUEST_POLICY, this.handleNextRequestPolicy.bind(this)],
      [UMPPartId.SABR_ERROR, this.handleSabrError.bind(this)],
      [UMPPartId.SABR_REDIRECT, this.handleSabrRedirect.bind(this)],
      [UMPPartId.SABR_CONTEXT_UPDATE, this.handleSabrContextUpdate.bind(this)],
      [UMPPartId.SABR_CONTEXT_SENDING_POLICY, this.handleSabrContextSendingPolicy.bind(this)],
      [UMPPartId.STREAM_PROTECTION_STATUS, this.handleStreamProtectionStatus.bind(this)],
      [UMPPartId.RELOAD_PLAYER_RESPONSE, this.handleReloadPlayerResponse.bind(this)],
      [UMPPartId.MEDIA_HEADER, this.handleMediaHeader.bind(this)],
      [UMPPartId.MEDIA, this.handleMedia.bind(this)],
      [UMPPartId.MEDIA_END, this.handleMediaEnd.bind(this)]
    ]);
    this.sabrContexts = /* @__PURE__ */ new Map();
    this.activeSabrContextTypes = /* @__PURE__ */ new Set();
    this.initializedFormatsMap = /* @__PURE__ */ new Map();
    this.partialSegmentQueue = /* @__PURE__ */ new Map();
    this.requestNumber = 0;
    this.durationMs = Infinity;
    this.mediaHeadersProcessed = false;
    this._errored = false;
    this._aborted = false;
    this.progressTracker = {
      lastProgressTime: Date.now(),
      lastDownloadedDuration: 0,
      stallCount: 0
    };
    this.fetchFunction = config?.fetch || fetch;
    this.serverAbrStreamingUrl = config.serverAbrStreamingUrl;
    this.videoPlaybackUstreamerConfig = config.videoPlaybackUstreamerConfig;
    this.clientInfo = config.clientInfo;
    this.poToken = config.poToken;
    this.durationMs = config.durationMs || Infinity;
    this.formatIds = config.formats || [];
    this.videoStream = new ReadableStream({
      start: (controller) => {
        this.videoController = controller;
      }
    });
    this.audioStream = new ReadableStream({
      start: (controller) => {
        this.audioController = controller;
      }
    });
  }
  /**
   * Sets Proof of Origin (PO) token.
   * @param poToken - The base64-encoded token string.
   */
  setPoToken(poToken) {
    this.poToken = poToken;
  }
  /**
   * Sets the available server ABR formats.
   * @param formats - An array of available SabrFormat objects.
   */
  setServerAbrFormats(formats) {
    this.formatIds.push(...formats);
  }
  /**
   * Sets the total duration of the stream in milliseconds.
   * This is optional as duration is often determined automatically from format metadata.
   * @param durationMs - The duration in milliseconds.
   */
  setDurationMs(durationMs) {
    this.durationMs = durationMs;
  }
  /**
   * Sets the server ABR streaming URL for media requests.
   * @param url - The streaming URL.
   */
  setStreamingURL(url) {
    this.serverAbrStreamingUrl = url;
  }
  /**
   * Sets the Ustreamer configuration string.
   * @param config - The Ustreamer configuration.
   */
  setUstreamerConfig(config) {
    this.videoPlaybackUstreamerConfig = config;
  }
  /**
   * Sets the client information used in SABR requests.
   * @param clientInfo - The client information object.
   */
  setClientInfo(clientInfo) {
    this.clientInfo = clientInfo;
  }
  /**
   * Aborts the download process, closing all streams and cleaning up resources.
   * Emits an 'abort' event.
   */
  abort() {
    this.logger.debug(TAG, "Aborting download process");
    this._aborted = true;
    this.abortController?.abort();
    this.videoController?.error(new Error("Download aborted."));
    this.audioController?.error(new Error("Download aborted."));
    this.resetState();
    this.emit("abort");
  }
  //#region --- Stream Initialization and Lifecycle Control ---
  /**
   * Returns a serializable state object that can be used to restore the stream later.
   * @throws {Error} If the main format is not initialized.
   * @returns The current state of the stream.
   */
  getState() {
    if (!this.mainFormat)
      throw new Error("Main format is not initialized, cannot get state.");
    const playerTimeMs = getTotalDownloadedDuration(this.mainFormat);
    const initializedFormats = [];
    for (const [formatKey, format] of this.initializedFormatsMap.entries()) {
      initializedFormats.push({
        formatKey,
        formatInitializationMetadata: format.formatInitializationMetadata,
        downloadedSegments: Array.from(format.downloadedSegments.entries()),
        lastMediaHeaders: format.lastMediaHeaders
      });
    }
    return {
      durationMs: this.durationMs,
      requestNumber: this.requestNumber,
      activeSabrContexts: Array.from(this.activeSabrContextTypes),
      sabrContextUpdates: Array.from(this.sabrContexts.entries()),
      formatToDiscard: this.formatToDiscard,
      cachedBufferedRanges: this.cachedBufferedRanges || [],
      nextRequestPolicy: this.nextRequestPolicy,
      initializedFormats,
      playerTimeMs
    };
  }
  /**
   * Initiates the streaming process for the selected formats.
   * @param options - Playback options, including format preferences and initial state.
   * @throws {Error} If no suitable formats are found or streaming fails.
   * @returns A promise that resolves with the video/audio streams and selected formats.
   */
  async start(options) {
    const { videoFormat, audioFormat } = this.selectFormats(options);
    this.setupStreamingProcess(videoFormat, audioFormat, options).then();
    return {
      videoStream: this.videoStream,
      audioStream: this.audioStream,
      selectedFormats: { videoFormat, audioFormat }
    };
  }
  /**
   * Sets up and manages the main streaming loop.
   * @param videoFormat - The selected video format.
   * @param audioFormat - The selected audio format.
   * @param options - Playback options.
   * @private
   */
  async setupStreamingProcess(videoFormat, audioFormat, options) {
    try {
      this._errored = false;
      this._aborted = false;
      let playerTimeMs = 0;
      if (options.state && this.restoreState(videoFormat, audioFormat, options.state)) {
        playerTimeMs = options.state.playerTimeMs || 0;
      }
      const maxRetries = options.maxRetries !== void 0 ? options.maxRetries : DEFAULT_MAX_RETRIES;
      const enabledTrackTypesBitfield = options.enabledTrackTypes ?? EnabledTrackTypes.VIDEO_AND_AUDIO;
      const abrState = {
        playerTimeMs,
        audioTrackId: audioFormat.audioTrackId,
        playbackRate: 1,
        stickyResolution: videoFormat.height || 360,
        drcEnabled: audioFormat.isDrc,
        clientViewportIsFlexible: false,
        visibility: 1,
        enabledTrackTypesBitfield
      };
      if (abrState.enabledTrackTypesBitfield === 1 || abrState.enabledTrackTypesBitfield === 2) {
        this.formatToDiscard = abrState.enabledTrackTypesBitfield === 1 ? fromFormat(videoFormat) : fromFormat(audioFormat);
      }
      while (parseInt(abrState.playerTimeMs) < this.durationMs) {
        if (this._aborted) {
          this.logger.debug(TAG, "Download process aborted, exiting streaming loop.");
          break;
        }
        this.logger.debug(TAG, `Starting new segment fetch at playback position: ${abrState.playerTimeMs}ms`);
        this.mainFormat = abrState.enabledTrackTypesBitfield === 1 ? this.initializedFormatsMap.get(fromFormat(audioFormat) || "") : this.initializedFormatsMap.get(fromFormat(videoFormat) || "");
        if (this.mainFormat)
          this.validateAndCorrectDuration(this.mainFormat.formatInitializationMetadata);
        abrState.playerTimeMs = this.mainFormat ? getTotalDownloadedDuration(this.mainFormat) : 0;
        const { shouldStop } = this.checkForStall({
          playerTimeMs: abrState.playerTimeMs,
          stallDetectionMs: options.stallDetectionMs
        });
        if (shouldStop)
          break;
        abrState.playerTimeMs = abrState.playerTimeMs.toString();
        const success = await this.executeWithRetry(() => this.fetchAndProcessSegments(abrState, audioFormat, videoFormat), maxRetries);
        if (!success)
          break;
      }
    } catch (error) {
      if (!this._aborted) {
        this.errorHandler(error, true);
      }
    } finally {
      if (!this._aborted) {
        this.validateDownloadedSegments();
        if (!this._errored) {
          this.videoController?.close();
          this.audioController?.close();
        }
        this.resetState();
        this.emit("finish");
      }
    }
  }
  /**
   * Restores the stream state from a previously saved state object.
   * @param videoFormat - The selected video format.
   * @param audioFormat - The selected audio format.
   * @param state - The saved state object.
   * @returns `true` if the state was restored successfully, `false` otherwise.
   * @private
   */
  restoreState(videoFormat, audioFormat, state) {
    this.resetState();
    if (!state || typeof state !== "object" || !state.initializedFormats || !Array.isArray(state.initializedFormats) || !state.durationMs || !state.playerTimeMs) {
      this.logger.warn(TAG, "Invalid or corrupt state object provided. Starting fresh.");
      return false;
    }
    const expectedVideoFormatKey = fromFormat(videoFormat) || "";
    const expectedAudioFormatKey = fromFormat(audioFormat) || "";
    for (const format of state.initializedFormats) {
      const { formatKey, formatInitializationMetadata, downloadedSegments, lastMediaHeaders } = format;
      if (formatKey !== expectedVideoFormatKey && formatKey !== expectedAudioFormatKey) {
        this.logger.warn(TAG, `State contains an unexpected format key "${formatKey}". It will be ignored.`);
        continue;
      }
      this.initializedFormatsMap.set(formatKey, {
        formatInitializationMetadata,
        downloadedSegments: new Map(downloadedSegments),
        lastMediaHeaders: lastMediaHeaders || []
      });
    }
    if (!this.initializedFormatsMap.has(expectedVideoFormatKey) || !this.initializedFormatsMap.has(expectedAudioFormatKey)) {
      this.logger.warn(TAG, "State is missing required format data for the selected video/audio formats. Starting fresh.");
      this.resetState();
      return false;
    }
    this.durationMs = state.durationMs;
    this.requestNumber = state.requestNumber || 0;
    this.activeSabrContextTypes = new Set(state.activeSabrContexts || []);
    this.sabrContexts = new Map(state.sabrContextUpdates || []);
    this.formatToDiscard = state.formatToDiscard;
    this.cachedBufferedRanges = state.cachedBufferedRanges || [];
    this.nextRequestPolicy = state.nextRequestPolicy;
    return true;
  }
  /**
   * Checks if the download has stalled by tracking progress over time.
   * @param options - Configuration for stall detection.
   * @returns An object indicating whether the stream should stop and if it is stalled.
   * @throws {Error} If the maximum number of consecutive stalls is reached.
   * @private
   */
  checkForStall(options) {
    const currentTime = Date.now();
    const currentProgress = options.playerTimeMs;
    const stallThreshold = options.stallDetectionMs || DEFAULT_STALL_DETECTION_MS;
    if (currentProgress > this.progressTracker.lastDownloadedDuration) {
      this.progressTracker.lastProgressTime = currentTime;
      this.progressTracker.lastDownloadedDuration = currentProgress;
      this.progressTracker.stallCount = 0;
      return { shouldStop: false, stalled: false };
    } else if (currentTime - this.progressTracker.lastProgressTime > stallThreshold) {
      this.progressTracker.stallCount++;
      this.logger.warn(TAG, `Stream stalled for ${stallThreshold}ms (stall #${this.progressTracker.stallCount})`);
      if (this.progressTracker.stallCount >= MAX_STALLS) {
        throw new Error(`Stream stalled ${MAX_STALLS} times, aborting`);
      }
      this.progressTracker.lastProgressTime = currentTime;
      const downloadedDurationCloseness = Math.abs(this.durationMs - currentProgress);
      if (downloadedDurationCloseness < 5e3) {
        this.logger.warn(TAG, "Stream is close to completion, but stalled. Checking if we have the last segment.");
        const endSegmentNumber = parseInt(this.mainFormat?.formatInitializationMetadata.endSegmentNumber || "0") || -1;
        const lastSegment = this.mainFormat?.downloadedSegments.get(endSegmentNumber);
        if (lastSegment && lastSegment.segmentNumber === endSegmentNumber) {
          this.logger.warn(TAG, "Last segment is already downloaded. Stopping further processing.");
          return { shouldStop: true, stalled: true };
        }
      }
      return { shouldStop: false, stalled: true };
    }
    return { shouldStop: false, stalled: false };
  }
  /**
   * Selects the best video and audio formats based on provided options.
   * @param options - Format selection options and quality preferences.
   * @throws {Error} If no suitable formats are found or the duration is invalid.
   * @returns The selected video and audio formats.
   * @private
   */
  selectFormats(options) {
    const videoFormat = chooseFormat(this.formatIds, options.videoFormat, {
      quality: options.videoQuality,
      preferWebM: options.preferWebM,
      preferH264: options.preferH264,
      preferMP4: options.preferMP4,
      isAudio: false
    });
    const audioFormat = chooseFormat(this.formatIds, options.audioFormat, {
      quality: options.audioQuality,
      language: options.audioLanguage,
      preferOpus: options.preferOpus,
      preferMP4: options.preferMP4,
      preferWebM: options.preferWebM,
      isAudio: true
    });
    if (this.durationMs < 0) {
      throw new Error("Invalid duration");
    }
    if (!videoFormat || !audioFormat) {
      throw new Error("No suitable formats found for download");
    }
    return { videoFormat, audioFormat };
  }
  //#endregion
  //#region --- Segment Fetching and Network Communication ---
  /**
   * Fetches and processes media segments from the server for the current ABR state.
   * @param abrState - The current client adaptive bitrate state.
   * @param selectedAudioFormat - The selected audio format.
   * @param selectedVideoFormat - The selected video format.
   * @throws {Error} If the server returns an error or no valid data.
   * @private
   */
  async fetchAndProcessSegments(abrState, selectedAudioFormat, selectedVideoFormat) {
    const initializedVideoFormat = this.initializedFormatsMap.get(fromFormat(selectedVideoFormat) || "");
    const initializedAudioFormat = this.initializedFormatsMap.get(fromFormat(selectedAudioFormat) || "");
    if (!this.cachedBufferedRanges?.length) {
      this.cachedBufferedRanges = this.buildBufferedRanges(initializedVideoFormat, initializedAudioFormat);
    }
    const requestBody = this.buildRequestBody(abrState, selectedAudioFormat, selectedVideoFormat);
    this.mediaHeadersProcessed = false;
    const response = await this.makeStreamingRequest(requestBody);
    const processedParts = await this.processStreamingResponse(response);
    if (!processedParts.length) {
      throw new Error("No valid parts received from server.");
    } else if ((this.streamProtectionStatus?.status || 0) >= 2 && !processedParts.includes(UMPPartId.MEDIA)) {
      throw new Error("No media parts or protocol updates received from server.");
    }
    if (processedParts.includes(UMPPartId.MEDIA_HEADER) && (initializedVideoFormat?.lastMediaHeaders?.length && initializedAudioFormat?.lastMediaHeaders?.length) || abrState.enabledTrackTypesBitfield !== 0 && this.mainFormat?.lastMediaHeaders?.length) {
      this.mediaHeadersProcessed = true;
    }
  }
  /**
   * Constructs an array of `BufferedRange` objects from initialized formats.
   * @param initializedVideoFormat - The initialized video format, if available.
   * @param initializedAudioFormat - The initialized audio format, if available.
   * @returns An array of `BufferedRange` objects.
   * @private
   */
  buildBufferedRanges(initializedVideoFormat, initializedAudioFormat) {
    const bufferedRanges = [];
    const formats = [initializedVideoFormat, initializedAudioFormat];
    for (const initializedFormat of formats) {
      if (!initializedFormat?.lastMediaHeaders.length) {
        continue;
      }
      if (
        // Skip formats marked for discarding; a dummy range will be created for them later.
        fromFormatInitializationMetadata(initializedFormat.formatInitializationMetadata) === this.formatToDiscard
      ) {
        continue;
      }
      const mediaHeaders = initializedFormat.lastMediaHeaders;
      const durationMs = mediaHeaders.reduce((sum, header) => sum + parseInt(header.durationMs || "0"), 0);
      bufferedRanges.push({
        durationMs: durationMs.toString(),
        formatId: initializedFormat.formatInitializationMetadata.formatId,
        startTimeMs: String(mediaHeaders[0].startMs || "0"),
        startSegmentIndex: mediaHeaders[0].sequenceNumber || 1,
        endSegmentIndex: mediaHeaders[mediaHeaders.length - 1].sequenceNumber || 1,
        timeRange: {
          durationTicks: durationMs.toString(),
          startTicks: mediaHeaders[0].startMs,
          timescale: mediaHeaders[0].timeRange?.timescale
        }
      });
      initializedFormat.lastMediaHeaders = [];
    }
    return bufferedRanges;
  }
  /**
   * Builds the protobuf request body for a `VideoPlaybackAbrRequest`.
   * @param abrState - The current client adaptive bitrate state.
   * @param selectedAudioFormat - The selected audio format.
   * @param selectedVideoFormat - The selected video format.
   * @returns The encoded request body as a `Uint8Array`.
   * @throws {Error} If required configuration (ustreamer config, client info) is missing.
   * @private
   */
  buildRequestBody(abrState, selectedAudioFormat, selectedVideoFormat) {
    if (!this.videoPlaybackUstreamerConfig)
      throw new Error("Video playback ustreamer config must be set before starting.");
    if (!this.clientInfo)
      throw new Error("Client info must be set before starting.");
    const bufferedRanges = this.cachedBufferedRanges || [];
    const { sabrContexts, unsentSabrContexts } = this.prepareSabrContexts();
    const { selectedFormatIds, updatedBufferedRanges } = this.prepareFormatSelections([selectedVideoFormat, selectedAudioFormat], bufferedRanges);
    return VideoPlaybackAbrRequest.encode({
      clientAbrState: abrState,
      preferredAudioFormatIds: [selectedAudioFormat],
      preferredVideoFormatIds: [selectedVideoFormat],
      preferredSubtitleFormatIds: [],
      selectedFormatIds,
      videoPlaybackUstreamerConfig: base64ToU8(this.videoPlaybackUstreamerConfig),
      streamerContext: {
        sabrContexts,
        unsentSabrContexts,
        poToken: this.poToken ? base64ToU8(this.poToken) : void 0,
        playbackCookie: this.nextRequestPolicy?.playbackCookie ? PlaybackCookie.encode(this.nextRequestPolicy.playbackCookie).finish() : void 0,
        clientInfo: this.clientInfo
      },
      bufferedRanges: updatedBufferedRanges,
      field1000: []
    }).finish();
  }
  /**
   * Prepares SABR context data for the request body.
   * @returns An object containing active and unsent SABR contexts.
   * @private
   */
  prepareSabrContexts() {
    const sabrContexts = [];
    const unsentSabrContexts = [];
    for (const ctxUpdate of this.sabrContexts.values()) {
      if (this.activeSabrContextTypes.has(ctxUpdate.type)) {
        sabrContexts.push(ctxUpdate);
      } else {
        unsentSabrContexts.push(ctxUpdate.type);
      }
    }
    return { sabrContexts, unsentSabrContexts };
  }
  /**
   * Prepares format selections and buffered ranges for the request body.
   * @param formats - An array of formats to process.
   * @param currentBufferedRanges - The current buffered ranges to update.
   * @returns An object with selected format IDs and updated buffered ranges.
   * @private
   */
  prepareFormatSelections(formats, currentBufferedRanges) {
    const selectedFormatIds = [];
    const updatedBufferedRanges = [...currentBufferedRanges];
    const formatsInitialized = this.initializedFormatsMap.size > 0;
    for (const format of formats) {
      const formatKey = fromFormat(format);
      const shouldDiscard = this.formatToDiscard && formatKey === this.formatToDiscard;
      if (shouldDiscard) {
        updatedBufferedRanges.push({
          formatId: format,
          durationMs: MAX_INT32_VALUE,
          startTimeMs: String(0),
          startSegmentIndex: parseInt(MAX_INT32_VALUE),
          endSegmentIndex: parseInt(MAX_INT32_VALUE),
          timeRange: {
            durationTicks: MAX_INT32_VALUE,
            startTicks: "0",
            timescale: 1e3
          }
        });
      }
      if (formatsInitialized || shouldDiscard) {
        selectedFormatIds.push(format);
      }
    }
    return { selectedFormatIds, updatedBufferedRanges };
  }
  /**
   * Executes a streaming POST request to the server.
   * @param body - The request body payload.
   * @returns A `Promise` that resolves with the server `Response`.
   * @throws {Error} If the server ABR streaming URL is not configured or the request fails.
   * @private
   */
  async makeStreamingRequest(body) {
    if (!this.serverAbrStreamingUrl) {
      throw new Error("Server ABR streaming URL not configured.");
    }
    const url = new URL(this.serverAbrStreamingUrl);
    url.searchParams.set("rn", this.requestNumber.toString());
    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => this.abortController?.abort(), 6e4);
    try {
      return await this.fetchFunction(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-protobuf",
          "accept-encoding": "identity",
          "accept": "application/vnd.yt-ump"
        },
        body,
        signal: this.abortController.signal
      });
    } finally {
      clearTimeout(timeoutId);
      this.requestNumber += 1;
    }
  }
  /**
   * Reads the response body as a stream and processes each UMP part.
   * @param response - The server response to process.
   * @returns A promise that resolves to an array of processed UMP part types.
   * @throws {Error} If the response is invalid, empty, or aborted.
   * @private
   */
  async processStreamingResponse(response) {
    if (!response.ok)
      throw new Error(`Server returned ${response.status} ${response.statusText}`);
    if (response.headers.get("content-type") !== "application/vnd.yt-ump")
      throw new Error(`Unexpected content type from server: ${response.headers.get("content-type")}`);
    const reader = response.body.getReader();
    let dataReceived = false;
    let partialPart;
    const processedParts = [];
    while (true) {
      if (this.abortController?.signal?.aborted && !this._aborted)
        throw new Error("Stream was aborted.");
      const { done, value } = await reader.read();
      if (done) {
        if (!dataReceived) {
          throw new Error("Received empty response from server.");
        }
        break;
      }
      dataReceived = true;
      let chunk;
      if (partialPart) {
        chunk = partialPart.data;
        chunk.append(value);
      } else {
        chunk = new CompositeBuffer([value]);
      }
      const ump = new UmpReader(chunk);
      partialPart = ump.read((part) => {
        processedParts.push(part.type);
        const handler = this.umpPartHandlers.get(part.type);
        if (handler) {
          handler(part);
        }
      });
    }
    return processedParts;
  }
  /**
   * Executes a function with automatic retries and exponential backoff.
   * Respects server-specified backoff times from `nextRequestPolicy`.
   * @param fetchFn - The function to execute.
   * @param maxRetries - The maximum number of retry attempts.
   * @returns A promise that resolves to `true` on success, or `false` if all retries fail.
   * @private
   */
  async executeWithRetry(fetchFn, maxRetries) {
    const backoffTimeMs = this.nextRequestPolicy?.backoffTimeMs || 0;
    if (backoffTimeMs > 0) {
      this.logger.debug(TAG, `Respecting server backoff policy: waiting ${backoffTimeMs}ms before request`);
      await wait(backoffTimeMs);
    }
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        await fetchFn();
        if (this.mediaHeadersProcessed) {
          this.cachedBufferedRanges = void 0;
        }
        return true;
      } catch (e) {
        const error = e;
        if (this._aborted) {
          this.logger.debug(TAG, "Download process aborted, skipping retry.");
          return false;
        }
        if (attempt > maxRetries) {
          this.logger.error(TAG, `Maximum retries (${maxRetries}) exceeded while fetching segment: ${error.message}`);
          this.errorHandler(error, true);
          break;
        }
        const retryBackoffMs = Math.min(BACKOFF_MULTIPLIER * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        this.logger.warn(TAG, `Segment fetch attempt ${attempt}/${maxRetries + 1} failed - retrying in ${retryBackoffMs}ms`, error);
        await wait(retryBackoffMs);
      } finally {
        this.partialSegmentQueue.clear();
      }
    }
    return false;
  }
  //#endregion
  //#region --- UMP Part Handlers ---
  /**
   * Decodes a UMP part using the provided decoder.
   * @param part
   * @param decoder
   * @private
   */
  decodePart(part, decoder) {
    if (!part.data.chunks.length)
      return void 0;
    try {
      return decoder.decode(concatenateChunks(part.data.chunks));
    } catch {
      return void 0;
    }
  }
  /**
   * Handles `FORMAT_INITIALIZATION_METADATA` parts.
   * Creates and stores a new `InitializedFormat` entry.
   * @private
   */
  handleFormatInitializationMetadata(part) {
    const formatInitMetadata = this.decodePart(part, FormatInitializationMetadata);
    if (!formatInitMetadata)
      return;
    const formatIdKey = fromFormatInitializationMetadata(formatInitMetadata);
    const initializedFormat = {
      formatInitializationMetadata: formatInitMetadata,
      downloadedSegments: /* @__PURE__ */ new Map(),
      lastMediaHeaders: []
    };
    this.initializedFormatsMap.set(formatIdKey, initializedFormat);
    this.logger.debug(TAG, `Initialized format: ${formatIdKey}`);
    this.emit("formatInitialization", initializedFormat);
  }
  /**
   * Handles `NEXT_REQUEST_POLICY` parts.
   * Stores the server's policy for backoff time and playback cookies.
   * @private
   */
  handleNextRequestPolicy(part) {
    this.nextRequestPolicy = this.decodePart(part, NextRequestPolicy);
  }
  /**
   * Handles `SABR_ERROR` parts.
   * Throws an error to terminate the current request attempt.
   * @throws {Error} Always throws with the SABR error details.
   * @private
   */
  handleSabrError(part) {
    const sabrError = this.decodePart(part, SabrError);
    if (!sabrError)
      return;
    throw new Error(`SABR Error: ${sabrError.type} - ${sabrError.code}`);
  }
  /**
   * Handles `SABR_REDIRECT` parts.
   * Updates the streaming URL to the new location provided by the server.
   * @private
   */
  handleSabrRedirect(part) {
    const sabrRedirect = this.decodePart(part, SabrRedirect);
    if (!sabrRedirect)
      return;
    if (sabrRedirect.url) {
      this.serverAbrStreamingUrl = sabrRedirect.url;
      this.logger.debug(TAG, `Redirecting to ${this.serverAbrStreamingUrl}`);
    }
  }
  /**
   * Handles `SABR_CONTEXT_UPDATE` parts.
   * Updates the client's context state based on server instructions.
   * @private
   */
  handleSabrContextUpdate(part) {
    const sabrContextUpdate = this.decodePart(part, SabrContextUpdate);
    if (!sabrContextUpdate)
      return;
    if (sabrContextUpdate.type !== void 0 && sabrContextUpdate.value?.length) {
      if (sabrContextUpdate.writePolicy === SabrContextUpdate_SabrContextWritePolicy.KEEP_EXISTING && this.sabrContexts.has(sabrContextUpdate.type)) {
        this.logger.debug(TAG, `Skipping SABR context update for type ${sabrContextUpdate.type}`);
        return;
      }
      this.sabrContexts.set(sabrContextUpdate.type, sabrContextUpdate);
      if (sabrContextUpdate.sendByDefault) {
        this.activeSabrContextTypes.add(sabrContextUpdate.type);
      }
      this.logger.debug(TAG, `Received SABR context update (type: ${sabrContextUpdate.type}, sendByDefault: ${sabrContextUpdate.sendByDefault})`);
    }
  }
  /**
   * Handles `SABR_CONTEXT_SENDING_POLICY` parts.
   * Updates which contexts should be sent in future requests.
   * @private
   */
  handleSabrContextSendingPolicy(part) {
    const sabrContextSendingPolicy = this.decodePart(part, SabrContextSendingPolicy);
    if (!sabrContextSendingPolicy)
      return;
    for (const startPolicy of sabrContextSendingPolicy.startPolicy) {
      if (!this.activeSabrContextTypes.has(startPolicy)) {
        this.activeSabrContextTypes.add(startPolicy);
        this.logger.debug(TAG, `Activated SABR context for type ${startPolicy}`);
      }
    }
    for (const stopPolicy of sabrContextSendingPolicy.stopPolicy) {
      if (this.activeSabrContextTypes.has(stopPolicy)) {
        this.activeSabrContextTypes.delete(stopPolicy);
        this.logger.debug(TAG, `Deactivated SABR context for type ${stopPolicy}`);
      }
    }
    for (const discardPolicy of sabrContextSendingPolicy.discardPolicy) {
      if (this.sabrContexts.has(discardPolicy)) {
        this.sabrContexts.delete(discardPolicy);
        this.logger.debug(TAG, `Discarded SABR context for type ${discardPolicy}`);
      }
    }
  }
  /**
   * Handles `STREAM_PROTECTION_STATUS` parts.
   * Emits updates and handles critical statuses like required attestation.
   * @throws {Error} If attestation is required (status 3).
   * @private
   */
  handleStreamProtectionStatus(part) {
    this.streamProtectionStatus = this.decodePart(part, StreamProtectionStatus);
    if (!this.streamProtectionStatus)
      return;
    this.emit("streamProtectionStatusUpdate", this.streamProtectionStatus);
    if (this.streamProtectionStatus.status === 3) {
      throw new Error("Cannot proceed with stream: attestation required");
    } else if (this.streamProtectionStatus.status === 2) {
      this.logger.warn(TAG, "Attestation pending.");
    }
  }
  /**
   * Handles `RELOAD_PLAYER_RESPONSE` parts.
   * Emits an event with reload parameters and terminates the session.
   * @throws {Error} Always throws to terminate the current streaming session.
   * @private
   */
  handleReloadPlayerResponse(part) {
    const reloadPlaybackContext = this.decodePart(part, ReloadPlaybackContext);
    if (!reloadPlaybackContext)
      return;
    const errorMessage = "Player response reload requested by server";
    this.logger.debug(TAG, `${errorMessage} (token: ${reloadPlaybackContext.reloadPlaybackParams?.token}`);
    this.emit("reloadPlayerResponse", reloadPlaybackContext);
    throw new Error(errorMessage);
  }
  /**
   * Handles `MEDIA_HEADER` parts.
   * Creates an entry in the `partialSegmentQueue` for the upcoming media chunks.
   * @private
   */
  handleMediaHeader(part) {
    const mediaHeader = this.decodePart(part, MediaHeader);
    if (!mediaHeader)
      return;
    const headerId = mediaHeader.headerId || 0;
    const formatIdKey = fromMediaHeader(mediaHeader);
    const segmentNumber = mediaHeader.isInitSeg ? 0 : mediaHeader.sequenceNumber || 0;
    const durationMs = mediaHeader.durationMs || Math.ceil(parseInt(mediaHeader.timeRange?.durationTicks || "0") / (mediaHeader.timeRange?.timescale || 0) * 1e3).toString();
    const initializedFormat = this.initializedFormatsMap.get(formatIdKey);
    if (!initializedFormat) {
      this.logger.warn(TAG, `No initialized format found for key: ${formatIdKey} (segment ${segmentNumber})`);
      return;
    }
    const mediaType = getMediaType(initializedFormat);
    if (initializedFormat.downloadedSegments.has(segmentNumber)) {
      this.logger.debug(TAG, `Segment ${formatIdKey} (segment: ${segmentNumber}) already downloaded. Ignoring.`);
      return;
    }
    this.partialSegmentQueue.set(headerId, {
      formatIdKey,
      segmentNumber,
      durationMs,
      mediaHeader,
      bufferedChunks: []
    });
    this.logger.debug(TAG, `Enqueued ${mediaType} segment ${segmentNumber} (Header ID: ${headerId}, key: ${formatIdKey}, duration: ${durationMs}ms)`);
  }
  /**
   * Handles `MEDIA` parts.
   * Buffers media data chunks associated with a specific header ID.
   * @private
   */
  handleMedia(part) {
    const headerId = part.data.getUint8(0);
    const segment = this.partialSegmentQueue.get(headerId);
    if (!segment) {
      this.logger.debug(TAG, `Received Media part for an unknown Header ID: ${headerId}`);
      return;
    }
    const initializedFormat = this.initializedFormatsMap.get(segment.formatIdKey);
    if (!initializedFormat) {
      this.logger.warn(TAG, `No initialized format found for key ${segment.formatIdKey} (segment ${segment.segmentNumber})`);
      return;
    }
    const dataBuffer = part.data.split(1).remainingBuffer;
    for (const chunk of dataBuffer.chunks) {
      segment.bufferedChunks.push(chunk);
    }
  }
  /**
   * Handles `MEDIA_END` parts.
   * Finalizes a segment, enqueues its data to the appropriate stream, and updates tracking.
   * @private
   */
  handleMediaEnd(part) {
    const headerId = part.data.getUint8(0);
    const segment = this.partialSegmentQueue.get(headerId);
    if (!segment) {
      this.logger.debug(TAG, `Received MediaEnd for an unknown Header ID: ${headerId}`);
      return;
    }
    const loadedBytes = segment.bufferedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (loadedBytes !== parseInt(segment.mediaHeader.contentLength || "0")) {
      this.logger.warn(TAG, `Content length mismatch for segment ${segment.segmentNumber} (Header ID: ${headerId}, key: ${segment.formatIdKey}, expected: ${segment.mediaHeader.contentLength}, received: ${loadedBytes})`);
      this.partialSegmentQueue.delete(headerId);
      return;
    }
    const initializedFormat = this.initializedFormatsMap.get(segment.formatIdKey);
    if (initializedFormat) {
      const mediaType = getMediaType(initializedFormat);
      if (segment.bufferedChunks.length) {
        for (const chunk of segment.bufferedChunks) {
          if (mediaType === "audio") {
            this.audioController?.enqueue(chunk);
          } else {
            this.videoController?.enqueue(chunk);
          }
        }
      }
      this.logger.debug(TAG, `Received MediaEnd for ${mediaType} segment ${segment.segmentNumber} (Header ID: ${headerId}, key: ${segment.formatIdKey})`);
      segment.bufferedChunks.length = 0;
      segment.bufferedChunks = [];
      initializedFormat.lastMediaHeaders.push(segment.mediaHeader);
      initializedFormat.downloadedSegments.set(segment.segmentNumber, segment);
      this.partialSegmentQueue.delete(headerId);
    }
  }
  //#endregion
  //#region --- Stream Validation and Integrity Checks ---
  /**
   * Validates and corrects the stream duration based on format initialization metadata.
   * @param formatInitializationMetadata - The metadata from an initialized format.
   * @private
   */
  validateAndCorrectDuration(formatInitializationMetadata) {
    const durationUnits = parseInt(formatInitializationMetadata.durationUnits || "0");
    const durationTimescale = parseInt(formatInitializationMetadata.durationTimescale || "0");
    if (durationTimescale === 0) {
      this.logger.warn(TAG, "Invalid timescale (0) in format initialization metadata");
      return;
    }
    const expectedDuration = Math.trunc(durationUnits / (durationTimescale / 1e3));
    if (this.durationMs !== expectedDuration) {
      this.durationMs = expectedDuration;
      this.logger.debug(TAG, `Corrected stream duration to ${this.durationMs}ms based on format initialization metadata`);
    }
  }
  /**
   * Validates downloaded segments for completeness and consistency after the stream finishes.
   * Checks for duration coverage, missing segments, and duplicates.
   * @private
   */
  validateDownloadedSegments() {
    for (const [formatIdKey, initializedFormat] of this.initializedFormatsMap.entries()) {
      if (formatIdKey === this.formatToDiscard) {
        this.logger.debug(TAG, `Skipping validation for discarded format: ${formatIdKey}`);
        continue;
      }
      const totalDuration = getTotalDownloadedDuration(initializedFormat);
      const durationUnits = parseInt(initializedFormat.formatInitializationMetadata.durationUnits || "0");
      const durationTimescale = parseInt(initializedFormat.formatInitializationMetadata.durationTimescale || "0");
      const expectedDuration = durationTimescale ? durationUnits / (durationTimescale / 1e3) : 0;
      const durationMismatch = Math.abs(totalDuration - expectedDuration);
      if (expectedDuration > 0 && durationMismatch > expectedDuration * 0.01) {
        const durationCoverage = Math.round(totalDuration / expectedDuration * 100);
        this.logger.warn(TAG, `Incomplete stream for format ${formatIdKey}: downloaded ${totalDuration}ms (${durationCoverage}%), expected ${expectedDuration}ms`);
      }
      const segments = Array.from(initializedFormat.downloadedSegments.entries());
      if (segments.length === 0)
        continue;
      segments.sort(([numA], [numB]) => numA - numB);
      const expectedSegmentCount = parseInt(initializedFormat.formatInitializationMetadata.endSegmentNumber || "0");
      const missingSegments = [];
      for (let i = 0; i <= expectedSegmentCount; i++) {
        if (!initializedFormat.downloadedSegments.has(i)) {
          missingSegments.push(i);
        }
      }
      const uniqueSegmentCount = new Set(segments.map(([num]) => num)).size;
      const hasDuplicates = uniqueSegmentCount !== segments.length;
      if (missingSegments.length > 0) {
        const message = `Format ${formatIdKey}: Missing segments: [${missingSegments.join(", ")}]. Expected range: 0-${expectedSegmentCount}. `;
        this.logger.warn(TAG, message);
        this.errorHandler(new Error(message), true);
      } else {
        this.logger.debug(TAG, `Format ${formatIdKey}: All ${expectedSegmentCount} segments present (100% coverage)`);
      }
      if (hasDuplicates) {
        const message = `Format ${formatIdKey}: Found duplicate segment numbers (${segments.length} segments but ${uniqueSegmentCount} unique numbers)`;
        this.logger.warn(TAG, message);
        this.errorHandler(new Error(message), true);
      }
    }
  }
  //#endregion
  /**
   * Resets the internal state of the stream.
   * Clears all maps, resets counters, and re-initializes the progress tracker.
   * @private
   */
  resetState() {
    this.initializedFormatsMap.clear();
    this.partialSegmentQueue.clear();
    this.activeSabrContextTypes.clear();
    this.sabrContexts.clear();
    this.nextRequestPolicy = void 0;
    this.mainFormat = void 0;
    this.requestNumber = 0;
    this.cachedBufferedRanges = void 0;
    this.mediaHeadersProcessed = false;
    this.streamProtectionStatus = void 0;
    this.formatToDiscard = void 0;
    this.abortController = void 0;
    this.progressTracker = {
      lastProgressTime: Date.now(),
      lastDownloadedDuration: 0,
      stallCount: 0
    };
  }
  /**
   * Handles errors during the streaming process.
   * @param error - The error that occurred.
   * @param notifyControllers - Whether to propagate the error to the stream controllers.
   * @private
   */
  errorHandler(error, notifyControllers = true) {
    this.resetState();
    this.logger.error(TAG, `Stream error: ${error.message}`);
    if (notifyControllers) {
      this._errored = true;
      this.videoController?.error(error);
      this.audioController?.error(error);
    }
  }
};

// src/media/fetch.js
function concatBytes(chunks, knownTotal) {
  const total = knownTotal ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
function makeByteBudget(maxBytes) {
  return { remaining: Number.isFinite(maxBytes) ? maxBytes : 512 * 1024 * 1024 };
}
function isUrlAllowed(url, allowedOrigins = [], pageOrigin = "") {
  const parsed = url instanceof URL ? url : new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  if (isPrivateHost(parsed.hostname)) {
    return parsed.origin === pageOrigin && allowedOrigins.some((entry) => matchAllowedEntry(parsed, entry));
  }
  return allowedOrigins.some((entry) => matchAllowedEntry(parsed, entry));
}
function matchAllowedEntry(parsed, entry) {
  if (!entry) return false;
  if (entry === parsed.origin) return true;
  if (entry === "<all_urls>" || entry === "*://*/*") return true;
  const match = String(entry).match(/^(https?|\*):\/\/(\*|\*\.[^/]+|[^/]+)\/\*$/);
  if (!match) return false;
  const [, scheme, host] = match;
  if (scheme !== "*" && `${scheme}:` !== parsed.protocol) return false;
  if (host === "*") return true;
  if (host.startsWith("*.")) {
    const suffix = host.slice(1);
    return parsed.hostname.endsWith(suffix) || parsed.hostname === host.slice(2);
  }
  return parsed.host === host || parsed.hostname === host;
}
function isPrivateHost(hostname) {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "0.0.0.0" || /^169\.254\./.test(hostname) || /^\[(?:f[cd]|fe[89ab]|::ffff:)/i.test(hostname)) return true;
  if (/^127\./.test(hostname) || hostname === "::1" || hostname === "[::1]") return true;
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

// src/shared/sabr-plan.js
function sameSabrFormatIdentity(previous, next) {
  if (!previous || !next || previous.itag !== next.itag || previous.mimeType !== next.mimeType) return false;
  for (const key of ["lastModified", "xtags", "audioTrackId", "language"]) {
    if ((previous[key] ?? "") !== (next[key] ?? "")) return false;
  }
  for (const key of ["isDrc", "isDubbed", "isAutoDubbed", "isDescriptive", "isSecondary", "isOriginal"]) {
    if (Boolean(previous[key]) !== Boolean(next[key])) return false;
  }
  return true;
}

// src/media/youtube-sabr.js
var UMP_CONTENT_TYPE = "application/vnd.yt-ump";
var MAX_SABR_POST_BYTES = 8 * 1024 * 1024;
var DEFAULT_STALL_MS = 3e4;
var MAX_RELOAD_TOKEN_BYTES = 16 * 1024;
var MAX_RELOAD_ATTEMPTS = 2;
var MAX_TOKEN_REFRESH_ATTEMPTS = 2;
async function readYouTubeSabrInputs(plan, signal, onProgress, options = {}) {
  let normalized = normalizeSabrPlan(plan);
  let reloads = 0;
  let tokenRefreshes = 0;
  while (true) {
    try {
      return await readYouTubeSabrAttempt(normalized, signal, onProgress, options);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      if (error?.code === "sabr-token-refresh" && Number.isInteger(error.protectionStatus)) {
        if (++tokenRefreshes > MAX_TOKEN_REFRESH_ATTEMPTS) {
          throw userError("sabr-token", "YouTube rejected refreshed SABR proof tokens too many times. Scan the video again.");
        }
        if (typeof options.onRefreshPoToken !== "function") {
          throw userError("sabr-token", `YouTube stream protection status ${error.protectionStatus} rejected this token. Scan the video again.`);
        }
        const refreshed2 = await awaitRefresh(options.onRefreshPoToken({ status: error.protectionStatus }, normalized), signal);
        normalized = normalizeTokenRefreshedSabrPlan(normalized, refreshed2);
        continue;
      }
      if (error?.code !== "sabr-reload" || !error.reloadPlaybackContext) throw error;
      if (++reloads > MAX_RELOAD_ATTEMPTS) {
        throw userError("sabr-reload", "YouTube requested too many SABR player response reloads. Scan the video again.");
      }
      if (typeof options.onReloadPlayerResponse !== "function") {
        throw userError("sabr-reload", "YouTube requested a fresh player response. Scan the video again.");
      }
      const refreshed = await awaitRefresh(options.onReloadPlayerResponse(error.reloadPlaybackContext, normalized), signal);
      normalized = normalizeReloadedSabrPlan(normalized, refreshed);
    }
  }
}
async function readYouTubeSabrAttempt(normalized, signal, onProgress, options = {}) {
  if (signal?.aborted) throw signal.reason || abortError();
  const budget = makeByteBudget(normalized.maxBytes);
  const StreamClass = options.SabrStreamClass || SabrStream;
  const stream = new StreamClass({
    fetch: createSabrFetch({
      allowedOrigins: normalized.allowedOrigins,
      pageOrigin: normalized.pageOrigin,
      signal,
      fetchImpl: options.fetchImpl || globalThis.fetch
    }),
    serverAbrStreamingUrl: normalized.sabr.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: normalized.sabr.videoPlaybackUstreamerConfig,
    clientInfo: normalized.sabr.clientInfo,
    poToken: normalized.poToken,
    durationMs: normalized.sabr.durationMs,
    formats: normalized.sabr.formats
  });
  const abortStream = () => stream.abort?.();
  signal?.addEventListener?.("abort", abortStream, { once: true });
  let protectionError;
  let protectionStatus;
  let reloadPlaybackContext;
  let reloadValidationError;
  stream.on?.("streamProtectionStatusUpdate", (status) => {
    protectionStatus = Number(status?.status || 0) || void 0;
    if (protectionStatus === 3) {
      protectionError = tokenRefreshError(protectionStatus);
      stream.abort?.();
    } else if (protectionStatus >= 4) {
      protectionError = userError("sabr-token", `YouTube stream protection status ${protectionStatus} rejected this token. Scan the video again.`);
      stream.abort?.();
    }
  });
  stream.on?.("reloadPlayerResponse", (context) => {
    try {
      reloadPlaybackContext = validateReloadPlaybackContext(context);
    } catch (error) {
      reloadValidationError = error;
    }
    stream.abort?.();
  });
  try {
    const result = await stream.start({
      videoFormat: normalized.videoItag,
      audioFormat: normalized.audioItag,
      enabledTrackTypes: normalized.action === "audio" ? EnabledTrackTypes.AUDIO_ONLY : EnabledTrackTypes.VIDEO_AND_AUDIO,
      maxRetries: positive(options.maxRetries) ?? 2,
      stallDetectionMs: positive(options.stallDetectionMs) ?? DEFAULT_STALL_MS
    });
    const totalBytes = totalPlannedBytes(normalized);
    let completedBytes = 0;
    const progress = (bytes) => {
      completedBytes += bytes;
      onProgress?.(completedBytes, totalBytes);
    };
    if (normalized.action === "audio") {
      const audio2 = await readSabrTrack(result.audioStream, {
        name: inputName("audio", result.selectedFormats.audioFormat.mimeType),
        mimeType: result.selectedFormats.audioFormat.mimeType || "audio/mp4",
        budget,
        signal,
        onChunk: progress,
        getProtectionError: () => protectionError,
        getProtectionStatus: () => protectionStatus,
        getReloadContext: () => reloadPlaybackContext,
        getReloadError: () => reloadValidationError
      });
      return [audio2];
    }
    let firstTrackError;
    const captureTrackError = (error) => {
      if (!firstTrackError) firstTrackError = error;
      stream.abort?.();
      throw error;
    };
    const [videoResult, audioResult] = await Promise.allSettled([
      readSabrTrack(result.videoStream, {
        name: inputName("video", result.selectedFormats.videoFormat.mimeType),
        mimeType: result.selectedFormats.videoFormat.mimeType || "video/mp4",
        budget,
        signal,
        onChunk: progress,
        getProtectionError: () => protectionError,
        getProtectionStatus: () => protectionStatus,
        getReloadContext: () => reloadPlaybackContext,
        getReloadError: () => reloadValidationError
      }).catch(captureTrackError),
      readSabrTrack(result.audioStream, {
        name: inputName("audio", result.selectedFormats.audioFormat.mimeType),
        mimeType: result.selectedFormats.audioFormat.mimeType || "audio/mp4",
        budget,
        signal,
        onChunk: progress,
        getProtectionError: () => protectionError,
        getProtectionStatus: () => protectionStatus,
        getReloadContext: () => reloadPlaybackContext,
        getReloadError: () => reloadValidationError
      }).catch(captureTrackError)
    ]);
    if (signal?.aborted) throw signal.reason || abortError();
    const retry = reloadErrorFromSettled([videoResult, audioResult], reloadPlaybackContext);
    if (retry) throw retry;
    if (protectionError) throw protectionError;
    if (firstTrackError) throw firstTrackError;
    if (videoResult.status === "rejected") throw videoResult.reason;
    if (audioResult.status === "rejected") throw audioResult.reason;
    const video = videoResult.value;
    const audio = audioResult.value;
    return [video, audio];
  } catch (error) {
    stream.abort?.();
    if (protectionError) throw protectionError;
    if (reloadValidationError) throw reloadValidationError;
    if (reloadPlaybackContext) throw reloadError(reloadPlaybackContext);
    throw error;
  } finally {
    signal?.removeEventListener?.("abort", abortStream);
  }
}
function createSabrFetch({ allowedOrigins = [], pageOrigin = "", signal, fetchImpl = globalThis.fetch } = {}) {
  return async (input, init = {}) => {
    const url = validateSabrUrl(input, allowedOrigins, pageOrigin);
    if (signal?.aborted || init.signal?.aborted) throw abortError();
    const bodyBytes = bodyByteLength(init.body);
    if (bodyBytes > MAX_SABR_POST_BYTES) throw userError("storage", "SABR request body exceeds the media safety limit.");
    const combined = combineSignals(signal, init.signal);
    const response = await fetchImpl(url.href, {
      ...init,
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal: combined.signal,
      headers: sanitizeSabrHeaders(init.headers)
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw userError("http", `SABR media request failed with HTTP ${response.status}.`, response.status);
    }
    const type = response.headers.get("content-type") || "";
    if (type.split(";", 1)[0].trim().toLowerCase() !== UMP_CONTENT_TYPE) {
      await response.body?.cancel?.();
      throw userError("type", `YouTube returned ${type || "an unexpected response"} for the selected SABR stream.`);
    }
    return response;
  };
}
function normalizeSabrPlan(plan) {
  if (!plan || plan.kind !== "sabr") throw userError("manifest", "Unsupported YouTube SABR plan.");
  const sabr = plan.sabr;
  if (!sabr || typeof sabr !== "object") throw userError("manifest", "The selected YouTube SABR stream is missing metadata. Scan again.");
  validateSabrUrl(sabr.serverAbrStreamingUrl, plan.allowedOrigins, plan.pageOrigin);
  if (typeof sabr.videoPlaybackUstreamerConfig !== "string" || !sabr.videoPlaybackUstreamerConfig) throw userError("manifest", "The selected YouTube SABR stream is missing its ustreamer config. Scan again.");
  if (!sabr.clientInfo || !Number.isInteger(sabr.clientInfo.clientName) || typeof sabr.clientInfo.clientVersion !== "string") throw userError("manifest", "The selected YouTube SABR stream is missing client metadata. Scan again.");
  if (!Array.isArray(sabr.formats) || !sabr.formats.length) throw userError("manifest", "The selected YouTube SABR stream has no format list. Scan again.");
  const videoItag = positive(plan.videoItag ?? plan.selectedVideoItag);
  const audioItag = positive(plan.audioItag ?? plan.selectedAudioItag);
  if (!videoItag || !audioItag) throw userError("manifest", "Select a YouTube video and audio format before downloading.");
  const video = sabr.formats.find((format) => format.itag === videoItag && isVideoFormat(format));
  const audio = sabr.formats.find((format) => format.itag === audioItag && isAudioFormat(format));
  if (!video || !audio) throw userError("manifest", "The selected YouTube SABR format is no longer available. Scan again.");
  if (!validPoToken(plan.poToken)) throw userError("sabr-token", "This YouTube format needs a proof token. Scan the video again.");
  if (positive(plan.tokenExpiresAt) && plan.tokenExpiresAt <= Date.now() + 1e4) throw userError("sabr-token", "This YouTube proof token has expired. Scan the video again.");
  return {
    ...plan,
    sabr,
    videoItag,
    audioItag,
    allowedOrigins: plan.allowedOrigins || [],
    pageOrigin: plan.pageOrigin || ""
  };
}
async function readSabrTrack(stream, { name, mimeType, budget, signal, onChunk, getProtectionError, getProtectionStatus, getReloadContext, getReloadError }) {
  const reader = stream?.getReader?.();
  if (!reader) throw userError("sabr", "YouTube SABR did not provide a readable media stream.");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (getProtectionError?.()) throw getProtectionError();
      if (getReloadError?.()) throw getReloadError();
      const reloadContext = getReloadContext?.();
      if (reloadContext) throw reloadError(reloadContext);
      signal?.throwIfAborted?.();
      const { done, value } = await reader.read();
      if (getProtectionError?.()) throw getProtectionError();
      if (getReloadError?.()) throw getReloadError();
      const postReadReloadContext = getReloadContext?.();
      if (postReadReloadContext) throw reloadError(postReadReloadContext);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw userError("sabr", "YouTube SABR returned an invalid media chunk.");
      total += value.byteLength;
      budget.remaining -= value.byteLength;
      if (budget.remaining < 0) throw userError("storage", "Media exceeds this job byte limit.");
      chunks.push(value);
      onChunk?.(value.byteLength);
    }
  } catch (error) {
    if (getProtectionStatus?.() === 2 && total === 0) throw tokenRefreshError(2);
    if (getProtectionError?.()) throw getProtectionError();
    if (getReloadError?.()) throw getReloadError();
    const reloadContext = getReloadContext?.();
    if (reloadContext) throw reloadError(reloadContext);
    throw error;
  } finally {
    await reader.cancel?.().catch(() => {
    });
    reader.releaseLock?.();
  }
  if (!total) {
    const status = getProtectionStatus?.();
    if (status === 2) throw tokenRefreshError(status);
    const detail = Number.isInteger(status) ? ` after stream protection status ${status}` : "";
    throw userError("sabr", `YouTube SABR returned no ${name.startsWith("audio") ? "audio" : "video"} data${detail}.`);
  }
  return { name, data: concatBytes(chunks, total), mimeType };
}
function validateSabrUrl(value, allowedOrigins = [], pageOrigin = "") {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw userError("permission", "Invalid YouTube SABR URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw userError("permission", "Invalid YouTube SABR URL.");
  if (!url.hostname.endsWith(".googlevideo.com") || url.pathname !== "/videoplayback") throw userError("permission", "YouTube SABR media must use a googlevideo playback endpoint.");
  if (!isUrlAllowed(url, allowedOrigins, pageOrigin)) throw userError("permission", `Origin is outside this job: ${url.origin}`);
  return url;
}
function sanitizeSabrHeaders(headers = {}) {
  const result = new Headers(headers);
  result.set("content-type", "application/x-protobuf");
  result.set("accept", UMP_CONTENT_TYPE);
  result.set("accept-encoding", "identity");
  for (const name of ["authorization", "cookie", "x-goog-authuser"]) result.delete(name);
  return result;
}
function bodyByteLength(body) {
  if (!body) return 0;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
  return 0;
}
function combineSignals(primary, secondary) {
  if (!primary) return { signal: secondary };
  if (!secondary || primary === secondary) return { signal: primary };
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(primary.reason || secondary.reason);
  };
  if (primary.aborted || secondary.aborted) abort();
  else {
    primary.addEventListener("abort", abort, { once: true });
    secondary.addEventListener("abort", abort, { once: true });
  }
  return { signal: controller.signal };
}
function totalPlannedBytes(plan) {
  const video = plan.sabr.formats.find((format) => format.itag === plan.videoItag);
  const audio = plan.sabr.formats.find((format) => format.itag === plan.audioItag);
  if (plan.action === "audio") return positive(audio?.contentLength);
  const videoLength = positive(video?.contentLength) || 0;
  const audioLength = positive(audio?.contentLength) || 0;
  return videoLength + audioLength || void 0;
}
function inputName(prefix, mimeType = "") {
  if (/webm/i.test(mimeType)) return `${prefix}.webm`;
  if (/audio\//i.test(mimeType) && /mp4|m4a|mp4a/i.test(mimeType)) return `${prefix}.m4a`;
  if (/mp4/i.test(mimeType)) return `${prefix}.mp4`;
  return `${prefix}.bin`;
}
function isVideoFormat(format) {
  return typeof format?.mimeType === "string" && format.mimeType.startsWith("video/");
}
function isAudioFormat(format) {
  return typeof format?.mimeType === "string" && format.mimeType.startsWith("audio/");
}
function validPoToken(value) {
  return typeof value === "string" && value.length > 20 && value.length <= 512 && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}
function normalizeReloadedSabrPlan(previous, refreshed) {
  if (!refreshed || typeof refreshed !== "object") {
    throw userError("sabr-reload", "YouTube returned no refreshed SABR metadata. Scan the video again.");
  }
  const candidate = normalizeSabrPlan({
    ...previous,
    sabr: refreshed.sabr,
    poToken: refreshed.poToken,
    tokenExpiresAt: refreshed.tokenExpiresAt
  });
  for (const itag of [previous.videoItag, previous.audioItag]) {
    const original = previous.sabr.formats.find((format) => format.itag === itag);
    const refreshedFormat = candidate.sabr.formats.find((format) => format.itag === itag);
    if (!sameSabrFormatIdentity(original, refreshedFormat)) {
      throw userError("manifest", "The refreshed YouTube SABR metadata changed the selected formats. Scan again.");
    }
  }
  return candidate;
}
function normalizeTokenRefreshedSabrPlan(previous, refreshed) {
  if (!refreshed || typeof refreshed !== "object") {
    throw userError("sabr-token", "YouTube returned no refreshed SABR proof token. Scan the video again.");
  }
  if (refreshed.poToken === previous.poToken) {
    throw userError("sabr-token", "YouTube returned the same SABR proof token after rejection. Scan the video again.");
  }
  const tokenExpiresAt = positive(refreshed.tokenExpiresAt);
  if (!tokenExpiresAt || tokenExpiresAt <= Date.now() + 1e4) {
    throw userError("sabr-token", "This YouTube proof token has expired. Scan the video again.");
  }
  return normalizeSabrPlan({
    ...previous,
    poToken: refreshed.poToken,
    tokenExpiresAt
  });
}
function validateReloadPlaybackContext(context) {
  const token = context?.reloadPlaybackParams?.token;
  if (typeof token !== "string") throw userError("sabr-reload", "YouTube requested an invalid SABR reload. Scan the video again.");
  const tokenBytes = new TextEncoder().encode(token).byteLength;
  if (!token || tokenBytes > MAX_RELOAD_TOKEN_BYTES || !/^(?:[A-Za-z0-9_+\/=-]|%[0-9A-Fa-f]{2})+$/.test(token)) {
    throw userError("sabr-reload", "YouTube requested an invalid SABR reload. Scan the video again.");
  }
  return { reloadPlaybackParams: { token } };
}
function reloadErrorFromSettled(results, fallbackContext) {
  for (const result of results) {
    if (result.status === "rejected" && result.reason?.code === "sabr-reload") return result.reason;
  }
  return fallbackContext ? reloadError(fallbackContext) : void 0;
}
function reloadError(context) {
  const error = userError("sabr-reload", "YouTube requested a fresh SABR player response.");
  error.reloadPlaybackContext = context;
  return error;
}
function tokenRefreshError(status) {
  const error = userError("sabr-token-refresh", `YouTube stream protection status ${status} needs a fresh proof token.`);
  error.protectionStatus = status;
  return error;
}
async function awaitRefresh(refreshPromise, signal) {
  if (!signal) return refreshPromise;
  signal.throwIfAborted?.();
  if (signal.aborted) throw abortError();
  let abort;
  try {
    return await Promise.race([
      refreshPromise,
      new Promise((_, reject) => {
        abort = () => reject(signal.reason || abortError());
        signal.addEventListener("abort", abort, { once: true });
      })
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
function positive(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : void 0;
}
function abortError() {
  const error = new DOMException("The operation was aborted.", "AbortError");
  error.mediaCode = "abort";
  return error;
}
function userError(code, message, httpStatus) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}
export {
  createSabrFetch,
  normalizeSabrPlan,
  readYouTubeSabrInputs
};
