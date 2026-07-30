import React, { useEffect, useMemo, useState } from 'react';
import '../styles/elisei-ads.css';

const money = (value, currency = 'RUB') => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: currency || 'RUB', maximumFractionDigits: 0,
}).format(Number(value || 0));
const compact = (value) => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
const percent = (value, digits = 1) => value === null || value === undefined ? '—' : `${Number(value).toFixed(digits)}%`;
const decimal = (value, digits = 2) => value === null || value === undefined ? '—' : Number(value).toFixed(digits);

function currentPeriod() {
  const fallback = new Date();
  const to = fallback.toISOString().slice(0, 10);
  fallback.setDate(fallback.getDate() - 6);
  return window.__ELISEI_PERIOD__ || { from: fallback.toISOString().slice(0, 10), to, compareEnabled: true };
}

function queryFor(period) {
  const params = new URLSearchParams({ date_from: period.from, date_to: period.to, compare: period.compareEnabled ? '1' : '0' });
  if (period.compareFrom) params.set('compare_from', period.compareFrom);
  if (period.compareTo) params.set('compare_to', period.compareTo);
  return params.toString();
}

function useEliseiPeriod() {
  const [period, setPeriod] = useState(() => currentPeriod());
  useEffect(() => {
    const handler = (event) => setPeriod(event.detail || currentPeriod());
    window.addEventListener('elisei:period-changed', handler);
    return () => window.removeEventListener('elisei:period-changed', handler);
  }, []);
  return period;
}


function currentCabinetId() {
  const globalCabinet = window.__ELISEI_ACTIVE_CABINET__;
  return String(
    globalCabinet?.id
    || globalCabinet?.cabinetId
    || window.__ELISEI_CABINET_ID__
    || localStorage.getItem('elisei.activeCabinetId')
    || localStorage.getItem('elisei:active-cabinet-id')
    || '',
  ).trim();
}

function useEliseiCabinet() {
  const [cabinetId, setCabinetId] = useState(() => currentCabinetId());
  useEffect(() => {
    const handler = (event) => setCabinetId(String(event.detail?.id || event.detail?.cabinetId || currentCabinetId()).trim());
    window.addEventListener('elisei:cabinet-changed', handler);
    return () => window.removeEventListener('elisei:cabinet-changed', handler);
  }, []);
  return cabinetId;
}

function cabinetRequest(cabinetId, method = 'GET') {
  return {
    method,
    credentials: 'same-origin',
    headers: cabinetId ? { 'X-ELISEI-CABINET-ID': cabinetId } : {},
  };
}

function Delta({ metric, inverse = false }) {
  if (!metric || metric.deltaPercent === null || !Number.isFinite(Number(metric.deltaPercent))) return <span className="ads-delta neutral">нет базы</span>;
  const value = Number(metric.deltaPercent);
  const good = inverse ? value <= 0 : value >= 0;
  return <span className={`ads-delta ${good ? 'good' : 'bad'}`}>{value >= 0 ? '+' : ''}{value.toFixed(1)}%</span>;
}

function Kpi({ label, value, delta, inverse, hint }) {
  return <article className="ads-kpi"><div className="ads-kpi-label">{label}</div><div className="ads-kpi-value">{value}</div><div className="ads-kpi-foot"><Delta metric={delta} inverse={inverse}/><span>{hint}</span></div></article>;
}

function Trend({ rows, currency }) {
  const width = 860; const height = 210; const pad = 24;
  const max = Math.max(1, ...rows.flatMap((row) => [Number(row.revenue || 0), Number(row.spend || 0)]));
  const point = (row, index, key) => {
    const x = pad + (rows.length <= 1 ? 0 : index * ((width - pad * 2) / (rows.length - 1)));
    const y = height - pad - (Number(row[key] || 0) / max) * (height - pad * 2);
    return `${x},${y}`;
  };
  return <div className="ads-chart-card"><div className="ads-chart-head"><div><h3>Динамика рекламы</h3><p>Выручка и расход по дням</p></div><div className="ads-legend"><span className="revenue">Выручка</span><span className="spend">Расход</span></div></div>
    {rows.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График рекламной выручки и расходов">
      <polyline className="ads-line revenue" fill="none" points={rows.map((row, index) => point(row, index, 'revenue')).join(' ')}/>
      <polyline className="ads-line spend" fill="none" points={rows.map((row, index) => point(row, index, 'spend')).join(' ')}/>
    </svg> : <div className="ads-empty">Нет дневной статистики за выбранный период.</div>}
    <div className="ads-chart-caption">Максимум шкалы: {money(max, currency)}</div>
  </div>;
}

function Recommendation({ value }) {
  if (!value) return '—';
  return <span className={`ads-rec ${value.level || 'neutral'}`} title={value.text}>{value.title}</span>;
}

export default function AdvertisingPage() {
  const period = useEliseiPeriod();
  const cabinetId = useEliseiCabinet();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('products');
  const [search, setSearch] = useState('');

  const load = async (force = false) => {
    setError('');
    force ? setSyncing(true) : setLoading(true);
    try {
      const query = queryFor(period);
      const response = await fetch(`/api/ads/${force ? 'sync' : 'overview'}?${query}`, cabinetRequest(cabinetId, force ? 'POST' : 'GET'));
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось загрузить рекламу');
      setPayload(force ? { ok: true, cabinet: data.cabinet, period, data: data.data, comparison: null } : data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false); setSyncing(false);
    }
  };

  useEffect(() => { load(false); }, [cabinetId, period.from, period.to, period.compareFrom, period.compareTo, period.compareEnabled]);

  const data = payload?.data || {};
  const overall = data.overall || {};
  const comparison = payload?.comparison || {};
  const currency = data.currency || 'RUB';
  const rows = tab === 'products' ? (data.products || []) : (data.campaigns || []);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [row.nmId, row.advertId, row.vendorCode, row.title, row.name].some((value) => String(value || '').toLowerCase().includes(term)));
  }, [rows, search]);

  return <section className="elisei-ads">
    <header className="ads-header"><div><div className="ads-eyebrow">ELISEI · WB ПРОДВИЖЕНИЕ</div><h1>Рекламный центр</h1><p>{period.from} — {period.to}. Кабинет: {payload?.cabinet?.name || cabinetId || 'основной'}. Статистика связывается с товарами по nmID и входит в прибыль.</p></div>
      <button className="ads-sync" onClick={() => load(true)} disabled={syncing}>{syncing ? 'Синхронизация…' : 'Обновить из WB'}</button></header>

    {error && <div className="ads-alert"><b>Реклама пока не загрузилась.</b><span>{error}</span><small>Используется единый токен выбранного кабинета. Проверьте, что у него открыт доступ к категории «Продвижение».</small></div>}
    {loading && !payload ? <div className="ads-loading">Загружаю рекламную аналитику…</div> : <>
      <div className="ads-kpi-grid">
        <Kpi label="Расход" value={money(overall.spend, currency)} delta={comparison.spend} inverse hint="к прошлому периоду"/>
        <Kpi label="Рекламная выручка" value={money(overall.revenue, currency)} delta={comparison.revenue} hint="по заказам рекламы"/>
        <Kpi label="Заказы" value={compact(overall.orders)} delta={comparison.orders} hint={`кликов ${compact(overall.clicks)}`}/>
        <Kpi label="ДРР" value={percent(overall.drr)} delta={comparison.drr} inverse hint={`цель ${percent(overall.targetDrr)}`}/>
        <Kpi label="ROAS" value={overall.roas === null || overall.roas === undefined ? '—' : `${decimal(overall.roas)}×`} delta={comparison.roas} hint="выручка / расход"/>
        <Kpi label="Прибыль после рекламы" value={overall.adProfitKnown ? money(overall.adProfit, currency) : 'Нужны затраты'} delta={comparison.adProfit} hint="себестоимость + комиссия + логистика"/>
      </div>

      <div className="ads-main-grid"><Trend rows={data.daily || []} currency={currency}/><aside className="ads-el-card"><div className="ads-el-title"><span className="ads-el-orb">Эл</span><div><h3>Что делать сейчас</h3><p>Рекомендации строго за выбранный период</p></div></div>
        {(data.insights?.summary || []).map((line, index) => <p key={index} className="ads-el-summary">{line}</p>)}
        <div className="ads-action-list">{(data.insights?.actions || []).slice(0, 5).map((action) => <div className={`ads-action ${action.level}`} key={`${action.entity}-${action.id}`}><b>{action.label}</b><span>{action.title}</span><small>{action.text}</small></div>)}</div>
        {!(data.insights?.actions || []).length && <div className="ads-empty">После синхронизации Эл покажет, что отключить, улучшить или масштабировать.</div>}
      </aside></div>

      <div className="ads-table-card"><div className="ads-table-toolbar"><div className="ads-tabs"><button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>По товарам</button><button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}>По кампаниям</button></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по артикулу, nmID или кампании"/></div>
        <div className="ads-table-wrap"><table><thead><tr>{tab === 'products' ? <><th>Товар</th><th>Артикул продавца</th><th>nmID</th><th>Остаток</th></> : <><th>Кампания</th><th>Статус</th></>}<th>Расход</th><th>Выручка</th><th>Заказы</th><th>CTR</th><th>CPC</th><th>ДРР</th><th>ROAS</th>{tab === 'products' && <th>Прибыль</th>}<th>Действие</th></tr></thead>
          <tbody>{filtered.map((row) => <tr key={tab === 'products' ? row.nmId : row.advertId}>{tab === 'products' ? <><td><div className="ads-product"><div className="ads-thumb">{row.photo ? <img src={row.photo} alt=""/> : 'WB'}</div><span>{row.title || row.name || `Товар ${row.nmId}`}</span></div></td><td>{row.vendorCode || '—'}</td><td>{row.nmId}</td><td>{compact(row.stock)}</td></> : <><td><b>{row.name || `Кампания #${row.advertId}`}</b><small className="ads-id">ID {row.advertId}</small></td><td>{row.statusLabel}</td></>}<td>{money(row.spend, currency)}</td><td>{money(row.revenue, currency)}</td><td>{compact(row.orders)}</td><td>{percent(row.ctr, 2)}</td><td>{money(row.cpc, currency)}</td><td>{percent(row.drr)}</td><td>{row.roas === null ? '—' : `${decimal(row.roas)}×`}</td>{tab === 'products' && <td>{row.adProfitKnown ? money(row.adProfit, currency) : '—'}</td>}<td><Recommendation value={row.recommendation}/></td></tr>)}</tbody></table></div>
        {!filtered.length && <div className="ads-empty">По выбранному периоду данных нет.</div>}
      </div>
      <footer className="ads-footer">Последняя синхронизация: {data.syncedAt ? new Date(data.syncedAt).toLocaleString('ru-RU') : 'ещё не выполнялась'} · Управление ставками намеренно отключено: модуль сначала анализирует и рекомендует.</footer>
    </>}
  </section>;
}
