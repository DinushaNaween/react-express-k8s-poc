const { createClients, listItems, getNamespace, unavailableReason } = require('./kubernetes');

const OPS_NAMESPACE = process.env.OPS_NAMESPACE || 'ops';
const ZEROCLAW_URL =
  process.env.ZEROCLAW_SERVICE_URL ||
  `http://zeroclaw-ops.${OPS_NAMESPACE}.svc.cluster.local:42617`;
const INFRA_ENV = process.env.INFRA_ENVIRONMENT || 'local';

const TF_LAYERS = [
  {
    id: 'platform',
    label: 'Platform',
    path: `platform/terraform/environments/${INFRA_ENV}`,
    manages: ['k3d cluster', 'container image import'],
    release: null,
    namespace: null,
  },
  {
    id: 'deploy',
    label: 'Application',
    path: `deploy/terraform/environments/${INFRA_ENV}`,
    manages: ['Helm release: nrdc-poc'],
    release: 'nrdc-poc',
    namespace: null,
  },
  {
    id: 'ops',
    label: 'Operations',
    path: `ops/terraform/environments/${INFRA_ENV}`,
    manages: ['Helm release: zeroclaw-ops', 'repair CronJob', 'ZeroClaw gateway'],
    release: 'zeroclaw-ops',
    namespace: OPS_NAMESPACE,
  },
];

function helmMeta(resource) {
  const annotations = resource?.metadata?.annotations ?? {};
  return {
    release: annotations['meta.helm.sh/release-name'] ?? null,
    namespace: annotations['meta.helm.sh/release-namespace'] ?? null,
  };
}

function deploymentHealth(dep) {
  if (!dep) return { status: 'missing', ready: '0/0' };
  const desired = dep.spec?.replicas ?? 0;
  const ready = dep.status?.readyReplicas ?? 0;
  const available = dep.status?.availableReplicas ?? 0;
  let status = 'healthy';
  if (ready < desired) status = 'degraded';
  if (ready === 0 && desired > 0) status = 'unavailable';
  return {
    status,
    ready: `${ready}/${desired}`,
    available,
    release: helmMeta(dep).release,
    lastUpdated: dep.metadata?.creationTimestamp,
  };
}

function podRestartTotal(pods) {
  return pods.reduce((sum, pod) => {
    const statuses = pod.status?.containerStatuses ?? [];
    return sum + statuses.reduce((s, c) => s + (c.restartCount ?? 0), 0);
  }, 0);
}

function cronJobSummary(cron) {
  if (!cron) return null;
  const lastSchedule = cron.status?.lastScheduleTime ?? null;
  const lastSuccessful = cron.status?.lastSuccessfulTime ?? null;
  return {
    name: cron.metadata?.name,
    schedule: cron.spec?.schedule,
    suspend: cron.spec?.suspend ?? false,
    activeJobs: cron.status?.active?.length ?? 0,
    lastScheduleTime: lastSchedule,
    lastSuccessfulTime: lastSuccessful,
  };
}

function jobSummary(job) {
  const conditions = job.status?.conditions ?? [];
  const complete = conditions.find((c) => c.type === 'Complete');
  const failed = conditions.find((c) => c.type === 'Failed');
  let status = 'running';
  if (complete?.status === 'True') status = 'succeeded';
  else if (failed?.status === 'True') status = 'failed';

  const name = job.metadata?.name ?? '';
  let trigger = 'scheduled';
  if (name.includes('-event-')) trigger = 'event';
  else if (name.includes('-manual-')) trigger = 'manual';

  return {
    name,
    status,
    trigger,
    startTime: job.status?.startTime ?? null,
    completionTime: job.status?.completionTime ?? null,
    succeeded: job.status?.succeeded ?? 0,
    failed: job.status?.failed ?? 0,
  };
}

async function fetchZeroClawHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${ZEROCLAW_URL}/health`, {
      signal: controller.signal,
    });
    const body = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { raw: body.slice(0, 200) };
    }
    return {
      reachable: response.ok,
      statusCode: response.status,
      url: ZEROCLAW_URL,
      body: parsed,
    };
  } catch (err) {
    return {
      reachable: false,
      statusCode: null,
      url: ZEROCLAW_URL,
      error: err instanceof Error ? err.message : 'Health check failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTerraformLayers(clients, appNamespace) {
  const platformReachable = Boolean(process.env.KUBERNETES_SERVICE_HOST);

  const [appDeploys, opsDeploys] = await Promise.all([
    clients.apps.listNamespacedDeployment({ namespace: appNamespace }),
    clients.apps
      .listNamespacedDeployment({ namespace: OPS_NAMESPACE })
      .catch(() => ({ items: [] })),
  ]);

  const appItems = listItems(appDeploys);
  const opsItems = listItems(opsDeploys);

  return TF_LAYERS.map((layer) => {
    let live = null;
    if (layer.id === 'platform') {
      live = {
        status: platformReachable ? 'applied' : 'unknown',
        detail: platformReachable ? 'Cluster API reachable (k3d / AKS)' : 'Not in cluster',
      };
    } else if (layer.id === 'deploy') {
      const dep = appItems.find((d) => helmMeta(d).release === layer.release);
      const health = deploymentHealth(dep);
      live = {
        status: health.status === 'healthy' ? 'applied' : health.status,
        detail: dep ? `Helm ${layer.release} ${health.ready} ready` : 'Release not found',
        helm: health,
      };
    } else if (layer.id === 'ops') {
      const dep = opsItems.find(
        (d) =>
          d.metadata?.name === 'zeroclaw-ops' ||
          helmMeta(d).release === layer.release
      );
      const health = deploymentHealth(dep);
      live = {
        status: dep ? (health.status === 'healthy' ? 'applied' : health.status) : 'not_deployed',
        detail: dep ? `Helm ${layer.release} ${health.ready} ready` : 'Ops layer not deployed',
        helm: health,
      };
    }

    return {
      ...layer,
      stateBackend: INFRA_ENV === 'local' ? 'local filesystem (.tfstate)' : 'Azure Storage (remote)',
      engine: 'Terraform helm_release',
      live,
    };
  });
}

async function getInfrastructureInfo() {
  const clients = createClients();
  if (!clients) {
    return {
      available: false,
      reason: unavailableReason(),
    };
  }

  const appNamespace = getNamespace();
  const { core, apps, batch } = clients;

  const [
    appDeployList,
    appPodList,
    opsDeployList,
    opsPodList,
    cronList,
    jobList,
    zeroClawHealth,
    terraformLayers,
  ] = await Promise.all([
    apps.listNamespacedDeployment({ namespace: appNamespace }),
    core.listNamespacedPod({ namespace: appNamespace }),
    apps.listNamespacedDeployment({ namespace: OPS_NAMESPACE }).catch(() => ({ items: [] })),
    core.listNamespacedPod({ namespace: OPS_NAMESPACE }).catch(() => ({ items: [] })),
    batch
      ? batch.listNamespacedCronJob({ namespace: OPS_NAMESPACE }).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
    batch
      ? batch.listNamespacedJob({ namespace: OPS_NAMESPACE }).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
    fetchZeroClawHealth(),
    resolveTerraformLayers(clients, appNamespace),
  ]);

  const appDeploys = listItems(appDeployList);
  const appPods = listItems(appPodList);
  const opsDeploys = listItems(opsDeployList);
  const opsPods = listItems(opsPodList);
  const cronJobs = listItems(cronList);
  const jobs = listItems(jobList);

  const repairCron = cronJobs.find((c) => c.metadata?.name === 'nrdc-cluster-ops') ?? null;
  const recentJobs = jobs
    .filter((j) => j.metadata?.name?.startsWith('nrdc-cluster-ops'))
    .sort((a, b) => {
      const ta = new Date(a.status?.startTime ?? 0).getTime();
      const tb = new Date(b.status?.startTime ?? 0).getTime();
      return tb - ta;
    })
    .slice(0, 5)
    .map(jobSummary);

  const zeroclawDep = opsDeploys.find((d) => d.metadata?.name === 'zeroclaw-ops') ?? null;
  const eventHealerDep = opsDeploys.find((d) => d.metadata?.name === 'nrdc-event-healer') ?? null;
  const zeroclawPods = opsPods.filter((p) => p.metadata?.labels?.app === 'zeroclaw-ops');

  const l1Probes = appDeploys.map((dep) => {
    const pods = appPods.filter(
      (p) => p.metadata?.labels?.app === dep.metadata?.labels?.app
    );
    return {
      deployment: dep.metadata?.name,
      ready: `${dep.status?.readyReplicas ?? 0}/${dep.spec?.replicas ?? 0}`,
      restarts: podRestartTotal(pods),
      mechanism: 'liveness + readiness probes, Deployment controller',
    };
  });

  const lastRepair = recentJobs[0] ?? null;
  const lastEventRepair = recentJobs.find((j) => j.trigger === 'event') ?? null;
  const eventHealerStatus = eventHealerDep
    ? deploymentHealth(eventHealerDep).status === 'healthy'
      ? 'active'
      : 'degraded'
    : 'not_deployed';
  const scheduledStatus =
    repairCron && !repairCron.spec?.suspend
      ? lastRepair?.status === 'succeeded'
        ? 'active'
        : lastRepair?.status === 'failed'
          ? 'attention'
          : 'scheduled'
      : repairCron
        ? 'suspended'
        : 'not_deployed';

  return {
    available: true,
    environment: INFRA_ENV,
    fetchedAt: new Date().toISOString(),
    terraform: {
      summary: 'Three Terraform roots: platform -> deploy -> ops (local .tfstate)',
      layers: terraformLayers,
    },
    autoHeal: {
      summary:
        'L1 = Kubernetes native | L2-event = failure watcher (fast) | L2-scheduled = CronJob fallback',
      layers: [
        {
          level: 'L1',
          name: 'Reactive (seconds)',
          status: appDeploys.every(
            (d) => (d.status?.readyReplicas ?? 0) >= (d.spec?.replicas ?? 1)
          )
            ? 'healthy'
            : 'recovering',
          mechanism: 'kubelet probes + Deployment controller recreates failed pods',
          targets: l1Probes,
        },
        {
          level: 'L2-event',
          name: 'Event-driven healer (~8s)',
          status: eventHealerStatus,
          mechanism:
            'nrdc-event-healer watches unready deployments and /health — creates repair job after grace period',
          deployment: deploymentHealth(eventHealerDep),
          lastEventRepair,
        },
        {
          level: 'L2-scheduled',
          name: 'Scheduled fallback (minutes)',
          status: scheduledStatus,
          mechanism:
            'CronJob runs health-repair.sh on schedule — catches failures if event repair missed or failed',
          cronJob: cronJobSummary(repairCron),
          recentJobs,
        },
      ],
    },
    zeroclaw: {
      deployed: Boolean(zeroclawDep),
      eventHealerDeployed: Boolean(eventHealerDep),
      skill: 'nrdc-cluster-ops',
      gateway: zeroClawHealth,
      deployment: deploymentHealth(zeroclawDep),
      pods: zeroclawPods.map((p) => ({
        name: p.metadata?.name,
        phase: p.status?.phase,
        ready: (p.status?.containerStatuses ?? [])
          .map((c) => (c.ready ? '1/1' : '0/1'))
          .join(', '),
        restarts: (p.status?.containerStatuses ?? []).reduce(
          (s, c) => s + (c.restartCount ?? 0),
          0
        ),
      })),
      ollamaEnabled: opsPods.some((p) => p.metadata?.labels?.app === 'ollama'),
    },
    opsNamespace: {
      name: OPS_NAMESPACE,
      deployments: opsDeploys.length,
      pods: opsPods.length,
      cronJobs: cronJobs.length,
    },
  };
}

module.exports = { getInfrastructureInfo };
