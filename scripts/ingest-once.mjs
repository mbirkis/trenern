/** Run one ingest pass from the CLI and print the result. */
import { runIngest } from '../src/ingest.js';

const force = process.argv.includes('--force');
const result = await runIngest({ force });
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 1 : 0);
