import type { DocumentError } from "../core/errors.js";
import type { DocumentFormat } from "../core/formats.js";

/**
 * Everything a viewer's controls need, as plain data. A part is absent when
 * the open document has no such thing: a video has no pages, an image no
 * search. Render it however you like; the viewer draws no controls itself.
 */
export interface ViewerState {
  readonly status: "loading" | "ready" | "error";
  readonly format: DocumentFormat | undefined;
  readonly error: DocumentError | undefined;
  /** Pages of a PDF, or slides of a presentation. 1-based. */
  readonly page: { readonly current: number; readonly total: number } | undefined;
  /** The tabs of a spreadsheet. 0-based. */
  readonly sheets: { readonly names: readonly string[]; readonly current: number } | undefined;
  /** 1 is 100%. */
  readonly zoom: { readonly value: number; readonly min: number; readonly max: number } | undefined;
  readonly search: SearchState | undefined;
}

export interface SearchState {
  readonly query: string;
  /** Matches found so far. */
  readonly total: number;
  /** The selected match, 1-based; 0 when there are none. */
  readonly current: number;
  /** Still searching: `total` may grow. */
  readonly pending: boolean;
}

export const initialState: ViewerState = {
  status: "loading",
  format: undefined,
  error: undefined,
  page: undefined,
  sheets: undefined,
  zoom: undefined,
  search: undefined,
};

/** A minimal external store: the shape React's useSyncExternalStore and most UI libraries take. */
export class Store<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get = (): T => this.#value;

  set(next: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (!Object.is(this.#value[key], next[key])) changed = true;
    }
    if (!changed) return;
    this.#value = { ...this.#value, ...next };
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}
