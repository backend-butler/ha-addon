/**
 * Model output is untrusted (device names, media titles etc. can carry injected instructions), so it must
 * not be able to make the browser fetch arbitrary URLs: no images at all, and only http(s)/mailto/relative links.
 */
export function safeUrl(url: string, key: string, node: { tagName?: string }): string | null {
  if (node.tagName !== "a" || key !== "href") return null;
  // A Butler action link (?butler=…) in a reply would let injected text start one with a click.
  if (/[?&]butler=/i.test(url)) return null;
  return /^(https?:|mailto:|#|\/(?!\/))/i.test(url) ? url : null;
}
