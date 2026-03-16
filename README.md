# ProfessorAI

Release 1 is a working `AI Lecture Mode` prototype:

- load a lecture PDF in the browser
- render one page at a time
- explain the current page
- ask questions about the current page
- quiz the user on the current page
- give feedback on the user's answer

## Run

Set your xAI API key and start the local server:

```bash
export XAI_API_KEY=your_key_here
npm start
```

Then open `http://localhost:3000`.

## Notes

- The frontend uses `pdf.js` from a CDN to render and extract page text in the browser.
- The backend is a small Node server with no npm dependencies.
- The backend calls xAI's Responses API at `https://api.x.ai/v1/responses`.
- The default model is `grok-4-1-fast-reasoning`. Override it with `XAI_MODEL` if needed.
- Responses are grounded in the current page text sent from the browser to the server.
- This is a prototype. It does not yet support OCR-heavy scans, course libraries, authentication, or persistent progress.
