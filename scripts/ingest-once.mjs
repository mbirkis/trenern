/** Run one ingest pass from the CLI and print the result. */
import { runIngest } from '../src/ingest.js';
import * as store from '../src/store.js';

const force = process.argv.includes('--force');
const result = await runIngest({ force });
console.log(JSON.stringify(result, null, 2));
await store.close();
process.exit(result.errors.length ? 1 : 0);
