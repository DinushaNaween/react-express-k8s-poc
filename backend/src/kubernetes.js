const fs = require('fs');
const k8s = require('@kubernetes/client-node');

function getNamespace() {
  return process.env.POD_NAMESPACE || 'nrdc-poc';
}

function isDockerContainer() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

function isClusterApiDisabled() {
  const flag = process.env.DISABLE_CLUSTER_API;
  return flag === 'true' || flag === '1';
}

function applyClusterSecurity(kubeConfig) {
  for (const cluster of kubeConfig.clusters) {
    if (cluster.server?.startsWith('http://')) {
      cluster.skipTLSVerify = true;
    }
    const skipTls = process.env.KUBE_SKIP_TLS_VERIFY;
    if (skipTls === 'true' || skipTls === '1') {
      cluster.skipTLSVerify = true;
    }
  }
}

function createClients() {
  if (isClusterApiDisabled()) {
    return null;
  }

  const kubeConfig = new k8s.KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST) {
    kubeConfig.loadFromCluster();
    applyClusterSecurity(kubeConfig);
    return {
      source: 'in-cluster',
      core: kubeConfig.makeApiClient(k8s.CoreV1Api),
      apps: kubeConfig.makeApiClient(k8s.AppsV1Api),
      batch: kubeConfig.makeApiClient(k8s.BatchV1Api),
    };
  }

  // Docker Compose / generic containers: no kubeconfig unless explicitly enabled
  if (isDockerContainer() && process.env.ENABLE_KUBECONFIG_CLUSTER_API !== 'true') {
    return null;
  }

  try {
    kubeConfig.loadFromDefault();
    applyClusterSecurity(kubeConfig);
    return {
      source: 'kubeconfig',
      core: kubeConfig.makeApiClient(k8s.CoreV1Api),
      apps: kubeConfig.makeApiClient(k8s.AppsV1Api),
      batch: kubeConfig.makeApiClient(k8s.BatchV1Api),
    };
  } catch {
    return null;
  }
}

function unavailableReason() {
  if (isClusterApiDisabled()) {
    return 'Cluster details are disabled in Docker Compose (Option B). Use Option C (Kubernetes) or npm run dev with kubectl for the cluster panel.';
  }
  if (isDockerContainer()) {
    return 'Cluster details are not available inside this container. Use Option C (Kubernetes) or run the API with npm run dev on your PC.';
  }
  return 'Kubernetes API not reachable. Deploy to a cluster (Option C) or run the API locally with kubectl configured.';
}

function nodeRoles(node) {
  const labels = node.metadata?.labels ?? {};
  const roles = Object.keys(labels)
    .filter((key) => key.startsWith('node-role.kubernetes.io/'))
    .map((key) => key.replace('node-role.kubernetes.io/', ''));
  return roles.length > 0 ? roles : ['worker'];
}

function nodeStatus(node) {
  const ready = node.status?.conditions?.find((c) => c.type === 'Ready');
  return ready?.status === 'True' ? 'Ready' : ready?.reason || 'NotReady';
}

function podReady(pod) {
  const statuses = pod.status?.containerStatuses ?? [];
  if (statuses.length === 0) return '0/0';
  const ready = statuses.filter((s) => s.ready).length;
  return `${ready}/${statuses.length}`;
}

function listItems(response) {
  return response?.items ?? response?.body?.items ?? [];
}

async function getClusterInfo() {
  const clients = createClients();
  if (!clients) {
    return {
      available: false,
      reason: unavailableReason(),
    };
  }

  const { core, apps, source } = clients;
  const namespace = getNamespace();

  const [nodeList, podList, deployList, ns] = await Promise.all([
    core.listNode(),
    core.listNamespacedPod({ namespace }),
    apps.listNamespacedDeployment({ namespace }),
    core.readNamespace({ name: namespace }).catch(() => null),
  ]);

  const nodes = listItems(nodeList).map((node) => ({
    name: node.metadata.name,
    status: nodeStatus(node),
    roles: nodeRoles(node),
    version: node.status?.nodeInfo?.kubeletVersion ?? '—',
    os: node.status?.nodeInfo?.osImage ?? '—',
    internalIp:
      node.status?.addresses?.find((a) => a.type === 'InternalIP')?.address ?? '—',
  }));

  const pods = listItems(podList).map((pod) => ({
    name: pod.metadata.name,
    status: pod.status?.phase ?? 'Unknown',
    ready: podReady(pod),
    node: pod.spec?.nodeName ?? '—',
    podIp: pod.status?.podIP ?? '—',
    app: pod.metadata?.labels?.app ?? '—',
  }));

  const deployments = listItems(deployList).map((dep) => ({
    name: dep.metadata.name,
    replicas: dep.spec?.replicas ?? 0,
    ready: dep.status?.readyReplicas ?? 0,
    available: dep.status?.availableReplicas ?? 0,
  }));

  const version = nodes[0]?.version ?? 'unknown';

  return {
    available: true,
    source,
    kubernetesVersion: version,
    namespace,
    namespaceStatus: ns?.status?.phase ?? ns?.body?.status?.phase ?? 'Active',
    nodeCount: nodes.length,
    podCount: pods.length,
    nodes,
    pods,
    deployments,
    thisPod: {
      name: process.env.HOSTNAME || 'local',
      namespace,
    },
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  getClusterInfo,
  createClients,
  listItems,
  getNamespace,
  unavailableReason,
};
