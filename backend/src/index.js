const express = require('express');
const cors = require('cors');
const { getClusterInfo } = require('./kubernetes');
const { getInfrastructureInfo } = require('./infrastructure');
const {
  getTestLabStatus,
  getActivityLog,
  killProbe,
  killNodeWorkloads,
  triggerRepairJob,
} = require('./testlab');

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

app.get('/api/infrastructure', async (_req, res) => {
  try {
    const infra = await getInfrastructureInfo();
    res.json(infra);
  } catch (err) {
    console.error('Infrastructure info error:', err);
    res.json({
      available: false,
      reason: err instanceof Error ? err.message : 'Failed to read infrastructure',
    });
  }
});

app.get('/api/testlab/status', async (_req, res) => {
  try {
    const status = await getTestLabStatus();
    res.json(status);
  } catch (err) {
    console.error('Test lab status error:', err);
    res.status(500).json({
      available: false,
      reason: err instanceof Error ? err.message : 'Failed to read test lab status',
    });
  }
});

app.get('/api/testlab/activity', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 500);
    res.json({
      events: getActivityLog(limit),
      count: getActivityLog(500).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Test lab activity error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to read activity log',
    });
  }
});

app.post('/api/testlab/kill-probe', async (req, res) => {
  try {
    const { probeId } = req.body ?? {};
    if (!probeId) {
      res.status(400).json({ error: 'probeId is required' });
      return;
    }
    const result = await killProbe(probeId);
    res.json(result);
  } catch (err) {
    console.error('Kill probe error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Kill probe failed' });
  }
});

app.post('/api/testlab/kill-node', async (req, res) => {
  try {
    const { nodeName } = req.body ?? {};
    if (!nodeName) {
      res.status(400).json({ error: 'nodeName is required' });
      return;
    }
    const result = await killNodeWorkloads(nodeName);
    res.json(result);
  } catch (err) {
    console.error('Kill node workloads error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Kill node failed' });
  }
});

app.post('/api/testlab/trigger-repair', async (_req, res) => {
  try {
    const result = await triggerRepairJob();
    res.json(result);
  } catch (err) {
    console.error('Trigger repair error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Trigger repair failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${PORT}`);
});
