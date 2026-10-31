# @glass-hq/documents

Parse any file to Markdown and show it in your app: PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV and TSV, Markdown and text, images, video, audio and fonts.

```js
import { toMarkdown, createViewer } from '@glass-hq/documents';

const markdown = await toMarkdown(file);
const viewer = createViewer(element, file); // headless: draw your own controls from viewer.getState()
```

React: `useDocumentViewer` and `<DocumentView>` from `@glass-hq/documents/react`.

Formats, options, theming and the security model are in the [repository's README](https://github.com/Glass-HQ/anydoc#readme).
