// Background rules for Tumblr. See ./index.js for the contract.
// None needed: posts play whole MP4 and MP3 files (no segments or playlists) from
// va.media.tumblr.com and <n>.media.tumblr.com, which answer without a Referer or cookie, and a
// network sighting carries the same URL as the adapter's card, so the two merge into it.
export default {};
