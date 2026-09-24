#!/usr/bin/env node
fetch("http://127.0.0.1:3005/api/health")
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
