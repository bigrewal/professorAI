import { createElement } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export const remarkPlugins = [remarkGfm, remarkMath];
export const rehypePlugins = [[rehypeKatex, { trust: false, strict: "ignore", maxExpand: 100 }]];
export const markdownComponents = {
  // Tutor output and uploaded text are untrusted; never fetch embedded images.
  img: () => null,
  a: ({ node, ...props }) => createElement("a", { ...props, target: "_blank", rel: "noopener noreferrer" }),
};
