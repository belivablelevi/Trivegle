'use strict';

const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const { httpServer, ready, close } = createApp();

ready
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Trivegle running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Could not load saved data:', err.message);
    process.exit(1);
  });

// Hosts send SIGTERM before restarting or sleeping the server: save everything first.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    try {
      await close();
    } finally {
      process.exit(0);
    }
  });
}
