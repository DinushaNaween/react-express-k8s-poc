import { useCallback, useEffect, useState } from 'react';

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function ClusterPanel({ cluster }) {
  if (!cluster?.available) {
    return (
      <article className="wide cluster-unavailable">
        <h3>Cluster details</h3>
        <p className="muted">{cluster?.reason ?? 'Cluster info not available.'}</p>
      </article>
    );
  }

  return (
    <>
      <article className="wide cluster-summary">
        <h3>Cluster summary</h3>
        <dl className="stats">
          <div>
            <dt>Nodes</dt>
            <dd>{cluster.nodeCount}</dd>
          </div>
          <div>
            <dt>Kubernetes</dt>
            <dd>{cluster.kubernetesVersion}</dd>
          </div>
          <div>
            <dt>Namespace</dt>
            <dd>{cluster.namespace}</dd>
          </div>
          <div>
            <dt>API source</dt>
            <dd>{cluster.source}</dd>
          </div>
          <div>
            <dt>This API pod</dt>
            <dd>{cluster.thisPod?.name}</dd>
          </div>
          <div>
            <dt>Fetched</dt>
            <dd>{new Date(cluster.fetchedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </article>

      <article className="wide">
        <h3>Nodes ({cluster.nodeCount})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Version</th>
                <th>Internal IP</th>
              </tr>
            </thead>
            <tbody>
              {cluster.nodes.map((node) => (
                <tr key={node.name}>
                  <td>{node.name}</td>
                  <td>
                    <span className={`badge ${node.status === 'Ready' ? 'ok' : 'warn'}`}>
                      {node.status}
                    </span>
                  </td>
                  <td>{node.roles.join(', ')}</td>
                  <td>{node.version}</td>
                  <td>{node.internalIp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="wide">
        <h3>POC pods in {cluster.namespace}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>App</th>
                <th>Status</th>
                <th>Ready</th>
                <th>Node</th>
                <th>Pod IP</th>
              </tr>
            </thead>
            <tbody>
              {cluster.pods.map((pod) => (
                <tr key={pod.name}>
                  <td>{pod.name}</td>
                  <td>{pod.app}</td>
                  <td>
                    <span className={`badge ${pod.status === 'Running' ? 'ok' : 'warn'}`}>
                      {pod.status}
                    </span>
                  </td>
                  <td>{pod.ready}</td>
                  <td>{pod.node}</td>
                  <td>{pod.podIp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="wide">
        <h3>Deployments</h3>
        <ul className="deploy-list">
          {cluster.deployments.map((dep) => (
            <li key={dep.name}>
              <strong>{dep.name}</strong> — {dep.ready}/{dep.replicas} ready
            </li>
          ))}
        </ul>
      </article>
    </>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [hello, setHello] = useState(null);
  const [items, setItems] = useState([]);
  const [cluster, setCluster] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, helloData, itemsData, clusterData] = await Promise.all([
        fetchJson('/health'),
        fetchJson('/api/hello'),
        fetchJson('/api/items'),
        fetchJson('/api/cluster'),
      ]);
      setHealth(healthData);
      setHello(helloData);
      setItems(itemsData.items ?? []);
      setCluster(clusterData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="app">
      <header>
        <p className="eyebrow">NRDC proof of concept</p>
        <h1>React + Express on Kubernetes</h1>
        <p className="subtitle">
          Live cluster metadata from the Kubernetes API — nodes, pods, and deployments.
        </p>
      </header>

      <section className="card">
        <div className="card-header">
          <h2>Live API check</h2>
          <button type="button" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && <p className="error">API error: {error}</p>}

        {!error && !loading && (
          <div className="grid">
            <article>
              <h3>Health</h3>
              <pre>{JSON.stringify(health, null, 2)}</pre>
            </article>
            <article>
              <h3>Hello</h3>
              <pre>{JSON.stringify(hello, null, 2)}</pre>
            </article>
            <article className="wide">
              <h3>Items</h3>
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <strong>{item.id}</strong> — {item.name}
                  </li>
                ))}
              </ul>
            </article>

            <ClusterPanel cluster={cluster} />
          </div>
        )}
      </section>

      <footer>
        <p>
          Cluster section reads the API via in-cluster credentials (RBAC). Refresh after
          scaling or restarting pods to see updates.
        </p>
      </footer>
    </div>
  );
}
