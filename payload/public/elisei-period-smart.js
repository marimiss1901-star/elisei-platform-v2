(function () {
  'use strict';

  var VERSION = '5.3.18';
  var KEY = 'elisei.globalPeriod.v3';
  var SECTION_KEY = 'elisei.currentSection';
  var DAY = 86400000;
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var MONTHS_LONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var DATE_SECTIONS = ['Главная', 'Аналитика', 'Финансы', 'Цены и акции', 'Реклама', 'Отзывы', 'Сезонность', 'Отчёты', 'AI CRM', 'Спросить Эла'];
  var HIDDEN_SECTIONS = ['Товары', 'Подключения', 'Импорт данных'];
  var STOCK_SECTION = 'Остатки';

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { var x = new Date(d); var day = x.getDay() || 7; x.setDate(x.getDate() - day + 1); return x; }
  function endOfWeek(d) { return addDays(startOfWeek(d), 6); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 12); }
  function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12); }
  function daysBetween(from, to) { return Math.max(1, Math.round((to - from) / DAY) + 1); }

  function previousRange(from, to) {
    var f = parse(from), t = parse(to), len = daysBetween(f, t);
    var compareTo = addDays(f, -1);
    var compareFrom = addDays(compareTo, -len + 1);
    return { compareFrom: iso(compareFrom), compareTo: iso(compareTo) };
  }

  function normalize(input) {
    var now = new Date();
    var value = input || {};
    var mode = ['day', 'week', 'month', 'custom'].indexOf(value.mode) >= 0 ? value.mode : 'week';
    var anchor = parse(value.anchor) || now;
    var from, to;

    if (mode === 'day') {
      from = to = anchor;
    } else if (mode === 'week') {
      from = startOfWeek(anchor);
      to = endOfWeek(anchor);
    } else if (mode === 'month') {
      from = startOfMonth(anchor);
      to = endOfMonth(anchor);
    } else {
      from = parse(value.from) || anchor;
      to = parse(value.to) || from;
      if (from > to) { var swap = from; from = to; to = swap; }
    }

    var result = {
      mode: mode,
      anchor: iso(anchor),
      from: iso(from),
      to: iso(to),
      compareEnabled: value.compareEnabled === true,
      revision: Number(value.revision || 0),
      updatedAt: new Date().toISOString()
    };
    var comparison = previousRange(result.from, result.to);
    result.compareFrom = comparison.compareFrom;
    result.compareTo = comparison.compareTo;
    return result;
  }

  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (error) { return normalize(); }
  }

  var state = load();
  var currentSection = sessionStorage.getItem(SECTION_KEY) || 'Главная';

  function persist(changed) {
    if (changed) state.revision += 1;
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(state));
    window.__ELISEI_PERIOD__ = Object.assign({}, state);
    window.__ELISEI_PERIOD_VERSION__ = VERSION;
  }

  function isApi(value) { return /\/api\//i.test(String(value || '')); }

  function appendPeriod(url) {
    var aliases = {
      date_from: state.from,
      date_to: state.to,
      from: state.from,
      to: state.to,
      startDate: state.from,
      endDate: state.to,
      period_from: state.from,
      period_to: state.to,
      period_mode: state.mode,
      compare: state.compareEnabled ? '1' : '0',
      _period_revision: String(state.revision)
    };
    if (state.compareEnabled) {
      aliases.compare_from = state.compareFrom;
      aliases.compare_to = state.compareTo;
    }
    Object.keys(aliases).forEach(function (name) { url.searchParams.set(name, aliases[name]); });
    return url;
  }

  function periodHeaders(initial) {
    var result = new Headers(initial || {});
    result.set('X-ELISEI-Date-From', state.from);
    result.set('X-ELISEI-Date-To', state.to);
    result.set('X-ELISEI-Period-Mode', state.mode);
    result.set('X-ELISEI-Compare', state.compareEnabled ? '1' : '0');
    result.set('X-ELISEI-Period-Revision', String(state.revision));
    if (state.compareEnabled) {
      result.set('X-ELISEI-Compare-From', state.compareFrom);
      result.set('X-ELISEI-Compare-To', state.compareTo);
    }
    return result;
  }

  function installTransport() {
    if (window.__ELISEI_PERIOD_SMART_TRANSPORT__) return;
    window.__ELISEI_PERIOD_SMART_TRANSPORT__ = true;

    var originalFetch = window.fetch && window.fetch.bind(window);
    if (originalFetch) {
      window.fetch = function (input, init) {
        init = init || {};
        var raw = typeof input === 'string' ? input : input && input.url;
        if (!raw || !isApi(raw)) return originalFetch(input, init);
        var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
        var target = raw;
        if (method === 'GET' || method === 'HEAD') {
          var url = new URL(raw, location.origin);
          appendPeriod(url);
          target = /^https?:/i.test(raw) ? url.toString() : url.pathname + url.search + url.hash;
        }
        var nextInit = Object.assign({}, init, {
          headers: periodHeaders(init.headers || (input && input.headers)),
          cache: 'no-store'
        });
        if (typeof Request !== 'undefined' && input instanceof Request) {
          return originalFetch(new Request(target, input), nextInit);
        }
        return originalFetch(target, nextInit);
      };
    }

    if (window.XMLHttpRequest) {
      var originalOpen = XMLHttpRequest.prototype.open;
      var originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        var rest = Array.prototype.slice.call(arguments, 2);
        var verb = String(method || 'GET').toUpperCase();
        var target = url;
        this.__eliseiPeriodApi = isApi(url);
        if (this.__eliseiPeriodApi && (verb === 'GET' || verb === 'HEAD')) {
          var parsedUrl = new URL(url, location.origin);
          appendPeriod(parsedUrl);
          target = /^https?:/i.test(String(url)) ? parsedUrl.toString() : parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
        }
        return originalOpen.apply(this, [method, target].concat(rest));
      };
      XMLHttpRequest.prototype.send = function (body) {
        if (this.__eliseiPeriodApi) {
          try {
            var h = periodHeaders();
            h.forEach(function (value, name) { this.setRequestHeader(name, value); }, this);
          } catch (error) { /* no-op */ }
        }
        return originalSend.call(this, body);
      };
    }
  }

  function dateLabelShort(value) {
    var d = parse(value);
    return d ? d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] : value;
  }

  function rangeLabel() {
    if (state.from === state.to) {
      var d = parse(state.from);
      return d ? d.getDate() + ' ' + MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear() : state.from;
    }
    var from = parse(state.from), to = parse(state.to);
    if (!from || !to) return state.from + ' — ' + state.to;
    if (from.getFullYear() === to.getFullYear()) {
      if (from.getMonth() === to.getMonth()) {
        return from.getDate() + '–' + to.getDate() + ' ' + MONTHS_SHORT[to.getMonth()] + ' ' + to.getFullYear();
      }
      return dateLabelShort(state.from) + ' — ' + dateLabelShort(state.to) + ' ' + to.getFullYear();
    }
    return dateLabelShort(state.from) + ' ' + from.getFullYear() + ' — ' + dateLabelShort(state.to) + ' ' + to.getFullYear();
  }

  function modeLabel() {
    if (currentSection === STOCK_SECTION) return 'Остатки на дату';
    return { day: 'День', week: 'Неделя', month: 'Месяц', custom: 'Период' }[state.mode] || 'Период';
  }

  function updateAddressBar() {
    try {
      var url = new URL(location.href);
      url.searchParams.set('date_from', state.from);
      url.searchParams.set('date_to', state.to);
      url.searchParams.set('period_mode', state.mode);
      url.searchParams.set('compare', state.compareEnabled ? '1' : '0');
      url.searchParams.set('_period_revision', String(state.revision));
      if (state.compareEnabled) {
        url.searchParams.set('compare_from', state.compareFrom);
        url.searchParams.set('compare_to', state.compareTo);
      } else {
        url.searchParams.delete('compare_from');
        url.searchParams.delete('compare_to');
      }
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch (error) { /* no-op */ }
  }

  function findSectionControl(section) {
    var controls = document.querySelectorAll('a,button,[role="button"]');
    for (var i = 0; i < controls.length; i += 1) {
      var control = controls[i];
      if (control.closest && control.closest('#elisei-period-smart-host')) continue;
      var text = String(control.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === section || text.indexOf(section) === 0) return control;
    }
    return null;
  }

  function softRefreshCurrentSection() {
    updateAddressBar();

    try {
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    } catch (error) {
      window.dispatchEvent(new Event('popstate'));
    }

    var control = findSectionControl(currentSection);
    if (control) {
      control.dispatchEvent(new CustomEvent('elisei:period-refresh-section', {
        bubbles: true,
        detail: Object.assign({ section: currentSection }, state)
      }));
    }

    document.documentElement.setAttribute('data-elisei-period-revision', String(state.revision));
  }

  function setState(patch) {
    var before = JSON.stringify(state);
    state = normalize(Object.assign({}, state, patch));
    var changed = before !== JSON.stringify(state);
    persist(changed);
    updatePageLabels();
    render();
    window.dispatchEvent(new CustomEvent('elisei:period-changed', { detail: Object.assign({}, state) }));
    window.dispatchEvent(new CustomEvent('elisei:data-refresh', { detail: Object.assign({}, state) }));
    if (changed) {
      showToast('Период применён: ' + rangeLabel());
      softRefreshCurrentSection();
    }
  }

  function shift(direction) {
    var anchor = parse(state.anchor) || new Date();
    if (currentSection === STOCK_SECTION || state.mode === 'day') {
      anchor = addDays(anchor, direction);
      return setState({ mode: 'day', anchor: iso(anchor) });
    }
    if (state.mode === 'week') anchor = addDays(anchor, 7 * direction);
    else if (state.mode === 'month') anchor = new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1, 12);
    else {
      var from = parse(state.from), to = parse(state.to), len = daysBetween(from, to);
      return setState({ from: iso(addDays(from, len * direction)), to: iso(addDays(to, len * direction)), anchor: iso(addDays(to, len * direction)) });
    }
    setState({ anchor: iso(anchor) });
  }

  function applyPreset(name) {
    var today = new Date();
    var patch;
    if (name === 'today') patch = { mode: 'day', anchor: iso(today) };
    else if (name === 'yesterday') patch = { mode: 'day', anchor: iso(addDays(today, -1)) };
    else if (name === 'last7') patch = { mode: 'custom', from: iso(addDays(today, -6)), to: iso(today), anchor: iso(today) };
    else if (name === 'last30') patch = { mode: 'custom', from: iso(addDays(today, -29)), to: iso(today), anchor: iso(today) };
    else if (name === 'thisWeek') patch = { mode: 'week', anchor: iso(today) };
    else if (name === 'prevWeek') patch = { mode: 'week', anchor: iso(addDays(today, -7)) };
    else if (name === 'thisMonth') patch = { mode: 'month', anchor: iso(today) };
    else if (name === 'prevMonth') patch = { mode: 'month', anchor: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1, 12)) };
    if (patch) setState(patch);
  }

  function showToast(text) {
    var old = document.getElementById('elisei-period-toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.id = 'elisei-period-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('show'); });
  }

  function sectionFromTarget(target) {
    var element = target && target.closest ? target.closest('a,button,[role="button"]') : null;
    if (!element) return null;
    var text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    var all = DATE_SECTIONS.concat(HIDDEN_SECTIONS, [STOCK_SECTION]);
    for (var i = 0; i < all.length; i += 1) {
      if (text === all[i] || text.indexOf(all[i]) === 0) return all[i];
    }
    return null;
  }

  function isVisibleForSection() {
    return HIDDEN_SECTIONS.indexOf(currentSection) < 0;
  }

  function trackSections() {
    document.addEventListener('click', function (event) {
      var next = sectionFromTarget(event.target);
      if (!next || next === currentSection) return;
      currentSection = next;
      sessionStorage.setItem(SECTION_KEY, currentSection);
      setTimeout(function () { render(); updatePageLabels(); }, 0);
    }, true);
  }

  function replacePeriodText(text) {
    var label = rangeLabel();
    return text
      .replace(/выручка\s*[·•-]\s*30\s*дн(?:ей|я)/ig, 'Выручка · ' + label)
      .replace(/выручка\s*[·•-]\s*7\s*дн(?:ей|я)/ig, 'Выручка · ' + label)
      .replace(/за\s+последние\s+30\s+дн(?:ей|я)/ig, 'за ' + label)
      .replace(/за\s+30\s+дн(?:ей|я)/ig, 'за ' + label)
      .replace(/за\s+7\s+дн(?:ей|я)/ig, 'за ' + label);
  }

  function updatePageLabels() {
    var selector = 'h1,h2,h3,h4,h5,h6,span,p,div';
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest && node.closest('#elisei-period-smart-host')) continue;
      if (node.children && node.children.length > 0) continue;
      var text = String(node.textContent || '').trim();
      if (!text || text.length > 90) continue;
      var next = replacePeriodText(text);
      if (next !== text) node.textContent = next;
    }
    document.documentElement.setAttribute('data-elisei-period-label', rangeLabel());
    document.documentElement.setAttribute('data-elisei-period-section', currentSection);
  }

  function closePopover() {
    var popover = document.querySelector('#elisei-period-smart-host .eps-popover');
    if (popover) popover.classList.remove('open');
  }

  function render() {
    var host = document.getElementById('elisei-period-smart-host');
    if (!host) return;
    host.style.display = isVisibleForSection() ? 'block' : 'none';
    if (!isVisibleForSection()) return;

    var stockMode = currentSection === STOCK_SECTION;
    var comparisonText = state.compareEnabled ? ('с ' + dateLabelShort(state.compareFrom) + ' — ' + dateLabelShort(state.compareTo)) : 'Без сравнения';
    host.innerHTML = '' +
      '<div class="eps-toolbar" data-version="' + VERSION + '">' +
        '<button class="eps-arrow" type="button" data-shift="-1" aria-label="Предыдущий период">‹</button>' +
        '<button class="eps-main" type="button" data-toggle="popover">' +
          '<span class="eps-main-icon">◷</span>' +
          '<span class="eps-main-copy"><small>' + modeLabel() + '</small><strong>' + (stockMode ? dateLabelShort(state.to) : rangeLabel()) + '</strong></span>' +
          '<span class="eps-caret">⌄</span>' +
        '</button>' +
        '<button class="eps-arrow" type="button" data-shift="1" aria-label="Следующий период">›</button>' +
        (!stockMode ? '<button class="eps-compare ' + (state.compareEnabled ? 'active' : '') + '" type="button" data-compare="1"><span class="eps-compare-dot"></span><span>' + comparisonText + '</span></button>' : '') +
        '<div class="eps-popover">' +
          '<div class="eps-popover-head"><div><small>Период аналитики</small><strong>' + rangeLabel() + '</strong></div><span>v' + VERSION + '</span></div>' +
          (stockMode ?
            '<div class="eps-stock-date"><label>Остатки на дату<input type="date" data-stock-date value="' + state.to + '"></label><button type="button" data-apply-stock>Применить</button></div>' :
            '<div class="eps-presets">' +
              '<button type="button" data-preset="today">Сегодня</button>' +
              '<button type="button" data-preset="yesterday">Вчера</button>' +
              '<button type="button" data-preset="last7">Последние 7 дней</button>' +
              '<button type="button" data-preset="last30">Последние 30 дней</button>' +
              '<button type="button" data-preset="thisWeek">Текущая неделя</button>' +
              '<button type="button" data-preset="prevWeek">Прошлая неделя</button>' +
              '<button type="button" data-preset="thisMonth">Текущий месяц</button>' +
              '<button type="button" data-preset="prevMonth">Прошлый месяц</button>' +
            '</div>' +
            '<div class="eps-custom"><label>С даты<input type="date" data-from value="' + state.from + '"></label><label>По дату<input type="date" data-to value="' + state.to + '"></label><button type="button" data-apply-custom>Применить</button></div>' +
            '<label class="eps-compare-switch"><input type="checkbox" data-compare-checkbox ' + (state.compareEnabled ? 'checked' : '') + '><span><strong>Сравнить с предыдущим периодом</strong><small>' + dateLabelShort(state.compareFrom) + ' — ' + dateLabelShort(state.compareTo) + '</small></span></label>') +
        '</div>' +
      '</div>';

    host.querySelectorAll('[data-shift]').forEach(function (button) {
      button.onclick = function () { shift(Number(button.getAttribute('data-shift'))); };
    });
    host.querySelector('[data-toggle="popover"]').onclick = function () {
      host.querySelector('.eps-popover').classList.toggle('open');
    };
    host.querySelectorAll('[data-preset]').forEach(function (button) {
      button.onclick = function () { applyPreset(button.getAttribute('data-preset')); };
    });
    var compareButton = host.querySelector('[data-compare]');
    if (compareButton) compareButton.onclick = function () { setState({ compareEnabled: !state.compareEnabled }); };
    var compareCheckbox = host.querySelector('[data-compare-checkbox]');
    if (compareCheckbox) compareCheckbox.onchange = function (event) { setState({ compareEnabled: event.target.checked }); };
    var applyCustom = host.querySelector('[data-apply-custom]');
    if (applyCustom) applyCustom.onclick = function () {
      var from = host.querySelector('[data-from]').value;
      var to = host.querySelector('[data-to]').value;
      if (from && to) setState({ mode: 'custom', from: from, to: to, anchor: to });
    };
    var applyStock = host.querySelector('[data-apply-stock]');
    if (applyStock) applyStock.onclick = function () {
      var date = host.querySelector('[data-stock-date]').value;
      if (date) setState({ mode: 'day', anchor: date, compareEnabled: false });
    };
  }

  function restoreStoredSection() {
    if (!currentSection || currentSection === 'Главная') return;
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      var control = findSectionControl(currentSection);
      if (control) {
        clearInterval(timer);
        var active = control.getAttribute('aria-current') === 'page' ||
          control.classList.contains('active') ||
          control.classList.contains('selected');
        if (!active) control.click();
      } else if (attempts >= 20) {
        clearInterval(timer);
      }
    }, 150);
  }

  function mount() {
    var oldHosts = document.querySelectorAll('#elisei-period-hardfix-host,#elisei-period-visible-root,#elisei-period-runtime-root');
    oldHosts.forEach(function (node) { node.remove(); });
    if (document.getElementById('elisei-period-smart-host')) return;
    var host = document.createElement('div');
    host.id = 'elisei-period-smart-host';
    host.setAttribute('data-elisei-period-smart', VERSION);
    document.body.appendChild(host);
    render();
    updatePageLabels();

    document.addEventListener('click', function (event) {
      if (!host.contains(event.target)) closePopover();
    });

    var observer = new MutationObserver(function () {
      updatePageLabels();
    });
    observer.observe(document.body, { subtree: true, childList: true });
    restoreStoredSection();
  }

  installTransport();
  persist(false);
  trackSections();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  console.info('[ELISEI] Smart period toolbar ' + VERSION + ' loaded', state);
})();
