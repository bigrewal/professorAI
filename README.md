# Professor

Professor turns course PDFs, notes, and slides into a lesson path. It teaches one idea at a time, pauses when you do, and answers by voice or text before picking the lesson back up.

The interface is a Vite app in `client/`. The API is an Express server in `server/`. Teaching calls go through the [AI SDK](https://ai-sdk.dev) provider registry, so the same lesson player can use xAI, OpenAI, Anthropic, or Google.

## Run

```bash
npm install
cp .env.example .env
```

Add at least one provider key, then:

```bash
npm run dev
```

The study interface is at `http://127.0.0.1:5173`. The API is at `http://127.0.0.1:3000`.

`npm start` builds the client and serves it from the API.

## Models

Open the Tutor menu in the app and pick a model. Only providers with an API key are selectable:

- `XAI_API_KEY` — Grok
- `OPENAI_API_KEY` — GPT
- `ANTHROPIC_API_KEY` — Claude
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini

Lessons opened after a switch are prepared with the new model. Rebuild a course path when you want the syllabus rewritten too. With no key, Professor still teaches directly from the text of the upload.

## Files

PDF, TXT, DOCX, and PPTX can be taught. Legacy `.doc` and `.ppt` files are stored, and need a text-based PDF, DOCX, PPTX, or TXT before a lesson can be made from them.

## Icons

Selected free Line icons (Book, Home, Folder, Search, and Clock) are [Icons by Iconstica](https://www.iconstica.com/). They use Professor’s shared colour and stroke settings. See the [Iconstica licence agreement](https://www.iconstica.com/license-agreement).

Original assets: [Book](https://www.iconstica.com/free-icons/book-line), [Home](https://www.iconstica.com/free-icons/home-line), [Folder](https://www.iconstica.com/free-icons/folder-line), [Search](https://www.iconstica.com/free-icons/search-line), and [Clock](https://www.iconstica.com/free-icons/clock-line).
