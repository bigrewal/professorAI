import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { markdownComponents, rehypePlugins, remarkPlugins } from "../client/src/components/markdown.js";

function render(text) {
  return renderToStaticMarkup(createElement(Markdown, { skipHtml: true, components: markdownComponents, remarkPlugins, rehypePlugins }, text));
}

test("renders tutor Markdown and math without executing untrusted content", () => {
  const output = render('## Key idea\n\n**Important:** $x^2$\n\n- First\n- Second\n\n[bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![external](https://example.org/tracker.png)');
  assert.match(output, /<h2>Key idea<\/h2>/);
  assert.match(output, /<strong>Important:<\/strong>/);
  assert.match(output, /<ul>/);
  assert.match(output, /class="katex"/);
  assert.match(output, /<math/);
  assert.doesNotMatch(output, /javascript:|onerror|<img|tracker\.png/);
  assert.doesNotThrow(() => render('A streamed **partial answer with $x^'));
});
