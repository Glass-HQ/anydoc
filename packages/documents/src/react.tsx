import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from "react";
import type { DocumentSource } from "./core/source.js";
import { initialState, type ViewerState } from "./view/state.js";
import { createViewer, type DocumentViewer, type ViewerOptions } from "./view/viewer.js";

export * from "./index.js";

export interface UseDocumentViewer {
  /** Attach to the element the document fills. Give it a size. */
  readonly ref: (element: HTMLElement | null) => void;
  /** Page, zoom, search and sheet state for your controls. */
  readonly state: ViewerState;
  /** The actions behind those controls; null until the element mounts. */
  readonly viewer: DocumentViewer | null;
}

const noop = () => () => {};

/**
 * Show a document in an element you render, and get what its controls need.
 * The viewer reopens when the source, format or name changes; other options
 * are read when they're used, so they don't have to be stable.
 */
export function useDocumentViewer(source: DocumentSource, options: ViewerOptions = {}): UseDocumentViewer {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<DocumentViewer | null>(null);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!element) return;
    const current = latest.current;
    const next = createViewer(element, source, {
      ...current,
      highlight: current.highlight && ((text, name) => latest.current.highlight!(text, name)),
      onLink: (url) => latest.current.onLink?.(url),
    });
    setViewer(next);
    return () => {
      next.destroy();
      setViewer(null);
    };
  }, [element, source, options.format, options.name, options.mediaType, options.maxBytes]);
  const state = useSyncExternalStore(viewer?.subscribe ?? noop, viewer?.getState ?? (() => initialState), () => initialState);
  return { ref: setElement, state, viewer };
}

export interface DocumentViewProps extends ViewerOptions {
  readonly source: DocumentSource;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Receives the viewer once it exists, and null when it goes away. */
  readonly onViewer?: (viewer: DocumentViewer | null) => void;
}

/** A document filling a div. Use `useDocumentViewer` instead to draw controls beside it. */
export function DocumentView({ source, className, style, onViewer, ...options }: DocumentViewProps): ReactElement {
  const { ref, viewer } = useDocumentViewer(source, options);
  const report = useRef(onViewer);
  report.current = onViewer;
  useEffect(() => report.current?.(viewer), [viewer]);
  return <div className={className} ref={ref} style={{ height: "100%", ...style }} />;
}
