const blocked = "script,iframe,frame,object,embed,base,link,meta,form,input,button,textarea,select,portal";
const urlAttributes = new Set(["src", "href", "xlink:href", "poster", "background", "action", "formaction", "data"]);
const cssUrl = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
const cssImport = /@import[^;]*;?/giu;
const local = /^(?:data:image\/|blob:|#)/iu;

/**
 * Make markup a third-party renderer produced from an untrusted file inert:
 * no scripts, frames, forms or event handlers, and no URL that leaves the
 * page except links, which `followLinks` routes to the app.
 */
export function sanitize(root: Element | DocumentFragment): void {
  for (const element of root.querySelectorAll(blocked)) element.remove();
  for (const style of root.querySelectorAll("style")) style.textContent = cleanCss(style.textContent ?? "");
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "srcset" || name === "ping") element.removeAttribute(attribute.name);
      else if (name === "style") element.setAttribute("style", cleanCss(attribute.value));
      else if (urlAttributes.has(name)) {
        const isLink = name === "href" && element.localName === "a";
        if (!local.test(attribute.value.trim()) && !(isLink && /^(?:https?:|mailto:)/iu.test(attribute.value.trim()))) element.removeAttribute(attribute.name);
      }
    }
  }
}

function cleanCss(css: string): string {
  return css.replace(cssImport, "").replace(cssUrl, (match, _quote, url: string) => (local.test(url.trim()) ? match : "none"));
}
