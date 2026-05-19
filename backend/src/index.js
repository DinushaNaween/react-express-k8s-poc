const express = require('express');
const cors = require('cors');
const { getClusterInfo } = require('./kubernetes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'nrdc-poc-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/hello', (_req, res) => {
  res.json({
    message: 'Hello from the NRDC POC API',
    environment: process.env.NODE_ENV || 'development',
    hostname: process.env.HOSTNAME || 'local',
  });
});

app.get('/api/items', (_req, res) => {
  res.json({
    items: [
      { id: 1, name: 'Sample record A' },
      { id: 2, name: 'Sample record B' },
      { id: 3, name: 'Sample record C' },
    ],
  });
});

app.get('/api/cluster', async (_req, res) => {
  try {
    const cluster = await getClusterInfo();
    res.json(cluster);
  } catch (err) {
    console.error('Cluster info error:', err);
    res.json({
      available: false,
      reason: err instanceof Error ? err.message : 'Failed to read cluster',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${PORT}`);
});
