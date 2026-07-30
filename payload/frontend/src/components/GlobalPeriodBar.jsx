import { useMemo, useState } from 'react';
import { PERIOD_MODES, getPeriodLabel, setPeriod, shiftPeriod, useGlobalPeriod } from '../lib/periodStore.js';
import '../styles/elisei-period.css';

const modeOptions = [[PERIOD_MODES.DAY, 'День'], [PERIOD_MODES.WEEK, 'Неделя'], [PERIOD_MODES.MONTH, 'Месяц'], [PERIOD_MODES.CUSTOM, 'Период']];
const nativePickerType = (mode) => mode === PERIOD_MODES.MONTH ? 'month' : 'date';
const anchorValue = (period) => period.mode === PERIOD_MODES.MONTH ? period.anchor.slice(0, 7) : period.anchor;

export default function GlobalPeriodBar({ compact = false }) {
  const period = useGlobalPeriod();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(period.from);
  const [draftTo, setDraftTo] = useState(period.to);
  const label = useMemo(() => getPeriodLabel(period), [period]);

  const selectMode = (mode) => {
    if (mode === PERIOD_MODES.CUSTOM) {
      setDraftFrom(period.from);
      setDraftTo(period.to);
      setPeriod({ mode }, { refresh: false });
      setOpen(true);
      return;
    }
    setOpen(false);
    setPeriod({ mode, anchor: period.anchor });
  };

  const changeAnchor = (value) => {
    if (!value) return;
    setPeriod({ anchor: period.mode === PERIOD_MODES.MONTH ? `${value}-01` : value });
  };

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return;
    setPeriod({ mode: PERIOD_MODES.CUSTOM, from: draftFrom, to: draftTo, anchor: draftTo });
    setOpen(false);
  };

  return <section className={`elisei-period-bar ${compact ? 'is-compact' : ''}`} aria-label="Выбор периода аналитики">
    <div className="elisei-period-modes" role="tablist" aria-label="Тип периода">
      {modeOptions.map(([mode, text]) => <button key={mode} type="button" className={period.mode === mode ? 'is-active' : ''} onClick={() => selectMode(mode)}>{text}</button>)}
    </div>
    <div className="elisei-period-controls">
      <button type="button" className="period-arrow" onClick={() => shiftPeriod(-1)} aria-label="Предыдущий период">‹</button>
      {period.mode === PERIOD_MODES.CUSTOM
        ? <button type="button" className="period-value" onClick={() => setOpen((value) => !value)}>{label}</button>
        : <input className="period-native-input" type={nativePickerType(period.mode)} value={anchorValue(period)} onChange={(event) => changeAnchor(event.target.value)} aria-label="Дата периода" />}
      <button type="button" className="period-arrow" onClick={() => shiftPeriod(1)} aria-label="Следующий период">›</button>
    </div>
    <label className="elisei-period-compare"><input type="checkbox" checked={period.compareEnabled} onChange={(event) => setPeriod({ compareEnabled: event.target.checked })}/><span>Сравнить</span></label>
    <div className="elisei-period-summary"><strong>{period.from} — {period.to}</strong>{period.compareEnabled && <small>с {period.compareFrom} — {period.compareTo}</small>}</div>
    {open && period.mode === PERIOD_MODES.CUSTOM && <div className="elisei-period-popover">
      <label>С даты<input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label>
      <label>По дату<input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label>
      <div className="elisei-period-actions"><button type="button" onClick={() => setOpen(false)}>Отмена</button><button type="button" className="primary" onClick={applyCustom}>Применить</button></div>
    </div>}
  </section>;
}
