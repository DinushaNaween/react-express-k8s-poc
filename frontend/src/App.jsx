import { useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from 'react';

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? `${response.status} ${response.statusText}`);
  }
  return data;
}

function StatusBadge({ status }) {
  const normalized = (status ?? 'unknown').toLowerCase();
  const ok = [
    'healthy',
    'applied',
    'active',
    'succeeded',
    'running',
    'true',
    'passing',
    'ready',
  ].includes(normalized);
  const warn = [
    'degraded',
    'recovering',
    'attention',
    'scheduled',
    'suspended',
    'pending',
  ].includes(normalized);
  const cls = ok ? 'ok' : warn ? 'warn' : 'bad';
  return <span className={`badge ${cls}`}>{status ?? 'unknown'}</span>;
}

function probeStatusLabel(status) {
  if (status === 'passing') return 'healthy';
  if (status === 'dead') return 'dead';
  if (status === 'failed') return 'failed';
  if (status === 'failing') return 'failing';
  return status ?? 'unknown';
}

function podPhaseLabel(phase) {
  if (phase === 'Terminating') return 'dead';
  if (phase === 'Failed') return 'failed';
  if (phase === 'Running') return 'running';
  return phase ?? 'unknown';
}

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
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
            <dd>{formatTime(cluster.fetchedAt)}</dd>
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
                    <StatusBadge status={node.status === 'Ready' ? 'healthy' : node.status} />
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
                    <StatusBadge status={pod.status === 'Running' ? 'healthy' : pod.status} />
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

function InfrastructurePanel({ infra }) {
  if (!infra?.available) {
    return (
      <article className="wide infra-unavailable">
        <h3>Infrastructure &amp; ops</h3>
        <p className="muted">{infra?.reason ?? 'Infrastructure details not available.'}</p>
      </article>
    );
  }

  return (
    <>
      <article className="wide section-intro">
        <h3>Infrastructure overview</h3>
        <p className="muted">{infra.terraform?.summary}</p>
        <p className="muted">{infra.autoHeal?.summary}</p>
        <dl className="stats compact">
          <div>
            <dt>Environment</dt>
            <dd>{infra.environment}</dd>
          </div>
          <div>
            <dt>Ops namespace</dt>
            <dd>{infra.opsNamespace?.name}</dd>
          </div>
          <div>
            <dt>ZeroClaw</dt>
            <dd>{infra.zeroclaw?.deployed ? 'deployed' : 'not deployed'}</dd>
          </div>
        </dl>
      </article>

      <article className="wide">
        <h3>Terraform layers (live state)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Layer</th>
                <th>Path</th>
                <th>State</th>
                <th>Live status</th>
                <th>Manages</th>
              </tr>
            </thead>
            <tbody>
              {infra.terraform?.layers?.map((layer) => (
                <tr key={layer.id}>
                  <td>
                    <strong>{layer.label}</strong>
                    <div className="subtle">{layer.engine}</div>
                  </td>
                  <td>
                    <code>{layer.path}</code>
                    <div className="subtle">{layer.stateBackend}</div>
                  </td>
                  <td>
                    <StatusBadge status={layer.live?.status} />
                  </td>
                  <td>{layer.live?.detail}</td>
                  <td>{layer.manages.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="wide">
        <h3>Auto-heal pipeline</h3>
        <div className="heal-grid">
          {infra.autoHeal?.layers?.map((layer) => (
            <div key={layer.level} className="heal-card">
              <div className="heal-card-head">
                <span className="heal-level">{layer.level}</span>
                <StatusBadge status={layer.status} />
              </div>
              <h4>{layer.name}</h4>
              <p className="muted">{layer.mechanism}</p>
              {layer.level === 'L1' && (
                <ul className="compact-list">
                  {layer.targets?.map((t) => (
                    <li key={t.deployment}>
                      <strong>{t.deployment}</strong> {t.ready} · {t.restarts} restarts
                    </li>
                  ))}
                </ul>
              )}
              {layer.level === 'L2-event' && (
                <>
                  <dl className="mini-stats">
                    <div>
                      <dt>Watcher</dt>
                      <dd>{layer.deployment?.ready ?? 'not deployed'}</dd>
                    </div>
                    <div>
                      <dt>Last event repair</dt>
                      <dd>
                        {layer.lastEventRepair
                          ? formatTime(
                              layer.lastEventRepair.completionTime ||
                                layer.lastEventRepair.startTime
                            )
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
              {layer.level === 'L2-scheduled' && layer.cronJob && (
                <>
                  <dl className="mini-stats">
                    <div>
                      <dt>CronJob</dt>
                      <dd>{layer.cronJob.name}</dd>
                    </div>
                    <div>
                      <dt>Schedule</dt>
                      <dd>{layer.cronJob.schedule}</dd>
                    </div>
                    <div>
                      <dt>Last success</dt>
                      <dd>{formatTime(layer.cronJob.lastSuccessfulTime)}</dd>
                    </div>
                  </dl>
                  {layer.recentJobs?.length > 0 && (
                    <>
                      <p className="subtle">Recent repair jobs</p>
                      <ul className="compact-list">
                        {layer.recentJobs.map((job) => (
                          <li key={job.name}>
                            <strong>{job.name}</strong>{' '}
                            <StatusBadge status={job.status} /> ·{' '}
                            {formatTime(job.completionTime || job.startTime)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </article>

      <article className="wide">
        <h3>ZeroClaw ops agent</h3>
        {!infra.zeroclaw?.deployed ? (
          <p className="muted">Ops layer not deployed. Run ops Terraform to enable ZeroClaw.</p>
        ) : (
          <>
            <dl className="stats compact">
              <div>
                <dt>Skill</dt>
                <dd>{infra.zeroclaw.skill}</dd>
              </div>
              <div>
                <dt>Gateway health</dt>
                <dd>
                  {infra.zeroclaw.gateway?.reachable ? 'reachable' : 'unreachable'}
                </dd>
              </div>
              <div>
                <dt>Deployment</dt>
                <dd>{infra.zeroclaw.deployment?.ready}</dd>
              </div>
              <div>
                <dt>Event healer</dt>
                <dd>{infra.zeroclaw?.eventHealerDeployed ? 'deployed' : 'not deployed'}</dd>
              </div>
              <div>
                <dt>Ollama</dt>
                <dd>{infra.zeroclaw.ollamaEnabled ? 'enabled' : 'disabled (local)'}</dd>
              </div>
            </dl>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pod</th>
                    <th>Phase</th>
                    <th>Ready</th>
                    <th>Restarts</th>
                  </tr>
                </thead>
                <tbody>
                  {infra.zeroclaw.pods?.map((pod) => (
                    <tr key={pod.name}>
                      <td>{pod.name}</td>
                      <td>
                        <StatusBadge
                          status={pod.phase === 'Running' ? 'healthy' : pod.phase}
                        />
                      </td>
                      <td>{pod.ready}</td>
                      <td>{pod.restarts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {infra.zeroclaw.gateway?.body && (
              <details className="raw-details">
                <summary>Gateway /health response</summary>
                <pre>{JSON.stringify(infra.zeroclaw.gateway.body, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </article>
    </>
  );
}

function ZeroClawCountdown({ zeroclaw, onTriggerRepair, triggering }) {
  const [tick, setTick] = useState(zeroclaw?.secondsUntilNext ?? 0);

  useEffect(() => {
    setTick(zeroclaw?.secondsUntilNext ?? 0);
  }, [zeroclaw?.secondsUntilNext, zeroclaw?.fetchedAt]);

  useEffect(() => {
    if (zeroclaw?.phase === 'running') return undefined;
    const id = setInterval(() => {
      setTick((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [zeroclaw?.phase]);

  if (!zeroclaw?.available) {
    return <p className="muted">{zeroclaw?.reason ?? 'ZeroClaw ops not available'}</p>;
  }

  const interval = zeroclaw.intervalSeconds ?? 120;
  const running = zeroclaw.phase === 'running';
  const starting = zeroclaw.phase === 'starting' || tick === 0;
  const progress = running
    ? 100
    : Math.min(100, Math.round(((interval - tick) / interval) * 100));

  return (
    <div className="zeroclaw-monitor">
      <div className="countdown-head">
        <div>
          <strong>Scheduled fallback check</strong>
          <p className="subtle">
            Event healer reacts in ~8s · CronJob {zeroclaw.cronJob} · {zeroclaw.schedule}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onTriggerRepair} disabled={triggering || running}>
          {triggering ? 'Starting…' : 'Run check now'}
        </button>
      </div>

      <div className={`countdown-bar ${running || starting ? 'active' : ''}`}>
        <div className="countdown-fill" style={{ width: `${progress}%` }} />
        {(running || starting) && <div className="countdown-shimmer" />}
      </div>

      <div className="countdown-meta">
        {running ? (
          <span className="countdown-status running">ZeroClaw health check running…</span>
        ) : starting ? (
          <span className="countdown-status starting">Starting scheduled check…</span>
        ) : (
          <span className="countdown-status waiting">
            Check in <strong>{tick}s</strong> · {formatTime(zeroclaw.nextCheckAt)}
          </span>
        )}
      </div>

      {zeroclaw.activeJob?.logs?.length > 0 && (
        <div className="activity-log live">
          <p className="subtle">Live repair output</p>
          <pre>{zeroclaw.activeJob.logs.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}

function ActivityLog({ events, totalCount }) {
  const listRef = useRef(null);
  const prevMetaRef = useRef({ length: 0, scrollHeight: 0, scrollTop: 0 });

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !events?.length) return;

    const prev = prevMetaRef.current;
    const added = events.length - prev.length;

    if (added > 0 && prev.length > 0) {
      const heightDelta = el.scrollHeight - prev.scrollHeight;
      const userScrolledInLog = prev.scrollTop > 8;

      if (userScrolledInLog && heightDelta > 0) {
        // Newest events prepend at top — keep the user's place in history
        el.scrollTop = prev.scrollTop + heightDelta;
      } else if (!userScrolledInLog) {
        el.scrollTop = 0;
      }
    }

    prevMetaRef.current = {
      length: events.length,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
  }, [events]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    prevMetaRef.current = {
      ...prevMetaRef.current,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
    };
  };

  if (!events?.length) {
    return <p className="muted activity-empty">No activity yet — kill a pod or wait for the next ZeroClaw check.</p>;
  }

  return (
    <div className="activity-feed">
      <div className="activity-feed-head">
        <p className="subtle">Agent activity log ({totalCount ?? events.length} events — scroll for history)</p>
      </div>
      <ul ref={listRef} className="activity-list scrollable" onScroll={handleScroll}>
        {events.map((event) => (
          <li key={event.id ?? `${event.time}-${event.message}`} className={`activity-level-${event.level ?? 'info'}`}>
            <span className="activity-time">{formatTime(event.time)}</span>
            <span className={`activity-src src-${event.source?.replace(/[^a-z0-9-]/gi, '-')}`}>
              {event.source}
            </span>
            <span className="activity-message">{event.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MemoActivityLog = memo(ActivityLog);

function TestLabPanel({ testlab, onRefresh, killing, onKillProbe, onKillNode, onTriggerRepair, triggering }) {
  if (!testlab?.available) {
    return (
      <article className="wide testlab-unavailable">
        <h3>Failure test lab</h3>
        <p className="muted">{testlab?.reason ?? 'Test lab not available.'}</p>
      </article>
    );
  }

  return (
    <>
      <article className="wide section-intro testlab-intro">
        <h3>Failure test lab</h3>
        <p className="muted">
          Kill probes to test healing. L1 recreates pods in seconds. Event healer triggers repair
          jobs quickly; scheduled CronJob is the fallback.
        </p>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={killing}>
          Refresh test state
        </button>
      </article>

      <div className="testlab-split wide">
        <article className="testlab-split-panel testlab-probes-panel">
          <h3>Health probes ({testlab.probes?.length ?? 0})</h3>
          <p className="subtle panel-hint">All probes visible — kill one and watch agent activity on the right.</p>
          <div className="probe-grid">
            {testlab.probes?.map((probe) => (
              <div
                key={probe.id}
                className={`probe-card ${
                  probe.status === 'dead' || probe.status === 'failed' ? 'row-failed' : ''
                }`}
              >
                <div className="probe-card-head">
                  <span className="probe-card-title">
                    {probe.deployment} · {probe.type}
                  </span>
                </div>
                <div className="probe-card-meta">
                  {probe.container} · {probe.path}:{probe.port} · every {probe.periodSeconds}s
                </div>
                <div className="probe-card-status">
                  <StatusBadge status={probeStatusLabel(probe.status)} />
                  <StatusBadge status={podPhaseLabel(probe.podPhase)} />
                </div>
                <div className="probe-card-pod">
                  <code>{probe.targetPod ?? '—'}</code>
                  {probe.ready && <div className="subtle">ready {probe.ready}</div>}
                </div>
                <div className="probe-card-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={killing || !probe.targetPod || probe.podPhase === 'Terminating'}
                    onClick={() => onKillProbe(probe.id)}
                    title="Delete pod to fail probe — Deployment recreates it"
                  >
                    Kill pod
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="testlab-split-panel testlab-agent-panel">
          <h3>ZeroClaw healer — live</h3>
          <p className="subtle panel-hint">
            Event healer:{' '}
            {testlab.zeroclaw?.eventHealer?.deployed
              ? `active (${testlab.zeroclaw.eventHealer.deployment?.ready ?? '—'})`
              : 'not deployed'}
            {' · '}
            {testlab.zeroclaw?.eventHealer?.mechanism ?? 'Watching for failures'}
          </p>
          <ZeroClawCountdown
            zeroclaw={testlab.zeroclaw}
            onTriggerRepair={onTriggerRepair}
            triggering={triggering}
          />
          <MemoActivityLog events={testlab.activityLog} totalCount={testlab.activityCount} />
          {testlab.zeroclaw?.recentJobs?.length > 0 && (
            <div className="table-wrap recent-jobs-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Repair job</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {testlab.zeroclaw.recentJobs.slice(0, 4).map((job) => (
                    <tr key={job.name}>
                      <td>
                        <code className="job-name">{job.name.replace(/^nrdc-cluster-ops-/, '')}</code>
                      </td>
                      <td>{job.trigger ?? 'scheduled'}</td>
                      <td>
                        <StatusBadge status={job.status} />
                      </td>
                      <td>{formatTime(job.startTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      <article className="wide">
        <h3>Cluster nodes ({testlab.nodes?.length ?? 0})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Workloads</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {testlab.nodes?.map((node) => (
                <tr key={node.name}>
                  <td>{node.name}</td>
                  <td>
                    <StatusBadge status={node.status === 'Ready' ? 'healthy' : node.status} />
                  </td>
                  <td>{node.roles?.length ? node.roles.join(', ') : 'worker'}</td>
                  <td>
                    <ul className="node-pod-list">
                      {node.pods?.map((pod) => (
                        <li key={pod.name}>
                          <code>{pod.name}</code>{' '}
                          <StatusBadge status={podPhaseLabel(pod.phase)} />{' '}
                          <span className="subtle">{pod.app}</span>
                        </li>
                      ))}
                      {node.podCount === 0 && <span className="muted">none</span>}
                    </ul>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={killing || node.podCount === 0}
                      onClick={() => onKillNode(node.name)}
                      title={node.killDescription}
                    >
                      Evict workloads
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [hello, setHello] = useState(null);
  const [items, setItems] = useState([]);
  const [cluster, setCluster] = useState(null);
  const [infra, setInfra] = useState(null);
  const [testlab, setTestlab] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [liveMonitor, setLiveMonitor] = useState(true);

  const loadTestLab = useCallback(async () => {
    const data = await fetchJson('/api/testlab/status');
    setTestlab({ ...data, zeroclaw: { ...data.zeroclaw, fetchedAt: data.fetchedAt } });
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, helloData, itemsData, clusterData, infraData, testlabData] =
        await Promise.all([
          fetchJson('/health'),
          fetchJson('/api/hello'),
          fetchJson('/api/items'),
          fetchJson('/api/cluster'),
          fetchJson('/api/infrastructure'),
          fetchJson('/api/testlab/status'),
        ]);
      setHealth(healthData);
      setHello(helloData);
      setItems(itemsData.items ?? []);
      setCluster(clusterData);
      setInfra(infraData);
      setTestlab({ ...testlabData, zeroclaw: { ...testlabData.zeroclaw, fetchedAt: testlabData.fetchedAt } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!liveMonitor || loading || error) return undefined;
    const id = setInterval(() => {
      loadTestLab().catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [liveMonitor, loading, error, loadTestLab]);

  const handleKillProbe = async (probeId) => {
    setKilling(true);
    try {
      await postJson('/api/testlab/kill-probe', { probeId });
      for (let i = 0; i < 6; i += 1) {
        await loadTestLab();
        if (i < 5) await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kill failed');
    } finally {
      setKilling(false);
    }
  };

  const handleKillNode = async (nodeName) => {
    setKilling(true);
    try {
      await postJson('/api/testlab/kill-node', { nodeName });
      for (let i = 0; i < 6; i += 1) {
        await loadTestLab();
        if (i < 5) await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evict failed');
    } finally {
      setKilling(false);
    }
  };

  const handleTriggerRepair = async () => {
    setTriggering(true);
    try {
      await postJson('/api/testlab/trigger-repair', {});
      await loadTestLab();
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="app">
      <header>
        <p className="eyebrow">NRDC proof of concept</p>
        <h1>React + Express on Kubernetes</h1>
        <p className="subtitle">
          Live view of the cluster, Terraform-managed layers, auto-heal pipeline, and ZeroClaw
          ops agent — for developers tracing how this POC runs under the hood.
        </p>
      </header>

      <section className="card">
        <div className="card-header">
          <h2>Platform dashboard</h2>
          <div className="header-actions">
            <label className="live-toggle">
              <input
                type="checkbox"
                checked={liveMonitor}
                onChange={(e) => setLiveMonitor(e.target.checked)}
              />
              Live monitor (2s)
            </label>
            <button type="button" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
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

            <InfrastructurePanel infra={infra} />
            <TestLabPanel
              testlab={testlab}
              onRefresh={loadTestLab}
              killing={killing}
              onKillProbe={handleKillProbe}
              onKillNode={handleKillNode}
              onTriggerRepair={handleTriggerRepair}
              triggering={triggering}
            />
            <ClusterPanel cluster={cluster} />
          </div>
        )}
      </section>

      <footer>
        <p>
          Use the failure test lab to kill pods or evict node workloads and watch L1/L2 recovery.
          ZeroClaw countdown shows the next scheduled repair check; live output appears when a job
          runs.
        </p>
      </footer>
    </div>
  );
}
