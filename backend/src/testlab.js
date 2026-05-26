const { createClients, listItems, getNamespace, unavailableReason } = require('./kubernetes');

const OPS_NAMESPACE = process.env.OPS_NAMESPACE || 'ops';
const REPAIR_CRONJOB = 'nrdc-cluster-ops';
const ZEROCLAW_URL =
  process.env.ZEROCLAW_SERVICE_URL ||
  `http://zeroclaw-ops.${OPS_NAMESPACE}.svc.cluster.local:42617`;
const MAX_ACTIVITY = 500;

const activityEvents = [];
const seenDedupKeys = new Set();
const seenJobLogLines = new Map();
let prevPodStates = new Map();
let prevDeployStates = new Map();
let prevJobStates = new Map();
let prevGatewayReachable = null;
let monitorInitialized = false;

function trimDedupKeys() {
  if (seenDedupKeys.size <= 800) return;
  const keys = [...seenDedupKeys];
  seenDedupKeys.clear();
  keys.slice(-400).forEach((k) => seenDedupKeys.add(k));
}

function appendActivity({ source, level = 'info', message, dedupKey = null, meta = {}, time = null }) {
  if (dedupKey) {
    if (seenDedupKeys.has(dedupKey)) return null;
    seenDedupKeys.add(dedupKey);
    trimDedupKeys();
  }

  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: time ?? new Date().toISOString(),
    source,
    level,
    message,
    ...meta,
  };
  activityEvents.unshift(event);
  if (activityEvents.length > MAX_ACTIVITY) {
    activityEvents.length = MAX_ACTIVITY;
  }
  return event;
}

function getActivityLog(limit = MAX_ACTIVITY) {
  return activityEvents.slice(0, Math.min(limit, activityEvents.length));
}

function probeHttpSummary(probe) {
  if (!probe?.httpGet) return { path: '—', port: '—' };
  return {
    path: probe.httpGet.path ?? '/',
    port: probe.httpGet.port ?? '—',
  };
}

function getPodPhase(pod) {
  if (!pod) return 'Unknown';
  if (pod.metadata?.deletionTimestamp) return 'Terminating';
  return pod.status?.phase ?? 'Unknown';
}

function probeStatusForPod(pod, containerName, type) {
  const phase = getPodPhase(pod);
  if (phase === 'Terminating') return 'dead';
  if (phase === 'Failed') return 'failed';
  if (phase === 'Unknown') return 'failed';
  if (phase === 'Pending') return 'pending';

  const cs = (pod.status?.containerStatuses ?? []).find((c) => c.name === containerName);
  if (!cs) return 'pending';
  if (cs.ready) return 'passing';
  if (type === 'readiness') return 'failing';
  if (cs.state?.waiting) return 'pending';
  if (cs.state?.terminated) return 'failed';
  return cs.started ? 'passing' : 'failing';
}

function extractProbes(deployments, pods) {
  const rows = [];
  for (const dep of deployments) {
    const depName = dep.metadata?.name;
    const appLabel = dep.metadata?.labels?.app ?? dep.spec?.selector?.matchLabels?.app;
    const depPods = pods
      .filter((p) => p.metadata?.labels?.app === appLabel)
      .sort((a, b) => (a.metadata?.name ?? '').localeCompare(b.metadata?.name ?? ''));

    for (const container of dep.spec?.template?.spec?.containers ?? []) {
      const containerName = container.name;
      for (const type of ['readiness', 'liveness']) {
        const probe = container[type + 'Probe'];
        if (!probe) continue;
        const http = probeHttpSummary(probe);

        if (depPods.length === 0) {
          rows.push({
            id: `${depName}-${containerName}-${type}::__none__`,
            deployment: depName,
            container: containerName,
            type,
            ...http,
            periodSeconds: probe.periodSeconds ?? '—',
            status: 'unknown',
            targetPod: null,
            podPhase: '—',
            ready: '0/0',
          });
          continue;
        }

        for (const pod of depPods) {
          const podName = pod.metadata.name;
          const readyParts = pod.status?.containerStatuses ?? [];
          const readyCount = readyParts.filter((c) => c.ready).length;
          rows.push({
            id: `${depName}-${containerName}-${type}::${podName}`,
            deployment: depName,
            container: containerName,
            type,
            ...http,
            periodSeconds: probe.periodSeconds ?? '—',
            status: probeStatusForPod(pod, containerName, type),
            targetPod: podName,
            podPhase: getPodPhase(pod),
            ready: `${readyCount}/${readyParts.length || 1}`,
            deletionTimestamp: pod.metadata?.deletionTimestamp ?? null,
          });
        }
      }
    }
  }
  return rows;
}

function parseIntervalSeconds(schedule) {
  const match = schedule?.match(/^\*\/(\d+) \* \* \* \*$/);
  if (!match) return 120;
  return parseInt(match[1], 10) * 60;
}

function computeNextCheck(schedule, lastScheduleTime, activeJob) {
  const intervalSeconds = parseIntervalSeconds(schedule);
  const now = Date.now();

  if (activeJob) {
    return {
      intervalSeconds,
      nextCheckAt: null,
      secondsUntilNext: 0,
      phase: 'running',
    };
  }

  let nextMs;
  if (lastScheduleTime) {
    nextMs = new Date(lastScheduleTime).getTime() + intervalSeconds * 1000;
    while (nextMs <= now) {
      nextMs += intervalSeconds * 1000;
    }
  } else {
    const intervalMs = intervalSeconds * 1000;
    nextMs = Math.ceil(now / intervalMs) * intervalMs;
  }

  const secondsUntilNext = Math.max(0, Math.ceil((nextMs - now) / 1000));
  return {
    intervalSeconds,
    nextCheckAt: new Date(nextMs).toISOString(),
    secondsUntilNext,
    phase: secondsUntilNext <= 3 ? 'starting' : 'waiting',
  };
}

async function fetchZeroClawHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${ZEROCLAW_URL}/health`, { signal: controller.signal });
    const body = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { raw: body.slice(0, 200) };
    }
    return { reachable: response.ok, statusCode: response.status, body: parsed };
  } catch (err) {
    return {
      reachable: false,
      statusCode: null,
      error: err instanceof Error ? err.message : 'unreachable',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJobLogs(core, namespace, jobName, tailLines = 50) {
  try {
    const podList = await core.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });
    const pods = listItems(podList);
    if (pods.length === 0) return [];
    const podName = pods[0].metadata.name;
    const log = await core.readNamespacedPodLog({
      name: podName,
      namespace,
      tailLines,
    });
    const text = log?.body ?? log ?? '';
    return String(text).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function jobPhase(job) {
  if (!job) return null;
  const conditions = job.status?.conditions ?? [];
  if (conditions.some((c) => c.type === 'Complete' && c.status === 'True')) return 'succeeded';
  if (conditions.some((c) => c.type === 'Failed' && c.status === 'True')) return 'failed';
  if ((job.status?.active ?? 0) > 0) return 'running';
  return 'pending';
}

function deploymentHealth(dep) {
  if (!dep) return { status: 'missing', ready: '0/0' };
  const desired = dep.spec?.replicas ?? 0;
  const ready = dep.status?.readyReplicas ?? 0;
  let status = 'healthy';
  if (ready < desired) status = 'degraded';
  if (ready === 0 && desired > 0) status = 'unavailable';
  return {
    status,
    ready: `${ready}/${desired}`,
  };
}

function jobActivitySource(jobName) {
  if (jobName.includes('-event-')) return 'l2-event';
  if (jobName.includes('-manual-')) return 'l2-manual';
  return 'l2-scheduled';
}

function ingestJobLogs(jobName, lines, jobStartTime) {
  if (!seenJobLogLines.has(jobName)) {
    seenJobLogLines.set(jobName, new Set());
  }
  const seen = seenJobLogLines.get(jobName);
  const timeBase = jobStartTime ?? new Date().toISOString();
  const source = jobActivitySource(jobName);

  for (const line of lines) {
    const normalized = line.replace(/^\[(nrdc-cluster-ops|nrdc-event-healer|nrdc-manual-repair)\]\s*/, '');
    const lineKey = `${jobName}::${normalized}`;
    if (seen.has(lineKey)) continue;
    seen.add(lineKey);
    appendActivity({
      source,
      level: normalized.includes('FAILED') || normalized.includes('incomplete') ? 'warn' : 'info',
      message: normalized,
      dedupKey: lineKey,
      meta: { job: jobName, raw: line },
      time: timeBase,
    });
  }
}

function recordPodChanges(pods, namespace) {
  const nextStates = new Map();

  for (const pod of pods) {
    const name = pod.metadata.name;
    const phase = getPodPhase(pod);
    const ready = (pod.status?.containerStatuses ?? []).filter((c) => c.ready).length;
    const total = (pod.status?.containerStatuses ?? []).length;
    const app = pod.metadata?.labels?.app ?? 'unknown';
    const snapshot = {
      phase,
      ready: `${ready}/${total}`,
      deletionTimestamp: pod.metadata?.deletionTimestamp ?? null,
    };
    nextStates.set(name, snapshot);

    const prev = prevPodStates.get(name);
    if (!prev) {
      if (monitorInitialized) {
        appendActivity({
          source: 'l1-kubelet',
          level: phase === 'Running' ? 'success' : 'info',
          message: `Pod ${name} (${app}) appeared — phase ${phase}, ready ${snapshot.ready}`,
          dedupKey: `pod-appear:${name}`,
          meta: { pod: name, app, namespace },
        });
      }
      continue;
    }

    if (prev.phase !== phase) {
      const level =
        phase === 'Terminating' || phase === 'Failed'
          ? 'error'
          : phase === 'Running'
            ? 'success'
            : 'warn';
      appendActivity({
        source: 'l1-kubelet',
        level,
        message: `Pod ${name} (${app}) phase ${prev.phase} → ${phase}`,
        meta: { pod: name, app, namespace, from: prev.phase, to: phase },
      });
    }

    if (prev.ready !== snapshot.ready && phase !== 'Terminating') {
      appendActivity({
        source: 'l1-kubelet',
        level: snapshot.ready.startsWith(`${total}/`) && total > 0 ? 'success' : 'warn',
        message: `Pod ${name} (${app}) ready ${prev.ready} → ${snapshot.ready}`,
        meta: { pod: name, app, namespace },
      });
    }
  }

  for (const [name, prev] of prevPodStates.entries()) {
    if (!nextStates.has(name) && monitorInitialized) {
      appendActivity({
        source: 'l1-kubelet',
        level: 'error',
        message: `Pod ${name} removed from cluster (was ${prev.phase})`,
        meta: { pod: name, namespace },
      });
    }
  }

  prevPodStates = nextStates;
}

function recordDeployChanges(deployments, namespace) {
  const nextStates = new Map();

  for (const dep of deployments) {
    const name = dep.metadata?.name;
    const desired = dep.spec?.replicas ?? 0;
    const ready = dep.status?.readyReplicas ?? 0;
    const snapshot = { desired, ready };
    nextStates.set(name, snapshot);

    const prev = prevDeployStates.get(name);
    if (!prev) continue;

    if (prev.ready !== ready || prev.desired !== desired) {
      const level = ready >= desired ? 'success' : 'warn';
      appendActivity({
        source: 'l1-deployment',
        level,
        message: `Deployment ${name} ready ${prev.ready}/${prev.desired} → ${ready}/${desired}`,
        meta: { deployment: name, namespace },
      });
    }
  }

  prevDeployStates = nextStates;
}

function recordGatewayChange(gateway) {
  const reachable = Boolean(gateway.reachable);
  if (prevGatewayReachable === null) {
    prevGatewayReachable = reachable;
    return;
  }

  if (prevGatewayReachable !== reachable) {
    appendActivity({
      source: 'zeroclaw-gateway',
      level: reachable ? 'success' : 'error',
      message: reachable
        ? `ZeroClaw gateway recovered — HTTP ${gateway.statusCode ?? 200}`
        : `ZeroClaw gateway unreachable${gateway.error ? `: ${gateway.error}` : ''}`,
      meta: { url: ZEROCLAW_URL },
    });
    prevGatewayReachable = reachable;
    return;
  }

  appendActivity({
    source: 'zeroclaw-gateway',
    level: reachable ? 'info' : 'warn',
    message: reachable
      ? `Gateway poll OK (HTTP ${gateway.statusCode ?? 200})`
      : `Gateway poll failed${gateway.error ? `: ${gateway.error}` : ''}`,
    dedupKey: `gateway-poll:${Math.floor(Date.now() / 2000)}`,
  });
}

function recordJobChanges(jobs) {
  for (const job of jobs) {
    const name = job.metadata?.name;
    const phase = jobPhase(job);
    const source = jobActivitySource(name);
    const prev = prevJobStates.get(name);

    if (!prev) {
      appendActivity({
        source,
        level: 'info',
        message: `Repair job ${name} created (${phase})`,
        dedupKey: `job-create:${name}`,
        meta: { job: name, trigger: source },
      });
    } else if (prev !== phase) {
      const level =
        phase === 'succeeded' ? 'success' : phase === 'failed' ? 'error' : 'info';
      appendActivity({
        source,
        level,
        message: `Repair job ${name} ${prev} → ${phase}`,
        meta: { job: name, trigger: source },
      });
    }

    prevJobStates.set(name, phase);
  }
}

function recordCronSchedule(cron) {
  const last = cron.status?.lastScheduleTime;
  if (!last) return;
  appendActivity({
    source: 'l2-scheduler',
    level: 'info',
    message: `CronJob ${REPAIR_CRONJOB} scheduled run at ${last}`,
    dedupKey: `cron-schedule:${last}`,
  });
}

async function fetchEventHealerLogs(core) {
  try {
    const podList = await core.listNamespacedPod({
      namespace: OPS_NAMESPACE,
      labelSelector: 'app=nrdc-event-healer',
    });
    const pods = listItems(podList).filter((p) => p.status?.phase === 'Running');
    if (pods.length === 0) return [];
    const podName = pods[0].metadata.name;
    const log = await core.readNamespacedPodLog({
      name: podName,
      namespace: OPS_NAMESPACE,
      tailLines: 25,
    });
    return String(log?.body ?? log ?? '')
      .split('\n')
      .filter(Boolean)
      .slice(-12);
  } catch {
    return [];
  }
}

function ingestWatcherLogs(lines) {
  for (const line of lines) {
    const normalized = line.replace(/^\[nrdc-event-healer\]\s*/, '');
    const lineKey = `watcher::${normalized}`;
    appendActivity({
      source: 'l2-event-watcher',
      level: normalized.includes('Failure detected') ? 'warn' : 'info',
      message: normalized,
      dedupKey: lineKey,
    });
  }
}

async function getZeroClawActivity(clients) {
  const { core, batch, apps } = clients;
  const gateway = await fetchZeroClawHealth();
  recordGatewayChange(gateway);

  let cron = null;
  let jobs = [];
  try {
    const cronRes = await batch.readNamespacedCronJob({
      name: REPAIR_CRONJOB,
      namespace: OPS_NAMESPACE,
    });
    cron = cronRes?.body ?? cronRes;
    const jobList = await batch.listNamespacedJob({ namespace: OPS_NAMESPACE });
    jobs = listItems(jobList)
      .filter((j) => j.metadata?.name?.startsWith(REPAIR_CRONJOB))
      .sort((a, b) => {
        const ta = new Date(a.status?.startTime ?? 0).getTime();
        const tb = new Date(b.status?.startTime ?? 0).getTime();
        return tb - ta;
      });
  } catch {
    return {
      available: false,
      gateway,
      reason: 'Ops CronJob not deployed',
    };
  }

  recordCronSchedule(cron);
  recordJobChanges(jobs);

  for (const job of jobs.slice(0, 10)) {
    const lines = await fetchJobLogs(core, OPS_NAMESPACE, job.metadata.name, 80);
    ingestJobLogs(job.metadata.name, lines, job.status?.startTime);
  }

  ingestWatcherLogs(await fetchEventHealerLogs(core));

  let eventHealerDep = null;
  if (apps) {
    try {
      const depRes = await apps.readNamespacedDeployment({
        name: 'nrdc-event-healer',
        namespace: OPS_NAMESPACE,
      });
      eventHealerDep = depRes?.body ?? depRes;
    } catch {
      eventHealerDep = null;
    }
  }

  const activeJob = jobs.find((j) => jobPhase(j) === 'running') ?? null;
  const schedule = cron.spec?.schedule ?? '*/2 * * * *';
  const timing = computeNextCheck(schedule, cron.status?.lastScheduleTime, activeJob);

  if (timing.phase === 'starting' && !activeJob) {
    appendActivity({
      source: 'l2-scheduler',
      level: 'info',
      message: 'Next scheduled ZeroClaw health check im imminent',
      dedupKey: `cron-imminent:${cron.status?.lastScheduleTime}:${timing.nextCheckAt}`,
    });
  }

  let activeJobDetail = null;
  if (activeJob) {
    const name = activeJob.metadata.name;
    const logLines = await fetchJobLogs(core, OPS_NAMESPACE, name, 80);
    ingestJobLogs(name, logLines, activeJob.status?.startTime);
    activeJobDetail = {
      name,
      status: 'running',
      startTime: activeJob.status?.startTime ?? null,
      logs: logLines.slice(-20),
    };
  }

  const recentJobs = jobs.slice(0, 8).map((j) => ({
    name: j.metadata?.name,
    status: jobPhase(j),
    trigger: jobActivitySource(j.metadata?.name),
    startTime: j.status?.startTime ?? null,
    completionTime: j.status?.completionTime ?? null,
  }));

  return {
    available: true,
    schedule,
    cronJob: REPAIR_CRONJOB,
    lastScheduleTime: cron.status?.lastScheduleTime ?? null,
    lastSuccessfulTime: cron.status?.lastSuccessfulTime ?? null,
    ...timing,
    progressPercent: activeJob
      ? 100
      : Math.round(
          ((timing.intervalSeconds - timing.secondsUntilNext) / timing.intervalSeconds) * 100
        ),
    activeJob: activeJobDetail,
    recentJobs,
    eventHealer: {
      deployed: Boolean(eventHealerDep),
      deployment: deploymentHealth(eventHealerDep),
      pollSeconds: 3,
      graceSeconds: 8,
      mechanism: 'Watches unready deployments and /health — triggers repair job within ~8s of sustained failure',
    },
    gateway,
  };
}

async function getTestLabStatus() {
  const clients = createClients();
  if (!clients) {
    return { available: false, reason: unavailableReason() };
  }

  const { core, apps, batch } = clients;
  const namespace = getNamespace();

  const [nodeList, podList, deployList, zeroclaw] = await Promise.all([
    core.listNode(),
    core.listNamespacedPod({ namespace }),
    apps.listNamespacedDeployment({ namespace }),
    getZeroClawActivity({ core, apps, batch }),
  ]);

  const nodes = listItems(nodeList);
  const pods = listItems(podList);
  const deployments = listItems(deployList);

  recordPodChanges(pods, namespace);
  recordDeployChanges(deployments, namespace);

  if (!monitorInitialized) {
    appendActivity({
      source: 'system',
      level: 'info',
      message: 'Test lab monitor started — tracking L1 pod/deployment changes and L2 ZeroClaw activity',
    });
    monitorInitialized = true;
  }

  const probes = extractProbes(deployments, pods);

  const nodeRows = nodes.map((node) => {
    const name = node.metadata.name;
    const podsOnNode = pods.filter((p) => p.spec?.nodeName === name);
    return {
      name,
      status: node.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True'
        ? 'Ready'
        : 'NotReady',
      roles: Object.keys(node.metadata?.labels ?? {})
        .filter((k) => k.startsWith('node-role.kubernetes.io/'))
        .map((k) => k.replace('node-role.kubernetes.io/', '')),
      podCount: podsOnNode.length,
      pods: podsOnNode.map((p) => ({
        name: p.metadata.name,
        phase: getPodPhase(p),
        app: p.metadata?.labels?.app ?? '—',
        ready: (() => {
          const cs = p.status?.containerStatuses ?? [];
          const r = cs.filter((c) => c.ready).length;
          return `${r}/${cs.length || 0}`;
        })(),
      })),
      killAction: 'evict_workloads',
      killDescription: `Delete ${podsOnNode.length} app pod(s) on this node — controllers recreate them (L1), ZeroClaw repairs if still degraded (L2).`,
    };
  });

  return {
    available: true,
    namespace,
    fetchedAt: new Date().toISOString(),
    probes,
    nodes: nodeRows,
    zeroclaw,
    activityLog: getActivityLog(),
    activityCount: activityEvents.length,
  };
}

async function killPodByName(name, namespace, meta = {}) {
  const clients = createClients();
  if (!clients) throw new Error(unavailableReason());

  await clients.core.deleteNamespacedPod({ name, namespace });
  appendActivity({
    source: 'test-action',
    level: 'warn',
    message: `Test kill: pod ${name} deleted — awaiting L1 recreation / L2 repair`,
    meta: { pod: name, namespace, ...meta },
  });
  return {
    action: 'pod_deleted',
    name,
    namespace,
    message: `Pod ${name} deleted — L1 recreates immediately; event healer runs if still degraded; scheduled healer is fallback.`,
  };
}

async function findProbeById(probeId) {
  const clients = createClients();
  if (!clients) throw new Error(unavailableReason());

  const namespace = getNamespace();
  const [podList, deployList] = await Promise.all([
    clients.core.listNamespacedPod({ namespace }),
    clients.apps.listNamespacedDeployment({ namespace }),
  ]);
  const probes = extractProbes(listItems(deployList), listItems(podList));
  const probe = probes.find((p) => p.id === probeId);
  if (!probe) throw new Error(`Probe not found: ${probeId}`);
  if (!probe.targetPod) throw new Error(`No pod mapped for probe ${probeId}`);
  return { probe, namespace };
}

async function killProbe(probeId) {
  const { probe, namespace } = await findProbeById(probeId);

  appendActivity({
    source: 'test-action',
    level: 'warn',
    message: `Test kill requested: ${probe.deployment}/${probe.container} ${probe.type} on pod ${probe.targetPod}`,
    meta: { probeId, pod: probe.targetPod },
  });

  const result = await killPodByName(probe.targetPod, namespace, {
    probeId,
    deployment: probe.deployment,
    probeType: probe.type,
  });
  return { ...result, probeId, probe: probe.type, deployment: probe.deployment };
}

async function killNodeWorkloads(nodeName) {
  const clients = createClients();
  if (!clients) throw new Error(unavailableReason());

  const namespace = getNamespace();
  const podList = await clients.core.listNamespacedPod({ namespace });
  const pods = listItems(podList).filter((p) => p.spec?.nodeName === nodeName);

  if (pods.length === 0) {
    return {
      action: 'node_workloads_evicted',
      nodeName,
      deleted: [],
      message: `No app pods on node ${nodeName}`,
    };
  }

  appendActivity({
    source: 'test-action',
    level: 'warn',
    message: `Test evict: deleting ${pods.length} pod(s) on node ${nodeName}`,
    meta: { node: nodeName },
  });

  const deleted = [];
  for (const pod of pods) {
    const name = pod.metadata.name;
    await clients.core.deleteNamespacedPod({ name, namespace });
    deleted.push(name);
    appendActivity({
      source: 'test-action',
      level: 'error',
      message: `Pod ${name} (${pod.metadata?.labels?.app ?? 'app'}) evicted from node ${nodeName}`,
      meta: { pod: name, node: nodeName },
    });
  }

  return {
    action: 'node_workloads_evicted',
    nodeName,
    deleted,
    message: `Deleted ${deleted.length} pod(s) on ${nodeName}. L1 recreates via controllers; ZeroClaw L2 repairs on next check if needed.`,
  };
}

async function triggerRepairJob() {
  const clients = createClients();
  if (!clients?.batch) throw new Error(unavailableReason());

  const cronRes = await clients.batch.readNamespacedCronJob({
    name: REPAIR_CRONJOB,
    namespace: OPS_NAMESPACE,
  });
  const cron = cronRes?.body ?? cronRes;
  const jobName = `${REPAIR_CRONJOB}-manual-${Date.now()}`;

  await clients.batch.createNamespacedJob({
    namespace: OPS_NAMESPACE,
    body: {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: OPS_NAMESPACE,
      },
      spec: cron.spec.jobTemplate.spec,
    },
  });

  appendActivity({
    source: 'test-action',
    level: 'info',
    message: `Manual L2 repair triggered — job ${jobName}`,
    meta: { job: jobName },
  });

  return {
    action: 'repair_triggered',
    jobName,
    message: `Repair job ${jobName} created from CronJob ${REPAIR_CRONJOB}`,
  };
}

module.exports = {
  getTestLabStatus,
  getActivityLog,
  killProbe,
  killNodeWorkloads,
  triggerRepairJob,
};
