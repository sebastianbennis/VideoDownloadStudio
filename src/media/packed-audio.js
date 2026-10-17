// HLS packed audio (RFC 8216, section 3.4): ADTS AAC frames with ID3v2 tags that carry timestamps
// and metadata. X Spaces put tags before the first frame and between frames, so a segment
// becomes plain, playable ADTS by dropping every tag at a frame boundary.
const ID3_HEADER = 10;
const ADTS_HEADER = 7;

// ADTS after any leading ID3 tags; packed MP3 and other audio stay with their old handling.
export function isPackedAudio(bytes) {
  let offset = 0;
  for (let tags = 0; tags < 16 && isId3(bytes, offset); tags += 1) offset += ID3_HEADER + tagSize(bytes, offset);
  return isAdts(bytes, offset);
}

// The segment's ADTS frames without its ID3 tags. Throws on anything else, including a frame or
// tag cut short, so a truncated segment is never saved as complete audio.
export function extractAdts(bytes) {
  const output = new Uint8Array(bytes.length);
  let written = 0;
  let frames = 0;
  for (let offset = 0; offset < bytes.length;) {
    if (isId3(bytes, offset)) {
      offset += id3Length(bytes, offset);
      continue;
    }
    if (!isAdts(bytes, offset)) throw userError('The HLS audio segment is not valid AAC.');
    const length = ((bytes[offset + 3] & 0x03) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
    // A header with a CRC (protection_absent = 0) is two bytes longer.
    if (length < (bytes[offset + 1] & 0x01 ? ADTS_HEADER : ADTS_HEADER + 2) || offset + length > bytes.length) throw userError('The HLS audio segment ends inside an AAC frame.');
    output.set(bytes.subarray(offset, offset + length), written);
    written += length;
    offset += length;
    frames += 1;
  }
  if (!frames) throw userError('The HLS audio segment has no AAC frames.');
  return output.subarray(0, written);
}

// "ID3", a version other than 0xFF and a synchsafe size (no byte with its top bit set).
function isId3(bytes, offset) {
  return offset + ID3_HEADER <= bytes.length && bytes[offset] === 0x49 && bytes[offset + 1] === 0x44 && bytes[offset + 2] === 0x33
    && bytes[offset + 3] !== 0xff && bytes[offset + 4] !== 0xff && (bytes[offset + 6] | bytes[offset + 7] | bytes[offset + 8] | bytes[offset + 9]) < 0x80;
}

function id3Length(bytes, offset) {
  const length = ID3_HEADER + tagSize(bytes, offset);
  if (offset + length > bytes.length) throw userError('The HLS audio segment ends inside an ID3 tag.');
  return length;
}

// Tag body plus the optional footer, after the 10-byte header.
function tagSize(bytes, offset) {
  return ((bytes[offset + 6] << 21) | (bytes[offset + 7] << 14) | (bytes[offset + 8] << 7) | bytes[offset + 9]) + (bytes[offset + 5] & 0x10 ? ID3_HEADER : 0);
}

// The 12-bit ADTS sync word with layer 0.
function isAdts(bytes, offset) {
  return offset + ADTS_HEADER <= bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xf6) === 0xf0;
}

function userError(message) { return Object.assign(new Error(message), { code: 'manifest' }); }
