import { memo } from "react";
import Markdown from "react-markdown";
import { markdownComponents, rehypePlugins, remarkPlugins } from "./markdown.js";

export const TutorMarkdown = memo(function TutorMarkdown({ text }) {
  return <div className="tutor-markdown"><Markdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents}>{text}</Markdown></div>;
});
