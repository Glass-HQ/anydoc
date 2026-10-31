const allowed = /^(?:https?:|mailto:)/iu;

/**
 * Links inside a document never navigate the page: a click on an http(s) or
 * mailto link goes to `onLink`, a click on a `#fragment` scrolls to it, and
 * everything else does nothing.
 */
export function followLinks(root: HTMLElement, onLink: ((url: string) => void) | undefined): () => void {
  const click = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor || !root.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      root.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (allowed.test(href.trim())) onLink?.(href.trim());
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
}

export const isAllowedLink = (url: string) => allowed.test(url.trim());
