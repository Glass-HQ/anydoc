import type { DocumentFormat } from "../core/formats.js";
import type { ViewerOptions } from "./viewer.js";

/** What a renderer is handed: an empty element to fill, and the file's bytes. */
export interface RenderContext {
  readonly element: HTMLElement;
  readonly bytes: Uint8Array;
  readonly format: DocumentFormat;
  readonly name: string | undefined;
  readonly signal: AbortSignal;
  readonly options: ViewerOptions;
  /** Tells the viewer the visible page or sheet changed through scrolling or a click. */
  readonly onPosition: (position: { readonly page?: number; readonly sheet?: number }) => void;
}

/**
 * One format's renderer. Each capability it leaves out is one the viewer
 * reports as absent, so controls for it never show.
 */
export interface Renderer {
  readonly pages?: {
    readonly total: number;
    /** 0-based. */
    goTo(index: number): void;
  };
  readonly sheets?: {
    readonly names: readonly string[];
    select(index: number): void;
  };
  readonly zoom?: {
    readonly min: number;
    readonly max: number;
    apply(value: number): void;
  };
  readonly search?: Searchable;
  /** Draw a small picture of a page or slide into an element; returns its cleanup. */
  readonly thumbnails?: {
    render(index: number, element: HTMLElement, width: number): () => void;
  };
  destroy(): void;
}

export interface Searchable {
  /** Find every match, reporting batches as they come; resolves when done. */
  find(query: string, signal: AbortSignal, onMatches: (total: number) => void): Promise<number>;
  /** Highlight a match (0-based) and bring it into view. */
  show(index: number): void;
  clear(): void;
}

export type RenderFunction = (context: RenderContext) => Promise<Renderer>;
