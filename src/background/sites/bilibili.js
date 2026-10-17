import { isBilibiliMediaUrl } from '../../shared/bilibili.js';

export default { networkItems };

// Video and audio .m4s requests are separate pieces of the adapter's one merged card.
export function networkItems({ url }) {
  return isBilibiliMediaUrl(url) ? null : undefined;
}
