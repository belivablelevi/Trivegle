'use strict';

const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const { httpServer, close } = createApp();

httpServer.listen(PORT, () => {
  console.log(`Trivegle running at http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    close();
    process.exit(0);
  });
}
