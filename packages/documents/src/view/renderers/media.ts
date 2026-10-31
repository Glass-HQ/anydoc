import { formats } from "../../core/formats.js";
import type { RenderContext, RenderFunction, Renderer } from "../renderer.js";
import { cssZoom } from "../zoom.js";

/** The browser's own players and image decoder, fed from memory. */
function mediaElement(context: RenderContext, tag: "img" | "video" | "audio"): Renderer {
  const { element, bytes, name } = context;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType(context) }));
  const wrapper = element.ownerDocument.createElement("div");
  wrapper.className = "documents-center";
  const media = element.ownerDocument.createElement(tag);
  if (media instanceof HTMLImageElement) {
    // An <img> never runs an SVG's scripts or loads what it links to.
    media.alt = name ?? "";
    media.decoding = "async";
  } else {
    (media as HTMLMediaElement).controls = true;
    (media as HTMLMediaElement).preload = "metadata";
  }
  media.addEventListener("error", () => {
    const message = element.ownerDocument.createElement("p");
    message.className = "documents-message";
    message.textContent = `This browser can't ${tag === "img" ? "show" : "play"} ${name ?? "this file"}.`;
    wrapper.replaceChildren(message);
  });
  media.setAttribute("src", url);
  wrapper.append(media);
  element.replaceChildren(wrapper);
  return {
    ...(tag === "img" ? { zoom: cssZoom(media, 0.1, 10) } : {}),
    destroy: () => {
      element.replaceChildren();
      URL.revokeObjectURL(url);
    },
  };
}

/** The file's own type when its name gives one, so the browser picks the right decoder. */
function mediaType({ format, name }: RenderContext): string {
  const extension = name?.split(".").at(-1)?.toLowerCase();
  const types: readonly string[] = formats[format].mediaTypes;
  if (format === "svg") return "image/svg+xml";
  return types.find((type) => extension !== undefined && type.endsWith(`/${extension === "jpg" ? "jpeg" : extension}`)) ?? "";
}

export const renderImage: RenderFunction = async (context) => mediaElement(context, "img");
export const renderVideo: RenderFunction = async (context) => mediaElement(context, "video");
export const renderAudio: RenderFunction = async (context) => mediaElement(context, "audio");
