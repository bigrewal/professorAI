import "./load-env.js";
import { start } from "./app.js";
import { DATA_DIR } from "./lib/store.js";

const port = Number(process.env.PORT || 3000);
const server = await start(port);
const address = server.address();
console.log(`Professor API on http://127.0.0.1:${address.port}`);
console.log(`Course data stored at ${DATA_DIR}`);
