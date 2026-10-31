// The playground: Markdown from `toMarkdown`, the document from `createViewer`,
// and controls drawn by this page from the viewer's state.
import { createViewer, toMarkdown, openDocument, formats } from '@glass-hq/documents';

const $ = (id) => document.getElementById(id);
const output = $('output');
const controls = $('controls');
let markdown = '';
let baseName = 'document';
let viewer;
let unsubscribe = () => {};
const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Search' });
search.addEventListener('input', () => viewer.search(search.value));
search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.shiftKey ? viewer.previousMatch() : viewer.nextMatch();
});

async function show(name, source) {
  baseName = name.replace(/\.[^.]*$/, '') || 'document';
  $('result').hidden = false;
  $('result-name').textContent = name;
  $('result-arrow').hidden = true;
  $('result-stats').textContent = '';
  output.textContent = '';
  unsubscribe();
  viewer?.destroy();
  search.value = '';
  const opened = await openDocument(source, { name });
  viewer = createViewer($('viewer'), opened.bytes, {
    name,
    format: opened.format,
    onLink: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  });
  unsubscribe = viewer.subscribe(() => {
    drawControls();
    drawRail();
  });
  drawControls();
  drawRail();
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const started = performance.now();
  try {
    markdown = await toMarkdown(opened);
    const ms = Math.max(1, Math.round(performance.now() - started));
    $('result-arrow').hidden = false;
    $('result-stats').textContent = `${formats[opened.format].label} · ${markdown.length.toLocaleString('en-US')} chars · ${ms} ms`;
    output.textContent = markdown;
    output.classList.remove('error');
  } catch (error) {
    markdown = '';
    output.textContent = `Could not convert this file: ${error.message ?? error}`;
    output.classList.add('error');
  }
}

/** Bring-your-own controls: plain buttons bound to the viewer's state and actions. */
function drawControls() {
  const state = viewer.getState();
  const button = (label, title, action, disabled = false) => {
    const b = Object.assign(document.createElement('button'), { textContent: label, title, disabled });
    b.addEventListener('click', action);
    return b;
  };
  const text = (value) => Object.assign(document.createElement('span'), { textContent: value });
  const parts = [];
  if (state.status === 'loading') parts.push(text('Opening…'));
  if (state.status === 'error') parts.push(text(state.error.message));
  if (state.page) {
    parts.push(button('‹', 'Previous page', () => viewer.previousPage(), state.page.current <= 1));
    parts.push(text(`${state.page.current} / ${state.page.total}`));
    parts.push(button('›', 'Next page', () => viewer.nextPage(), state.page.current >= state.page.total));
  }
  if (state.sheets && state.sheets.names.length > 1) {
    const select = document.createElement('select');
    state.sheets.names.forEach((name, index) => select.append(new Option(name, String(index), false, index === state.sheets.current)));
    select.addEventListener('change', () => viewer.selectSheet(Number(select.value)));
    parts.push(select);
  }
  if (state.zoom) {
    parts.push(button('−', 'Zoom out', () => viewer.zoomOut(), state.zoom.value <= state.zoom.min));
    parts.push(button(`${Math.round(state.zoom.value * 100)}%`, 'Reset zoom', () => viewer.resetZoom()));
    parts.push(button('+', 'Zoom in', () => viewer.zoomIn(), state.zoom.value >= state.zoom.max));
  }
  parts.push(Object.assign(document.createElement('span'), { className: 'spacer' }));
  // The search box stays the same element across redraws, so typing keeps its focus.
  search.hidden = !state.search;
  if (state.search) {
    parts.push(search);
    if (state.search.query) parts.push(text(state.search.pending ? `${state.search.total}…` : `${state.search.current} of ${state.search.total}`));
  }
  const focused = document.activeElement === search;
  controls.replaceChildren(...parts);
  if (focused) search.focus();
}

/** Thumbnails, drawn lazily as they scroll into the rail, through viewer.renderThumbnail. */
let railFor;
let railCleanups = [];
function drawRail() {
  const rail = $('thumbs');
  const state = viewer.getState();
  if (!state.page || state.page.total < 2) {
    rail.hidden = true;
    return;
  }
  rail.hidden = false;
  if (railFor !== viewer) {
    railFor = viewer;
    for (const cleanup of railCleanups) cleanup();
    railCleanups = [];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        railCleanups.push(viewer.renderThumbnail(Number(entry.target.dataset.page), entry.target, 96));
      }
    }, { root: rail, rootMargin: '200px' });
    railCleanups.push(() => observer.disconnect());
    rail.replaceChildren(...Array.from({ length: state.page.total }, (_, i) => {
      const button = document.createElement('button');
      const thumb = Object.assign(document.createElement('div'), { className: 'thumb' });
      thumb.dataset.page = String(i + 1);
      observer.observe(thumb);
      button.append(thumb, String(i + 1));
      button.addEventListener('click', () => viewer.goToPage(i + 1));
      return button;
    }));
  }
  rail.querySelectorAll('button').forEach((button, i) => {
    const current = i + 1 === state.page.current;
    button.toggleAttribute('aria-current', current);
    if (current) button.setAttribute('aria-current', 'page');
  });
}

for (const tab of ['view', 'markdown']) {
  $(`tab-${tab}`).addEventListener('click', () => {
    for (const other of ['view', 'markdown']) {
      $(`tab-${other}`).setAttribute('aria-selected', String(other === tab));
      $(`pane-${other}`).hidden = other !== tab;
    }
  });
}

const drop = $('drop');
const file = $('file');
drop.addEventListener('click', () => file.click());
file.addEventListener('change', () => file.files[0] && show(file.files[0].name, file.files[0]));
for (const eventName of ['dragover', 'drop']) window.addEventListener(eventName, (event) => event.preventDefault());
drop.addEventListener('dragover', () => drop.classList.add('over'));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (event) => {
  drop.classList.remove('over');
  const dropped = event.dataTransfer?.files?.[0];
  if (dropped) show(dropped.name, dropped);
});
for (const sample of document.querySelectorAll('[data-sample]')) {
  sample.addEventListener('click', async () => {
    const response = await fetch(sample.dataset.sample);
    show(sample.textContent, new Uint8Array(await response.arrayBuffer()));
  });
}
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(markdown);
  $('copy').textContent = 'Copied';
  setTimeout(() => ($('copy').textContent = 'Copy'), 1200);
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
  Object.assign(document.createElement('a'), { href: url, download: `${baseName}.md` }).click();
  URL.revokeObjectURL(url);
});

$('drop-title').textContent = 'Drop any file here';
$('drop-hint').innerHTML = 'or <u>browse</u> for one. Everything happens locally, nothing is uploaded.';
