const DEFAULT_REPO = 'Study-Dump/OAIP-Battles-IEF';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const GROUP_PREFIX = '67810';
const TEAMS = [1, 2, 3, 4, 5];

const REASON_LABELS = {
  timeout: 'таймаут',
  runtime_error: 'ошибка выполнения',
  output_mismatch: 'неверный ответ',
  output_missing: 'нет output.txt',
  unexpected_stdout: 'лишний stdout',
  'missing input.txt or expected_output.txt': 'нет файлов теста',
};

const state = {
  scoreboard: null,
  history: { attacks: [] },
  selectedTarget: null,
};

const els = {
  select: document.getElementById('battle-select'),
  defense: document.getElementById('panel-defense'),
  matrix: document.getElementById('panel-matrix'),
  results: document.getElementById('panel-results'),
  history: document.getElementById('panel-history'),
  clear: document.getElementById('clear-btn'),
};

let repo = DEFAULT_REPO;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function groupLabel(number) {
  return `${GROUP_PREFIX}${number}`;
}

function teamLabel(team) {
  if (team == null || team === '') return '—';
  const value = String(team);
  return /^[1-5]$/.test(value) ? groupLabel(value) : value;
}

function repoUrl(path = '') {
  return `https://github.com/${repo}${path}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtMs(sec) {
  return Number.isFinite(sec) ? `${(sec * 1000).toFixed(sec < 1 ? 1 : 0)} мс` : '—';
}

function meanTime(tests) {
  const values = (tests || [])
    .map((test) => Number(test.time_sec))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function attackEntries() {
  return Array.isArray(state.history.attacks) ? state.history.attacks : [];
}

function hasRevisions(entry) {
  const solution = Number(entry.solution_rev ?? 0);
  const attacks = Object.values(entry.attacks_rev || {}).some(
    (value) => Number(value) > 0
  );
  return solution > 0 || attacks;
}

function revisionEntries() {
  return attackEntries()
    .filter((entry) => {
      const target = String(entry.target || '');
      return TEAMS.some((team) => String(team) === target) && hasRevisions(entry);
    })
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

function latestEntries() {
  const latest = {};
  attackEntries().forEach((entry) => {
    const target = String(entry.target || '');
    if (!TEAMS.some((team) => String(team) === target)) return;
    const current = latest[target];
    if (!current || String(entry.timestamp || '') >= String(current.timestamp || '')) {
      latest[target] = entry;
    }
  });
  return latest;
}

function availableTargets() {
  return Object.keys(latestEntries()).sort((a, b) => Number(a) - Number(b));
}

function selectedEntry() {
  const latest = latestEntries();
  return latest[state.selectedTarget] || latest[availableTargets()[0]] || null;
}

async function fetchJson(url, fallback, quiet = false) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (!quiet) console.warn(`Не удалось загрузить ${url}:`, error);
    return fallback;
  }
}

function emptyState(title, text, href) {
  const link = href
    ? `<a class="btn" href="${href}" target="_blank" rel="noopener">GitHub</a>`
    : '';
  const paragraph = text ? `<p>${text}</p>` : '';
  return `<div class="empty-state"><h3>${title}</h3>${paragraph}${link}</div>`;
}

function renderAll() {
  renderSelector();
  renderDefense();
  renderMatrix();
  renderResults();
  renderHistory();
}

function renderSelector() {
  const targets = availableTargets();
  els.select.disabled = targets.length === 0;

  if (!targets.length) {
    els.select.innerHTML = '<option>Нет защит</option>';
    return;
  }

  els.select.innerHTML = targets.map((target) => {
    const entry = latestEntries()[target];
    const defense = entry.defense || {};
    const status = defense.held ? 'выстоял' : 'пробит';
    return `<option value="${esc(target)}">${teamLabel(target)} · ${defense.passed ?? 0}/${defense.total ?? 0} · ${status}</option>`;
  }).join('');

  els.select.value = state.selectedTarget ?? targets[targets.length - 1];
}

function selectTarget(target) {
  if (!target) return;
  state.selectedTarget = String(target);
  window.history.replaceState(null, '', `#attack-${state.selectedTarget}`);
  els.select.value = state.selectedTarget;
  renderDefense();
}

function metric(label, value, note = '') {
  return `
    <article class="metric">
      <span class="metric-label">${esc(label)}</span>
      <strong class="metric-value">${esc(value)}</strong>
      ${note ? `<span class="metric-note">${esc(note)}</span>` : ''}
    </article>
  `;
}

function renderCode(text) {
  return text ? esc(text) : '<span class="empty">(пусто)</span>';
}

function renderFailure(test, target) {
  let reason = REASON_LABELS[test.reason] || test.reason || 'провал';
  if (test.reason === 'runtime_error' && test.exit_code != null) {
    reason += ` (код ${test.exit_code})`;
  }

  const stderr = test.stderr
    ? `<div class="pane"><h4>stderr</h4><pre class="bad">${esc(test.stderr)}</pre></div>`
    : '';
  const diff = test.diff
    ? `<p class="diff">Строка ${test.diff.first_diff_line}:
         <code>${esc(test.diff.actual_line || '(пусто)')}</code> вместо
         <code>${esc(test.diff.expected_line || '(пусто)')}</code></p>`
    : '';

  return `
    <details class="failure">
      <summary>
        <span class="failure-title"><span class="team-code">${esc(teamLabel(test.author))}</span> → ${esc(teamLabel(target))} · ${esc(test.name)}</span>
        <span class="meta">${esc(reason)} · время ${fmtMs(test.time_sec)}</span>
      </summary>
      <div class="failure-body">
        ${diff}
        <div class="panes">
          <div class="pane"><h4>Input</h4><pre>${renderCode(test.input)}</pre></div>
          <div class="pane"><h4>Output</h4><pre class="bad">${renderCode(test.actual_output)}</pre></div>
          <div class="pane"><h4>Expected</h4><pre class="good">${renderCode(test.expected_output)}</pre></div>
          ${stderr}
        </div>
      </div>
    </details>
  `;
}

function renderDefense() {
  const entry = selectedEntry();
  if (!entry) {
    els.defense.innerHTML = emptyState(
      'Защит пока нет',
      'Создайте ветку <code>attack-1</code> … <code>attack-5</code> и добавьте решение и атаки.',
      repoUrl('/branches')
    );
    return;
  }

  const target = String(entry.target);
  const defense = entry.defense || { passed: 0, total: 0, held: false };
  const attackers = Array.isArray(entry.attackers) ? entry.attackers : [];
  const attackRevs = Object.values(entry.attacks_rev || {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );
  const failures = [];
  attackers.forEach((attacker) => {
    (attacker.tests || [])
      .filter((test) => !test.skipped && !test.passed)
      .forEach((test) => failures.push({ ...test, target }));
  });

  const rows = attackers.map((attacker) => {
    const total = attacker.total ?? 0;
    const passed = attacker.passed ?? 0;
    const failed = attacker.failed ?? Math.max(0, total - passed);
    const statusClass = failed === 0 ? 'good' : 'bad';
    const status = failed === 0 ? 'выстоял' : 'пробил';
    return `
      <tr>
        <th scope="row">${esc(teamLabel(attacker.team))}</th>
        <td>${passed}/${total}</td>
        <td class="${statusClass}">${failed}</td>
        <td>${attacker.revision ?? 0}</td>
        <td class="time">${fmtMs(meanTime(attacker.tests))}</td>
        <td class="${statusClass}">${status}</td>
      </tr>
    `;
  }).join('');

  const failuresHtml = failures.length
    ? failures.map((test) => renderFailure(test, target)).join('')
    : emptyState('Провалов нет', 'Защита выдержала все атаки.');

  els.defense.innerHTML = `
    <div class="panel-head">
      <h2>${esc(teamLabel(target))}</h2>
      <p class="muted">${fmtDate(entry.timestamp)} · commit <code>${esc(String(entry.commit || '').slice(0, 7))}</code></p>
    </div>

    <div class="metric-grid">
      <article class="metric ${defense.held ? 'metric-win' : ''}">
        <span class="metric-label">Защита</span>
        <strong class="score"><b>${defense.passed ?? 0}</b><span>/${defense.total ?? 0}</span></strong>
        <span class="badge ${defense.held ? 'win' : ''}">${defense.held ? 'выстоял' : 'пробит'}</span>
      </article>
      ${metric('Ревизии решений', entry.solution_rev ?? 0, 'после старта')}
      ${metric('Ревизии атак', attackRevs, 'сумма по командам')}
      ${metric('Команд-атакующих', attackers.length)}
    </div>

    <div class="panel-head">
      <h2>Атаки <span class="count">${defense.total ?? 0}</span></h2>
    </div>
    <div class="table-wrap">
      <table class="matrix attack-table">
        <thead>
          <tr>
            <th scope="col">Атака</th>
            <th scope="col">Пройдено</th>
            <th scope="col">Провалено</th>
            <th scope="col">Ревизии</th>
            <th scope="col">Ср. время</th>
            <th scope="col">Итог</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="panel-head">
      <h2>Провалы <span class="count">${failures.length}</span></h2>
    </div>
    <div class="failures">${failuresHtml}</div>
  `;
}

function renderMatrix() {
  const latest = latestEntries();
  let rows = '';

  TEAMS.forEach((defender) => {
    rows += `<tr><th scope="row">${groupLabel(defender)}</th>`;
    TEAMS.forEach((attacker) => {
      const classes = ['cell'];
      if (defender === attacker) {
        classes.push('diag');
        rows += `<td class="${classes.join(' ')}">—</td>`;
        return;
      }
      const entry = latest[String(defender)];
      const attack = entry && (entry.attackers || []).find(
        (item) => String(item.team) === String(attacker)
      );
      if (!attack || !attack.total) {
        classes.push('no-data');
        rows += `<td class="${classes.join(' ')}">—</td>`;
        return;
      }
      const ratio = attack.passed / attack.total;
      classes.push(ratio >= 0.999 ? 'good' : ratio >= 0.5 ? 'mid' : 'bad');
      const avg = fmtMs(meanTime(attack.tests));
      rows += `<td class="${classes.join(' ')}" title="Пройдено ${attack.passed} из ${attack.total}; среднее время ${avg}"><span class="cell-score">${attack.passed}/${attack.total}</span><span class="cell-time">${avg}</span></td>`;
    });
    rows += '</tr>';
  });

  els.matrix.innerHTML = `
    <div class="panel-head">
      <h2>Краш-матрица</h2>
      <p class="muted">Итоговое место и победитель — во вкладке «Результаты».</p>
    </div>
    <div class="table-wrap">
      <table class="matrix">
        <thead>
          <tr>
            <th scope="col">Защита \\ Атака</th>
            ${TEAMS.map((team) => `<th scope="col">${groupLabel(team)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <ul class="legend">
      <li><span class="swatch good"></span> защита выдержала</li>
      <li><span class="swatch mid"></span> частично</li>
      <li><span class="swatch bad"></span> атака пробила</li>
    </ul>
  `;
}

function rankKey(team) {
  return [
    Number(team.total_points ?? 0),
    team.defense?.held ? 1 : 0,
    -Number(team.solution_rev ?? 0),
    Number(team.attack_revs ?? 0),
  ];
}

function rankedTeams() {
  const teams = Array.isArray(state.scoreboard?.teams) ? [...state.scoreboard.teams] : [];
  return teams.sort((a, b) => {
    const left = rankKey(a);
    const right = rankKey(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return right[i] - left[i];
    }
    return Number(a.team) - Number(b.team);
  });
}

function defenseTestsFor(team) {
  const entry = latestEntries()[String(team)];
  if (!entry) return [];
  return (entry.attackers || []).flatMap((attacker) => attacker.tests || []);
}

function teamRevisionHistory(team) {
  const id = String(team);
  const items = [];

  attackEntries().forEach((entry) => {
    const target = String(entry.target || '');
    const timestamp = entry.timestamp || '';

    if (target === id) {
      const revision = Number(entry.solution_rev ?? 0);
      if (revision > 0) {
        items.push({
          kind: 'solution',
          revision,
          timestamp,
          target,
          passed: entry.defense?.passed ?? 0,
          total: entry.defense?.total ?? 0,
        });
      }
      return;
    }

    const attacker = (entry.attackers || []).find(
      (item) => String(item.team) === id
    );
    const revision = Number(attacker?.revision ?? 0);
    if (attacker && revision > 0) {
      items.push({
        kind: 'attack',
        revision,
        timestamp,
        target,
        passed: attacker.passed ?? 0,
        failed: attacker.failed ?? 0,
        total: attacker.total ?? 0,
      });
    }
  });

  return items.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function revisionItem(item) {
  const solution = item.kind === 'solution';
  const label = solution ? 'решение' : 'атака';
  const result = solution
    ? `защита ${item.passed}/${item.total}`
    : `провалено ${item.failed}/${item.total}`;
  return `
    <li class="revision-item">
      <span class="revision-tag ${esc(item.kind)}">${label}</span>
      <span class="revision-main">${groupLabel(item.target)} · ревизия ${item.revision}</span>
      <span class="revision-meta">${fmtDate(item.timestamp)} · ${result}</span>
    </li>
  `;
}

function renderResults() {
  const board = state.scoreboard;
  const done = Object.keys(latestEntries()).length;

  if (!board || !board.complete) {
    const missing = TEAMS
      .filter((team) => !latestEntries()[String(team)])
      .map(teamLabel)
      .join(', ');
    const progress = Math.round((done / TEAMS.length) * 100);
    els.results.innerHTML = `
      <div class="results-wait">
        <span class="eyebrow">Итоги</span>
        <h2>Ждём все батлы</h2>
        <p>Результаты появятся, когда все команды проведут свои защиты.</p>
        <div class="results-progress">
          <div class="results-progress-head">
            <span>${done} из ${TEAMS.length} защит</span>
            <strong>${progress}%</strong>
          </div>
          <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${TEAMS.length}" aria-valuenow="${done}">
            <span style="width: ${progress}%"></span>
          </div>
        </div>
        <p class="muted">${missing ? `Осталось: ${esc(missing)}.` : 'Все защиты уже провели батлы.'}</p>
      </div>
    `;
    return;
  }

  const teams = rankedTeams();
  const winner = board.winner ? String(board.winner) : null;
  const cards = teams.map((team, index) => {
    const defense = team.defense || {};
    const solutionRev = Number(team.solution_rev ?? 0);
    const attackRevs = Number(team.attack_revs ?? 0);
    const revisions = solutionRev + attackRevs;
    const history = teamRevisionHistory(team.team);
    const isWinner = winner === String(team.team);
    const status = defense.held ? 'защита выстояла' : 'защита пробита';
    return `
      <article class="result-card ${isWinner ? 'winner' : ''}">
        <div class="result-top">
          <span class="result-place">${String(index + 1).padStart(2, '0')}</span>
          <div class="result-title">
            <h3>${esc(teamLabel(team.team))}</h3>
            <span class="badge ${defense.held ? 'win' : ''}">${status}</span>
          </div>
          <div class="result-points">
            <strong>${team.total_points ?? 0}</strong>
            <span>очков</span>
          </div>
        </div>
        <div class="result-stats">
          <div>
            <span>Держал тестов</span>
            <strong>${defense.passed ?? 0}/${defense.total ?? 0}</strong>
          </div>
          <div>
            <span>Ср. время</span>
            <strong>${fmtMs(meanTime(defenseTestsFor(team.team)))}</strong>
          </div>
          <div>
            <span>Всего ревизий</span>
            <strong>${revisions}</strong>
            <small>решение ${solutionRev} · атаки ${attackRevs}</small>
          </div>
          <div>
            <span>Атаки</span>
            <strong>${team.attack_points ?? 0}/${team.attack_total ?? 0}</strong>
            <small>тестов пробито</small>
          </div>
        </div>
        <details class="revision-log">
          <summary>История ревизий <span class="count">${history.length}</span></summary>
          ${history.length
            ? `<ul class="revision-list">${history.map(revisionItem).join('')}</ul>`
            : '<p class="muted">Ревизий после старта пока нет.</p>'}
        </details>
        <div class="result-actions">
          <button type="button" class="btn" data-open="${esc(team.team)}">Открыть защиту</button>
        </div>
      </article>
    `;
  }).join('');

  els.results.innerHTML = `
    <div class="panel-head results-head">
      <div>
        <span class="eyebrow">Итоги</span>
        <h2>Результаты</h2>
      </div>
      <p class="muted">${winner ? `Победитель · ${esc(teamLabel(winner))}` : 'Победитель не определён'}</p>
    </div>
    ${winner ? '' : '<p class="results-tie">Основные показатели лидеров совпали — ничья.</p>'}
    <div class="results-grid">${cards}</div>
  `;
}

function renderHistory() {
  const all = revisionEntries();
  if (!all.length) {
    els.history.innerHTML = emptyState(
      'Ревизий пока нет',
      'Показаны только ревизии после старта батлов.'
    );
    return;
  }

  const rows = all.map((entry) => {
    const target = String(entry.target);
    const defense = entry.defense || {};
    const status = defense.held ? 'выстоял' : 'пробит';
    const attackRevs = Object.values(entry.attacks_rev || {}).reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );
    return `
      <article class="history-row">
        <div class="history-main">
          <strong>attack-${esc(target)}</strong>
          <span class="muted">${fmtDate(entry.timestamp)}</span>
          <span class="muted">${esc(teamLabel(target))}: ${defense.passed ?? 0}/${defense.total ?? 0} · ${status}</span>
          <span class="muted">commit ${esc(String(entry.commit || '').slice(0, 7))} · решение ${entry.solution_rev ?? 0} · атаки ${attackRevs}</span>
        </div>
        <div class="history-side">
          <span class="badge ${defense.held ? 'win' : ''}">${status}</span>
          <button type="button" class="btn" data-open="${esc(target)}">Открыть</button>
        </div>
      </article>
    `;
  }).join('');

  els.history.innerHTML = `
    <div class="panel-head">
      <h2>История ревизий <span class="count">${all.length}</span></h2>
    </div>
    <div class="history-list">${rows}</div>
  `;
}

function setTab(name) {
  document.querySelectorAll('.tabs .tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${name}`);
  });
}

async function load() {
  const [scoreboard, historyData, repoData] = await Promise.all([
    fetchJson('scoreboard.json', null, true),
    fetchJson('history.json', { attacks: [] }),
    fetchJson('repo.json', null, true),
  ]);

  if (repoData && REPO_PATTERN.test(repoData.repository || '')) {
    repo = repoData.repository;
    const repoLink = document.getElementById('repo-link');
    if (repoLink) repoLink.href = repoUrl();
  }

  state.scoreboard = scoreboard;
  state.history = historyData && Array.isArray(historyData.attacks)
    ? historyData
    : { attacks: [] };

  const targets = availableTargets();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const hashTarget = fromHash.match(/^attack-([1-5])$/)?.[1];
  const latest = latestEntries();
  const defaultTarget = targets.includes(hashTarget)
    ? hashTarget
    : targets[targets.length - 1] || null;

  state.selectedTarget = defaultTarget;
  if (defaultTarget) {
    window.history.replaceState(null, '', `#attack-${defaultTarget}`);
  }

  renderAll();
}

els.select.addEventListener('change', (event) => selectTarget(event.target.value));
els.clear.addEventListener('click', () => {
  const ok = window.confirm(
    'Очистить историю? Откроется workflow в GitHub — нажмите «Run workflow».'
  );
  if (ok) {
    window.open(repoUrl('/actions/workflows/clear-history.yml'), '_blank', 'noopener');
  }
});

document.querySelectorAll('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => setTab(tab.dataset.tab));
});

els.results.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open]');
  if (!button) return;
  selectTarget(button.dataset.open);
  setTab('defense');
});

els.history.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open]');
  if (!button) return;
  selectTarget(button.dataset.open);
  setTab('defense');
});

window.addEventListener('hashchange', () => {
  const target = decodeURIComponent(location.hash.slice(1)).match(/^attack-([1-5])$/)?.[1];
  if (target && latestEntries()[target]) {
    state.selectedTarget = target;
    els.select.value = target;
    renderDefense();
  }
});

load();
