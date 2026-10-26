# Professor

Professor turns course PDFs, notes, and slides into a lesson path. It teaches one idea at a time, pauses when you do, and answers by voice or text before picking the lesson back up.

The interface is a Vite app in `client/`. The API is an Express server in `server/`. Teaching calls go through the [AI SDK](https://ai-sdk.dev) provider registry, so the same lesson player can use xAI, OpenAI, Anthropic, or Google.

## Run

```bash
npm install
cp .env.example .env.local
```

Add at least one provider key, then:

```bash
npm run dev
```

The server loads `.env.local` before `.env`; existing shell variables take precedence. For Grok, set `XAI_API_KEY` in `.env.local` and restart the server. Keep this file private; it is ignored by Git.

The study interface is at `http://127.0.0.1:3001` (including `npm run preview -w client`). The API is at `http://127.0.0.1:3000`.

`npm start` builds the client and serves it from the API.

New page explanations and answers stream into the tutor panel as they arrive. The conversation follows the response while you are at the bottom; scroll up to read earlier messages without being pulled back down. Saved explanations appear immediately; use **Start fresh** to request a new one.

Use **Explain simply** or **Go deeper** to ask the connected tutor to adjust its explanation. **Learning memory** lets you edit your background and course-specific notes and choose whether recent questions from other pages provide context. It uses up to six questions still in the course chat; clearing a page removes its questions. These notes and questions are sent to the selected model with new requests.

The tutor uses extracted page text, which may omit equations or diagrams. Open **What the tutor can read** to check it; only the first 6,000 characters are sent. When using a supported Grok model, select **Include this page image** to send an image of the current PDF page with questions or a manually requested explanation, including on pages without extractable text. The image is sent only while the option is selected and is not saved in the course chat. Model interpretation can still be mistaken, so compare its answer with the page.

Tutor responses support Markdown and mathematical notation, including while streaming. Use the navigation toggle to show or hide the sidebar; the reading view starts with it hidden until you choose a preference. Page progress measures saved explanations, not understanding.

## Models

Open the Tutor menu in the app and pick a model. Only providers with an API key are selectable:

- `XAI_API_KEY` — Grok
- `OPENAI_API_KEY` — GPT
- `ANTHROPIC_API_KEY` — Claude
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini

With xAI configured and no saved model choice, the tutor defaults to Grok 4.3. Page explanations and answers use its non-reasoning setting for faster responses; Grok 4.5 and 4.7 use low reasoning for page tutoring. You can still select another model from the Tutor menu.

The PDF reader opens in **Fit page**, so the full page fits in the available viewing area. Use the zoom menu for a larger view or fit to width.

Lessons opened after a switch are prepared with the new model. Rebuild a course path when you want the syllabus rewritten too. With no key, Professor still teaches directly from the text of the upload.

## Files

PDF, TXT, DOCX, and PPTX can be taught. Legacy `.doc` and `.ppt` files are stored, and need a text-based PDF, DOCX, PPTX, or TXT before a lesson can be made from them.

## Icons

Selected free Line icons (Book, Home, Folder, Search, and Clock) are [Icons by Iconstica](https://www.iconstica.com/). They use Professor’s shared colour and stroke settings. See the [Iconstica licence agreement](https://www.iconstica.com/license-agreement).

Original assets: [Book](https://www.iconstica.com/free-icons/book-line), [Home](https://www.iconstica.com/free-icons/home-line), [Folder](https://www.iconstica.com/free-icons/folder-line), [Search](https://www.iconstica.com/free-icons/search-line), and [Clock](https://www.iconstica.com/free-icons/clock-line).
