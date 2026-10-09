import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Crosshair,
  Gauge,
  Plane,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Signal,
  Wind,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const REFRESH_INTERVAL_MS = 10_000;
const SEARCH_PATH = '/opensearch/flight-positions/_search';
const CENTER_LAT = Number(import.meta.env.FLIGHT_LATITUDE || 40.7128);
const CENTER_LON = Number(import.meta.env.FLIGHT_LONGITUDE || -74.006);
const RADIUS_NM = Number(import.meta.env.FLIGHT_RADIUS_NM || 25);

const number = new Intl.NumberFormat('en-US');
const compactTime = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const fullTime = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

function formatAltitude(value) {
  return Number.isFinite(value) ? `${number.format(Math.round(value))} ft` : '—';
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${Math.round(value)} kt` : '—';
}

function formatAge(timestamp, now = Date.now()) {
  if (!timestamp) return 'No signal';
  const age = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1_000));
  if (age < 60) return `${age}s ago`;
  return `${Math.floor(age / 60)}m ago`;
}

function parseFlight(hit) {
  const source = hit?._source;
  if (!source || typeof source.icao24 !== 'string') return null;
  return source;
}

function useFlights() {
  const [flights, setFlights] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    let timer;

    const load = async () => {
      try {
        const response = await fetch(SEARCH_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            size: 5_000,
            track_total_hits: true,
            sort: [{ observedAt: { order: 'desc' } }],
            query: { range: { observedAt: { gte: 'now-2m' } } },
          }),
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) {
          throw new Error(`OpenSearch returned HTTP ${response.status}.`);
        }

        const result = await response.json();
        const records = (result.hits?.hits || []).map(parseFlight).filter(Boolean);
        if (active) {
          setFlights(records);
          setLastUpdated(new Date());
          setError('');
          setLoading(false);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Could not read flight positions.');
          setLoading(false);
        }
      } finally {
        if (active) timer = setTimeout(load, REFRESH_INTERVAL_MS);
      }
    };

    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [revision]);

  return { flights, lastUpdated, error, loading, refresh };
}

function getDistanceNm(flight) {
  if (!Number.isFinite(flight.latitude) || !Number.isFinite(flight.longitude)) return null;
  const y = (flight.latitude - CENTER_LAT) * 60;
  const x = (flight.longitude - CENTER_LON) * 60 * Math.cos((CENTER_LAT * Math.PI) / 180);
  return Math.sqrt(x * x + y * y);
}

function classify(flight) {
  if (flight.onGround === true) return 'ground';
  if (flight.onGround === false) return 'airborne';
  return 'unknown';
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Airspace home">
        <span className="brand-mark"><Plane size={18} strokeWidth={2.4} /></span>
        <span className="brand-name">airspace<span>.</span></span>
      </a>

      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <a className="nav-item active" href="#overview"><Activity size={17} />Overview</a>
        <a className="nav-item" href="#traffic"><Plane size={17} />Live traffic</a>
        <a className="nav-item" href="#distribution"><Gauge size={17} />Flight profile</a>
      </nav>

      <div className="sidebar-bottom">
        <div className="sector-card">
          <div className="sector-card-heading"><span className="status-dot" /> MONITORED SECTOR</div>
          <div className="sector-name">Configured center</div>
          <div className="sector-coordinates">
            {Math.abs(CENTER_LAT).toFixed(4)}° {CENTER_LAT >= 0 ? 'N' : 'S'}&nbsp;&nbsp;
            {Math.abs(CENTER_LON).toFixed(4)}° {CENTER_LON >= 0 ? 'E' : 'W'}
          </div>
          <div className="sector-radius"><Crosshair size={13} /> {RADIUS_NM} NM radius</div>
        </div>
        <div className="sidebar-footer">
          <span className="footer-icon"><CircleHelp size={16} /></span>
          <span>ADS-B surveillance<br /><b>Local data stream</b></span>
          <span className="footer-version">v1.0</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ lastUpdated, refresh, error }) {
  const linkStatus = error ? 'connection-error' : !lastUpdated ? 'connection-pending' : '';
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Airspace</span><span className="breadcrumb-divider">/</span>
        <b>Operations overview</b>
      </div>
      <div className="topbar-actions">
        <div className={`connection-pill ${linkStatus}`}>
          <span className="status-dot" />
          {error ? 'OPENSEARCH UNAVAILABLE' : lastUpdated ? 'OPENSEARCH LINK ACTIVE' : 'CONNECTING TO OPENSEARCH'}
        </div>
        <span className="topbar-divider" />
        <div className="last-sync"><RefreshCw size={13} /> {lastUpdated ? `Updated ${compactTime.format(lastUpdated)}` : 'Connecting…'}</div>
        <button className="icon-button" type="button" onClick={refresh} title="Refresh now" aria-label="Refresh now">
          <RefreshCw size={15} />
        </button>
        <div className="avatar" title="Local airspace feed">NY</div>
      </div>
    </header>
  );
}

function MetricCard({ label, value, unit, detail, icon: Icon, tone, accent }) {
  return (
    <article className="metric-card">
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
        <span className={`metric-icon ${tone}`}><Icon size={17} strokeWidth={1.8} /></span>
      </div>
      <div className="metric-value">{value}<span>{unit}</span></div>
      <div className="metric-detail">{accent && <span className={`metric-accent ${tone}`}>{accent}</span>}{detail}</div>
    </article>
  );
}

function TrafficMap({ flights, selectedFlight }) {
  const positions = flights.filter((flight) =>
    Number.isFinite(flight.latitude) && Number.isFinite(flight.longitude)
  );
  const visible = positions.filter((flight) => {
    const distance = getDistanceNm(flight);
    return distance !== null && distance <= RADIUS_NM;
  });
  const rings = [0.25, 0.5, 0.75, 1];

  const point = (flight) => {
    const xNm = (flight.longitude - CENTER_LON) * 60 * Math.cos((CENTER_LAT * Math.PI) / 180);
    const yNm = (flight.latitude - CENTER_LAT) * 60;
    return { x: 80 + (xNm / RADIUS_NM) * 46, y: 50 - (yNm / RADIUS_NM) * 46 };
  };

  return (
    <section className="panel map-panel" id="overview">
      <div className="panel-header">
        <div>
          <div className="panel-kicker"><span className="live-mark" /> LIVE RADAR</div>
          <h2>Traffic in sector</h2>
          <p className="panel-subtitle">Aircraft positions relative to sector center</p>
        </div>
        <div className="map-header-right">
          <div className="map-legend"><i className="legend-plane" /> Aircraft</div>
        </div>
      </div>
      <div className="radar-wrap">
        <div className="radar-grid-label label-north">N</div>
        <div className="radar-grid-label label-east">E</div>
        <div className="radar-grid-label label-south">S</div>
        <div className="radar-grid-label label-west">W</div>
        <svg className="radar-svg" viewBox="0 0 160 100" role="img" aria-label={`${visible.length} aircraft shown on the sector plot`}>
          <defs>
            <pattern id="radarGrid" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#dce5e8" strokeWidth=".12" />
            </pattern>
            <radialGradient id="radarFill">
              <stop offset="0%" stopColor="#e8f1ee" stopOpacity=".38" />
              <stop offset="100%" stopColor="#f3f7f6" stopOpacity=".75" />
            </radialGradient>
            <clipPath id="radarClip"><circle cx="80" cy="50" r="46" /></clipPath>
          </defs>
          <rect x="34" y="4" width="92" height="92" rx="46" fill="url(#radarFill)" />
          <rect x="34" y="4" width="92" height="92" rx="46" fill="url(#radarGrid)" />
          {rings.map((ring) => (
            <circle key={ring} cx="80" cy="50" r={ring * 46} className="radar-ring" />
          ))}
          <line x1="80" y1="4" x2="80" y2="96" className="radar-crosshair" />
          <line x1="34" y1="50" x2="126" y2="50" className="radar-crosshair" />
          <circle cx="80" cy="50" r="1.3" className="sector-center" />
          <g clipPath="url(#radarClip)">
            {visible.map((flight) => {
              const { x, y } = point(flight);
              const selected = selectedFlight?.icao24 === flight.icao24;
              const ground = classify(flight) === 'ground';
              return (
                <g
                  key={flight.icao24}
                  className={`radar-target ${selected ? 'selected' : ''} ${ground ? 'target-ground' : ''}`}
                  transform={`translate(${x} ${y}) rotate(${Number(flight.trueTrack) || 0})`}
                  onClick={() => onSelect(flight)}
                  role="button"
                  tabIndex="0"
                  aria-label={`Select ${flight.callsign || flight.icao24}`}
                  onKeyDown={(event) => event.key === 'Enter' && onSelect(flight)}
                >
                  {selected && <circle r="2.25" className="target-pulse" />}
                  <path d="M 0 -1.65 L .72 .82 L 0 .48 L -.72 .82 Z" className="target-shape" />
                  <circle r=".25" className="target-core" />
                </g>
              );
            })}
          </g>
        </svg>
        {rings.slice(0, 3).map((ring) => (
          <span
            key={ring}
            className="ring-label"
            style={{ left: `${50 + ring * 28.75}%`, top: '50%' }}
          >
            {Math.round(RADIUS_NM * ring)} NM
          </span>
        ))}
        <div className="map-scale"><span />{RADIUS_NM} NM range</div>
      </div>
      <div className="map-footer">
        <span><span className="status-dot" /> {visible.length} positions plotted</span>
        <span>{positions.length - visible.length > 0 ? `${positions.length - visible.length} outside view` : 'All reports in view'}</span>
        <span className="map-updated"><Clock3 size={12} /> {flights[0] ? `Latest report ${formatAge(flights[0].observedAt)}` : 'Awaiting first position'}</span>
      </div>
    </section>
  );
}

function TrafficTrend({ history, flights }) {
  const current = history.at(-1)?.count ?? flights.length;
  const first = history[0]?.count ?? current;
  const difference = current - first;
  const chart = history.length > 1 ? history : [{ time: '—', count: current }, { time: 'now', count: current }];
  return (
    <section className="panel trend-panel">
      <div className="panel-header trend-header">
        <div>
          <div className="panel-kicker">SECTOR ACTIVITY</div>
          <h2>Aircraft count</h2>
        </div>
        <div className="trend-current">
          <span>{number.format(current)}</span>
          <small>currently tracked</small>
        </div>
      </div>
      <div className="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="aircraftArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#267f73" stopOpacity=".23" />
                <stop offset="90%" stopColor="#267f73" stopOpacity="0" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e9eef0" strokeDasharray="3 5" />
            <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#9aa7ad', fontSize: 10 }} minTickGap={28} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#9aa7ad', fontSize: 10 }} allowDecimals={false} domain={['dataMin - 4', 'dataMax + 4']} />
            <Tooltip
              contentStyle={{ border: '1px solid #e4ebed', borderRadius: 8, fontSize: 12, boxShadow: '0 8px 24px #18303612' }}
              formatter={(value) => [`${value} aircraft`, 'In sector']}
              labelStyle={{ color: '#6b7b80', marginBottom: 4 }}
            />
            <Area type="monotone" dataKey="count" stroke="#267f73" strokeWidth={2} fill="url(#aircraftArea)" activeDot={{ r: 4, fill: '#267f73', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-footer">
        <span><i className="chart-legend-dot" /> Tracked aircraft</span>
        <span className={`trend-change ${difference > 0 ? 'positive' : difference < 0 ? 'negative' : ''}`}>
          {difference > 0 ? <ArrowUpRight size={14} /> : difference < 0 ? <ArrowDownRight size={14} /> : <Activity size={13} />}
          {difference > 0 ? '+' : ''}{difference} <span>since session start</span>
        </span>
      </div>
    </section>
  );
}

const ALTITUDE_BUCKETS = [
  { label: 'Ground', min: -Infinity, max: 0, color: '#bdc9cd' },
  { label: '0–5k', min: 0, max: 5_000, color: '#77b5a8' },
  { label: '5–10k', min: 5_000, max: 10_000, color: '#57a291' },
  { label: '10–20k', min: 10_000, max: 20_000, color: '#398a7d' },
  { label: '20–30k', min: 20_000, max: 30_000, color: '#287668' },
  { label: '30k+', min: 30_000, max: Infinity, color: '#185c55' },
];

function FlightProfile({ flights }) {
  const buckets = ALTITUDE_BUCKETS.map((bucket) => ({
    ...bucket,
    count: flights.filter((flight) => {
      if (bucket.label === 'Ground') return flight.onGround === true;
      return Number.isFinite(flight.baroAltitude) && flight.baroAltitude >= bucket.min && flight.baroAltitude < bucket.max;
    }).length,
  }));
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <section className="panel profile-panel" id="distribution">
      <div className="panel-header profile-heading">
        <div>
          <div className="panel-kicker">VERTICAL DISTRIBUTION</div>
          <h2>Altitude profile</h2>
        </div>
        <span className="unit-label">BAROMETRIC · FT</span>
      </div>
      <div className="altitude-bars">
        {buckets.map((bucket) => (
          <div className="altitude-row" key={bucket.label}>
            <span className="altitude-label">{bucket.label}</span>
            <div className="altitude-track">
              <div className="altitude-fill" style={{ width: `${Math.max(bucket.count ? 3 : 0, (bucket.count / maxCount) * 100)}%`, background: bucket.color }} />
            </div>
            <span className="altitude-count">{bucket.count}</span>
          </div>
        ))}
      </div>
      <div className="profile-note"><Wind size={14} /> {flights.filter((flight) => Number.isFinite(flight.baroAltitude)).length} aircraft reporting altitude</div>
    </section>
  );
}

function AircraftDetail({ flight, onClose }) {
  if (!flight) {
    return (
      <div className="detail-empty">
        <span className="empty-illustration"><Plane size={22} /></span>
        <b>Select an aircraft</b>
        <p>Choose a radar target or traffic row to inspect its flight details.</p>
      </div>
    );
  }

  const details = [
    ['Registration', flight.registration],
    ['Aircraft type', flight.aircraftType],
    ['Category', flight.category],
    ['Transponder', flight.squawk],
    ['Vertical rate', Number.isFinite(flight.verticalRate) ? `${Math.round(flight.verticalRate).toLocaleString()} ft/min` : null],
    ['Signal source', flight.positionSource],
    ['Emergency', flight.emergency && flight.emergency !== 'none' ? flight.emergency.toUpperCase() : 'None'],
    ['Last report', formatAge(flight.observedAt)],
  ];
  const distance = getDistanceNm(flight);
  return (
    <div className="aircraft-detail">
      <div className="detail-title-row">
        <div className="detail-ident">
          <span className={`aircraft-icon ${classify(flight)}`}><Plane size={18} /></span>
          <div>
            <div className="detail-kicker">AIRCRAFT RECORD</div>
            <h3>{flight.callsign || flight.icao24}</h3>
          </div>
        </div>
        <button className="icon-button close-detail" onClick={onClose} type="button" aria-label="Close details"><X size={15} /></button>
      </div>
      <div className="detail-registration">{flight.registration || 'Registration unavailable'} <span>·</span> {flight.aircraftType || 'Type unknown'}</div>
      <div className="detail-readout">
        <div><small>ALTITUDE</small><b>{formatAltitude(flight.baroAltitude)}</b></div>
        <div><small>GROUND SPEED</small><b>{formatSpeed(flight.velocity)}</b></div>
      </div>
      <div className="detail-section-label">FLIGHT DATA</div>
      <dl className="detail-list">
        {details.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>
        ))}
        <div><dt>Sector distance</dt><dd>{distance == null ? '—' : `${distance.toFixed(1)} NM`}</dd></div>
        <div><dt>Position</dt><dd>{Number.isFinite(flight.latitude) && Number.isFinite(flight.longitude) ? `${flight.latitude.toFixed(3)}, ${flight.longitude.toFixed(3)}` : '—'}</dd></div>
      </dl>
      <div className="transponder-id"><span>ICAO24</span><b>{flight.icao24.toUpperCase()}</b></div>
    </div>
  );
}

function TrafficTable({ flights, selectedFlight, onSelect, filter, setFilter, search, setSearch }) {
  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return flights
      .filter((flight) => filter === 'all' || classify(flight) === filter)
      .filter((flight) => !normalized || [
        flight.callsign,
        flight.registration,
        flight.icao24,
        flight.aircraftType,
      ].some((value) => value?.toLowerCase().includes(normalized)))
      .sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt));
  }, [flights, filter, search]);

  return (
    <section className="panel table-panel" id="traffic">
      <div className="table-heading">
        <div>
          <div className="panel-kicker">AIRCRAFT DIRECTORY</div>
          <h2>Live traffic <span className="heading-count">{number.format(filtered.length)}</span></h2>
        </div>
        <div className="table-controls">
          <label className="search-box">
            <Search size={14} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find aircraft" aria-label="Find aircraft" />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>}
          </label>
          <label className="filter-select">
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter aircraft status">
              <option value="all">All aircraft</option>
              <option value="airborne">Airborne</option>
              <option value="ground">On ground</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      </div>
      <div className="traffic-table-scroll">
        <table className="traffic-table">
          <thead><tr>
            <th>CALLSIGN / REGISTRATION</th>
            <th>AIRCRAFT</th>
            <th>ALTITUDE</th>
            <th>GROUND SPEED</th>
            <th>HEADING</th>
            <th>STATUS</th>
            <th>LAST REPORT</th>
          </tr></thead>
          <tbody>
            {filtered.slice(0, 100).map((flight) => {
              const status = classify(flight);
              return (
                <tr
                  key={flight.icao24}
                  className={selectedFlight?.icao24 === flight.icao24 ? 'row-selected' : ''}
                  onClick={() => onSelect(flight)}
                >
                  <td><div className="callsign-cell"><span className={`table-plane ${status}`}><Plane size={14} /></span><span><b>{flight.callsign || '—'}</b><small>{flight.registration || flight.icao24.toUpperCase()}</small></span></div></td>
                  <td><span className="type-cell">{flight.aircraftType || 'Unknown'}</span></td>
                  <td className="numeric-cell">{status === 'ground' ? 'GROUND' : formatAltitude(flight.baroAltitude)}</td>
                  <td className="numeric-cell">{formatSpeed(flight.velocity)}</td>
                  <td className="numeric-cell">{Number.isFinite(flight.trueTrack) ? `${Math.round(flight.trueTrack)}°` : '—'}</td>
                  <td><span className={`status-badge ${status}`}><i />{status === 'airborne' ? 'Airborne' : status === 'ground' ? 'On ground' : 'Unknown'}</span></td>
                  <td className="age-cell">{formatAge(flight.observedAt)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan="7" className="empty-table">
                {flights.length ? 'No aircraft match these filters.' : 'Waiting for aircraft data from OpenSearch…'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>Showing {Math.min(filtered.length, 100)} of {number.format(filtered.length)} aircraft</span>
        <span>Positions refresh every 10 seconds</span>
      </div>
    </section>
  );
}

function App() {
  const { flights, lastUpdated, error, loading, refresh } = useFlights();
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState([]);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!lastUpdated) return;
    setHistory((current) => {
      if (current.at(-1)?.observedAt === lastUpdated.toISOString()) return current;
      return [
        ...current,
        {
          time: compactTime.format(lastUpdated),
          observedAt: lastUpdated.toISOString(),
          count: flights.length,
        },
      ].slice(-36);
    });
  }, [flights, lastUpdated]);

  const selectedFlight = flights.find((flight) => flight.icao24 === selectedId) || null;
  const airborne = flights.filter((flight) => flight.onGround === false).length;
  const ground = flights.filter((flight) => flight.onGround === true).length;
  const knownSpeeds = flights.map((flight) => flight.velocity).filter(Number.isFinite);
  const averageSpeed = knownSpeeds.length
    ? knownSpeeds.reduce((total, speed) => total + speed, 0) / knownSpeeds.length
    : null;
  const altitudeValues = flights.map((flight) => flight.baroAltitude).filter(Number.isFinite).sort((a, b) => a - b);
  const medianAltitude = altitudeValues.length
    ? altitudeValues[Math.floor(altitudeValues.length / 2)]
    : null;
  const emergencyCount = flights.filter((flight) => flight.emergency && flight.emergency !== 'none').length;
  const feedAge = flights[0]?.observedAt ? (clock - new Date(flights[0].observedAt).getTime()) / 1_000 : Infinity;
  const feedStatus = error
    ? 'interrupted'
    : !lastUpdated
      ? 'loading'
      : flights.length === 0
        ? 'quiet'
        : feedAge > 45
          ? 'delayed'
          : 'live';

  const selectFromMap = (flight) => {
    if (flight) setSelectedId(flight.icao24);
    else setSelectedId('');
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-area">
        <Topbar lastUpdated={lastUpdated} refresh={refresh} error={error} />
        <div className="dashboard-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-rule" /> FLIGHT OPERATIONS <span className="eyebrow-slash">/</span> SECTOR 01</div>
              <h1>Airspace overview</h1>
              <p>Real-time aircraft activity across your monitored sector.</p>
            </div>
            <div className={`live-status ${feedStatus}`}>
              <span className="live-status-icon">{feedStatus === 'interrupted' ? <ShieldAlert size={16} /> : <Radio size={16} />}</span>
              <span><b>{feedStatus === 'live' ? 'Live feed' : feedStatus === 'delayed' ? 'Feed delayed' : feedStatus === 'quiet' ? 'No recent reports' : feedStatus === 'loading' ? 'Connecting…' : 'Feed offline'}</b><small>{flights.length ? `ADSB.lol · ${formatAge(flights[0]?.observedAt, clock)}` : loading ? 'Connecting to OpenSearch' : 'Waiting for current positions'}</small></span>
              <span className="live-pulse" />
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <Signal size={16} />
              <span><b>Could not load live positions.</b> {error} Check that OpenSearch is running and the dashboard is using its proxy.</span>
              <button type="button" onClick={refresh}>Retry</button>
            </div>
          )}

          <section className="metrics-grid" aria-label="Live sector statistics">
            <MetricCard
              label="AIRCRAFT IN SECTOR"
              value={number.format(flights.length)}
              unit=""
              detail={<><span>{airborne} airborne</span><span className="detail-separator">·</span><span>{ground} on ground</span></>}
              icon={Plane}
              tone="teal"
              accent={<><span className="status-dot" /> LIVE</>}
            />
            <MetricCard
              label="AIRBORNE"
              value={number.format(airborne)}
              unit=""
              detail={`${flights.length ? Math.round((airborne / flights.length) * 100) : 0}% of tracked aircraft`}
              icon={ArrowUpRight}
              tone="blue"
            />
            <MetricCard
              label="MEDIAN ALTITUDE"
              value={medianAltitude === null ? '—' : number.format(Math.round(medianAltitude))}
              unit={medianAltitude === null ? '' : ' ft'}
              detail={`${altitudeValues.length} aircraft reporting`}
              icon={Compass}
              tone="violet"
            />
            <MetricCard
              label="AVG. GROUND SPEED"
              value={averageSpeed === null ? '—' : Math.round(averageSpeed)}
              unit={averageSpeed === null ? '' : ' kt'}
              detail="Across available reports"
              icon={Wind}
              tone="amber"
            />
            <MetricCard
              label="EMERGENCY SQUAWKS"
              value={number.format(emergencyCount)}
              unit=""
              detail={emergencyCount ? 'Review aircraft records' : 'No active reports'}
              icon={ShieldAlert}
              tone={emergencyCount ? 'red' : 'slate'}
              accent={emergencyCount ? 'ATTENTION' : null}
            />
          </section>

          <div className="primary-grid">
            <TrafficMap flights={flights} selectedFlight={selectedFlight} />
            <TrafficTrend history={history} flights={flights} />
          </div>

          <div className="secondary-grid">
            <FlightProfile flights={flights} />
            <section className="panel detail-panel">
              <div className="panel-header detail-panel-heading">
                <div><div className="panel-kicker">QUICK INSPECT</div><h2>Aircraft details</h2></div>
                {selectedFlight && <span className="detail-live-tag"><i /> SELECTED</span>}
              </div>
              <AircraftDetail flight={selectedFlight} onClose={() => setSelectedId('')} />
            </section>
          </div>

          <TrafficTable
            flights={flights}
            selectedFlight={selectedFlight}
            onSelect={(flight) => setSelectedId(flight.icao24)}
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
          />

          <footer className="dashboard-footer">
            <span><Building2 size={13} /> AIRSPACE MONITORING <i /> LOCAL SECTOR</span>
            <span><Clock3 size={13} /> {fullTime.format(clock)} <i /> {lastUpdated ? `Sync ${compactTime.format(lastUpdated)}` : 'Awaiting sync'}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
