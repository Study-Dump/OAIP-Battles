const DEFAULT_CONFIG = {
  title: 'OAIP Battles',
  repository: 'Study-Dump/OAIP-Battles',
  teams: ['1', '2', '3', '4', '5'],
};
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
let TEAMS = [];
let TEAM_LABELS = new Map();
let TEAM_ORDER = new Map();
let repo = DEFAULT_CONFIG.repository;

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
  selectedEntryId: null,
};

const els = {
  select: document.getElementById('battle-select'),
  defense: document.getElementById('panel-defense'),
  matrix: document.getElementById('panel-matrix'),
  results: document.getElementById('panel-results'),
  history: document.getElementById('panel-history'),
  clear: document.getElementById('clear-btn'),
};

function normalizeTeams(raw) {
  const items = Array.isArray(raw) && raw.length ? raw : DEFAULT_CONFIG.teams;
  return items.map((item, index) => {
    if (item == null || typeof item !== 'object') {
      const value = String(item ?? index + 1);
      return { id: value, group: value };
    }
    const id = String(item.id ?? item.team ?? index + 1);
    return { id, group: String(item.group ?? item.label ?? id) };
  });
}

function applyConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const teams = normalizeTeams(source.teams);
  TEAMS = teams.map((team) => team.id);
  TEAM_LABELS = new Map(teams.map((team) => [team.id, team.group]));
  TEAM_ORDER = new Map(TEAMS.map((team, index) => [team, index]));
  if (REPO_PATTERN.test(String(source.repository || ''))) {
    repo = String(source.repository);
  }
  const title = String(source.title || DEFAULT_CONFIG.title);
  document.title = title;
  const heading = document.querySelector('.brand h1');
  if (heading) heading.textContent = title;
  const repoLink = document.getElementById('repo-link');
  if (repoLink) repoLink.href = repoUrl();
}

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
  return teamLabel(number);
}

function teamLabel(team) {
  if (team == null || team === '') return '—';
  const value = String(team);
  return TEAM_LABELS.get(value) || value;
}

function teamIndex(team) {
  return TEAM_ORDER.has(String(team)) ? TEAM_ORDER.get(String(team)) : TEAMS.length;
}

function repoUrl(path = '') {
  return `https://github.com/${repo}${path}`;
}

function attackEntries() {
  return Array.isArray(state.history.attacks) ? state.history.attacks : [];
}

function revisionCount(entry) {
  const solution = Number(entry.solution_rev ?? 0);
  const attacks = (entry.attackers || []).reduce(
    (sum, attacker) => sum + Number(attacker.revision ?? 0),
    0
  );
  return solution + attacks;
}

function battleEntries() {
  return attackEntries()
    .filter((entry) => {
      const target = String(entry.target || '');
      return TEAMS.some((team) => String(team) === target);
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
  return Object.keys(latestEntries()).sort(
    (a, b) => teamIndex(a) - teamIndex(b) || a.localeCompare(b)
  );
}

function selectedEntry() {
  if (state.selectedEntryId) {
    const selected = attackEntries().find((entry) => entry.id === state.selectedEntryId);
    if (selected) return selected;
  }
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

  const latest = latestEntries();
  els.select.innerHTML = targets.map((target) => {
    const entry = latest[target];
    const defense = entry.defense || {};
    const status = defense.held ? 'выстояла' : 'пробита';
    const attempts = Number(entry.solution_rev ?? 0);
    return `<option value="${esc(target)}">${teamLabel(target)} · ${defense.passed ?? 0}/${defense.total ?? 0} · ${status} · попыток решения ${attempts + 1}</option>`;
  }).join('');

  els.select.value = state.selectedTarget ?? targets[targets.length - 1];
}

function selectTarget(target) {
  if (!target) return;
  state.selectedTarget = String(target);
  state.selectedEntryId = null;
  window.history.replaceState(null, '', `#attack-${state.selectedTarget}`);
  els.select.value = state.selectedTarget;
  renderDefense();
}

function selectBattle(id) {
  const entry = attackEntries().find((item) => item.id === id);
  if (!entry) return;
  state.selectedTarget = String(entry.target);
  state.selectedEntryId = id;
  window.history.replaceState(null, '', `#battle-${id}`);
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

function attemptName(revision) {
  return `попытка ${Number(revision ?? 0) + 1}`;
}

function attackerHistory(target, team) {
  return attackEntries()
    .filter((entry) => String(entry.target) === String(target))
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
    .map((entry) => {
      const attacker = (entry.attackers || []).find(
        (item) => String(item.team) === String(team)
      );
      return attacker ? { entry, attacker } : null;
    })
    .filter(Boolean);
}

function testsUpTo(target, team, selected) {
  const history = attackerHistory(target, team);
  const selectedAt = String(selected?.timestamp || '');
  if (!selectedAt) return history;
  return history.filter(({ entry }) => String(entry.timestamp || '') <= selectedAt);
}

function testMap(attacker) {
  const map = new Map();
  (attacker?.tests || []).forEach((test) => {
    map.set(test.path || test.name || '(без имени)', test);
  });
  return map;
}

function defenseTestMap(entry) {
  const map = new Map();
  (entry?.attackers || []).forEach((attacker) => {
    (attacker.tests || []).forEach((test) => {
      map.set(test.path || test.name || '(без имени)', {
        ...test,
        author: attacker.team,
      });
    });
  });
  return map;
}

function solutionDiffs(target) {
  const entries = attackEntries()
    .filter((entry) => String(entry.target) === String(target))
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  const byRevision = new Map();

  entries.forEach((entry) => {
    const revision = Number(entry.solution_rev ?? 0);
    const current = byRevision.get(revision);
    if (!current || String(entry.timestamp || '') >= String(current.timestamp || '')) {
      byRevision.set(revision, entry);
    }
  });

  const revisions = [...byRevision.keys()].sort((a, b) => a - b);
  const diffs = [];

  for (let index = 1; index < revisions.length; index += 1) {
    const from = revisions[index - 1];
    const to = revisions[index];
    const beforeEntry = byRevision.get(from);
    const afterEntry = byRevision.get(to);
    const before = defenseTestMap(beforeEntry);
    const after = defenseTestMap(afterEntry);
    const changes = [];

    after.forEach((test, path) => {
      const old = before.get(path);
      if (!old) {
        changes.push({ type: 'added', path, before: null, after: test });
        return;
      }
      if (Boolean(old.passed) !== Boolean(test.passed)) {
        changes.push({ type: 'changed', path, before: old, after: test });
      }
    });

    before.forEach((test, path) => {
      if (!after.has(path)) {
        changes.push({ type: 'removed', path, before: test, after: null });
      }
    });

    changes.sort((a, b) => a.path.localeCompare(b.path));
    diffs.push({
      from,
      to,
      changes,
      beforeDefense: beforeEntry?.defense || { passed: 0, total: 0 },
      afterDefense: afterEntry?.defense || { passed: 0, total: 0 },
    });
  }

  return diffs;
}

function outcomeBadge(test) {
  return test?.passed
    ? '<span class="outcome pass">пройден</span>'
    : '<span class="outcome fail">провал</span>';
}

function renderSolutionChange(change) {
  if (change.type === 'added') {
    return `
      <li>
        <code>${esc(change.path)}</code>
        <span class="muted">добавлен</span>
        ${outcomeBadge(change.after)}
      </li>
    `;
  }
  if (change.type === 'removed') {
    return `
      <li>
        <code>${esc(change.path)}</code>
        ${outcomeBadge(change.before)}
        <span class="muted">убран</span>
      </li>
    `;
  }
  return `
    <li>
      <code>${esc(change.path)}</code>
      ${outcomeBadge(change.before)}
      <span class="muted">→</span>
      ${outcomeBadge(change.after)}
    </li>
  `;
}

function renderSolutionDiffs(target, compact = false) {
  const diffs = solutionDiffs(target);
  if (!diffs.length) return '';
  const changeCount = diffs.reduce((sum, diff) => sum + diff.changes.length, 0);

  return `
    <details class="solution-revisions${compact ? ' compact' : ''}">
      <summary>Изменения решения <span class="count">${changeCount}</span></summary>
      <div class="solution-diff-list">
        ${diffs.map((diff) => {
          const before = diff.beforeDefense || {};
          const after = diff.afterDefense || {};
          return `
            <div class="solution-diff">
              <div class="solution-diff-head">
                <span class="revision-tag solution">защита</span>
                <span>попытка ${diff.from + 1} → попытка ${diff.to + 1}</span>
                <span class="muted">${before.passed ?? 0}/${before.total ?? 0} → ${after.passed ?? 0}/${after.total ?? 0} тестов</span>
              </div>
              ${diff.changes.length
                ? `<ul class="solution-diff-items">${diff.changes.map(renderSolutionChange).join('')}</ul>`
                : '<p class="muted">Результаты тестов не изменились.</p>'}
            </div>
          `;
        }).join('')}
      </div>
    </details>
  `;
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 0.001) {
    const microseconds = seconds * 1e6;
    const digits = microseconds < 1 ? 2 : microseconds < 10 ? 1 : 0;
    return `${microseconds.toFixed(digits)} мкс`;
  }
  return seconds < 1
    ? `${(seconds * 1000).toFixed(1)} мс`
    : `${seconds.toFixed(3)} с`;
}

function testStats(tests) {
  const list = (Array.isArray(tests) ? tests : []).filter((test) => !test.skipped);
  let total = 0;
  let lines = 0;
  list.forEach((test) => {
    total += Number(test.time_sec ?? 0);
    lines += Number(test.input_lines ?? 0);
  });
  return {
    count: list.length,
    total,
    lines,
    perLine: total / Math.max(1, lines),
  };
}

function testChanges(previous, current) {
  const before = testMap(previous);
  const after = testMap(current);
  const changes = [];

  after.forEach((test, path) => {
    const old = before.get(path);
    if (!old) {
      changes.push({ type: 'added', path, before: null, after: test });
      return;
    }
    if (String(old.input ?? '') !== String(test.input ?? '')
        || String(old.expected_output ?? '') !== String(test.expected_output ?? '')) {
      changes.push({ type: 'modified', path, before: old, after: test });
    }
  });

  before.forEach((test, path) => {
    if (!after.has(path)) changes.push({ type: 'removed', path, before: test, after: null });
  });

  return changes;
}

function splitLines(text) {
  const value = String(text ?? '');
  if (!value) return [];
  return value.replace(/\n$/, '').split('\n');
}

function lineDiff(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      rows[i][j] = a[i] === b[j]
        ? rows[i + 1][j + 1] + 1
        : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      result.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      result.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }

  while (i < a.length) result.push({ type: 'del', text: a[i++] });
  while (j < b.length) result.push({ type: 'add', text: b[j++] });
  return result;
}

function diffBlock(label, before, after) {
  if (String(before ?? '') === String(after ?? '')) return '';
  const lines = lineDiff(before, after);
  return `
    <div class="diff-snippet">
      <span class="diff-label">${esc(label)}</span>
      <pre>${lines.map((line) => {
        const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
        return `<span class="${line.type}">${prefix} ${esc(line.text)}</span>`;
      }).join('\n')}</pre>
    </div>
  `;
}

function renderChange(change) {
  const title = change.type === 'added'
    ? `+ ${change.path}`
    : change.type === 'removed'
      ? `− ${change.path}`
      : `± ${change.path}`;
  const before = change.before || {};
  const after = change.after || {};
  return `
    <div class="test-change">
      <h5>${esc(title)}</h5>
      ${diffBlock('input', before.input, after.input)}
      ${diffBlock('expected', before.expected_output, after.expected_output)}
    </div>
  `;
}

function renderAttackRevision(target, team, selected) {
  const attempts = testsUpTo(target, team, selected);
  if (attempts.length < 2) return '';
  const current = attempts[attempts.length - 1];
  const revision = Number(current.attacker.revision ?? 0);
  const previous = [...attempts].reverse().find(
    (attempt) => Number(attempt.attacker.revision ?? 0) < revision
  ) || attempts[attempts.length - 2];
  const changes = testChanges(previous.attacker, current.attacker);
  if (revision <= 0 && changes.length === 0) return '';

  return `
    <tr class="attack-revision-row">
      <td colspan="6">
        <details class="revision-details">
          <summary>
            <span class="revision-tag">атака</span>
            <span>${attemptName(revision)}</span>
            <span class="muted">${current.attacker.passed ?? 0}/${current.attacker.total ?? 0} тестов</span>
            <span class="muted">${changes.length ? `${changes.length} изм.` : 'без изменений'}</span>
          </summary>
          <div class="revision-body">${changes.map(renderChange).join('')}</div>
        </details>
      </td>
    </tr>
  `;
}

function renderTestRevision(test, target, selected) {
  const path = test.path || test.name || '(без имени)';
  const attempts = testsUpTo(target, test.author, selected);
  if (attempts.length < 2) return '';
  const previous = attempts[attempts.length - 2];
  const before = testMap(previous.attacker).get(path);
  const after = test;

  if (!before) {
    return `
      <div class="test-revision">
        <h4>тест добавлен</h4>
        ${diffBlock('input', '', after.input)}
        ${diffBlock('expected', '', after.expected_output)}
      </div>
    `;
  }

  const changed = String(before.input ?? '') !== String(after.input ?? '')
    || String(before.expected_output ?? '') !== String(after.expected_output ?? '');
  if (!changed) return '';

  return `
    <div class="test-revision">
      <h4>diff с прошлой попыткой</h4>
      ${diffBlock('input', before.input, after.input)}
      ${diffBlock('expected', before.expected_output, after.expected_output)}
    </div>
  `;
}

function renderFailure(test, target, entry) {
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
        <span class="meta">${esc(reason)} · ${formatSeconds(test.time_sec)}</span>
      </summary>
      <div class="failure-body">
        ${renderTestRevision(test, target, entry)}
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

function renderAttackerTests(attacker) {
  const tests = (Array.isArray(attacker?.tests) ? attacker.tests : [])
    .filter((test) => !test.skipped);
  if (!tests.length) return '';
  const stats = testStats(tests);

  return `
    <tr class="attack-revision-row attack-tests-row">
      <td colspan="6">
        <details class="revision-details">
          <summary>
            <span class="revision-tag">тесты</span>
            <span>${stats.count} шт.</span>
            <span class="muted">${formatSeconds(stats.total)} · ${formatSeconds(stats.perLine)}/строка</span>
          </summary>
          <div class="revision-body">
            <ul class="test-time-list">
              ${tests.map((test) => `
                <li>
                  ${outcomeBadge(test)}
                  <code>${esc(test.name)}</code>
                  <span class="muted">${Number(test.input_lines ?? 0)} стр.</span>
                  <span class="test-time">${formatSeconds(test.time_sec)}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </details>
      </td>
    </tr>
  `;
}

function renderDefense() {
  const entry = selectedEntry();
  if (!entry) {
    const first = TEAMS[0] || '1';
    const last = TEAMS[TEAMS.length - 1] || first;
    els.defense.innerHTML = emptyState(
      'Защит пока нет',
      `Создайте ветку <code>attack-${esc(first)}</code> … <code>attack-${esc(last)}</code> и добавьте решение и атаки.`,
      repoUrl('/branches')
    );
    return;
  }

  const target = String(entry.target);
  const defense = entry.defense || { passed: 0, total: 0, held: false };
  const solutionRev = Number(entry.solution_rev ?? 0);
  const attackers = Array.isArray(entry.attackers) ? entry.attackers : [];
  const attackAttempts = attackers.reduce(
    (sum, attacker) => sum + Number(attacker.revision ?? 0) + 1,
    0
  );
  const byTeam = new Map(attackers.map((attacker) => [String(attacker.team), attacker]));
  const failures = [];
  attackers.forEach((attacker) => {
    (attacker.tests || [])
      .filter((test) => !test.skipped && !test.passed)
      .forEach((test) => failures.push({ ...test, target }));
  });
  const defenseStats = testStats(
    attackers.flatMap((attacker) => attacker.tests || [])
  );

  const rows = TEAMS.map(String)
    .filter((team) => team !== target)
    .map((team) => {
      const attacker = byTeam.get(team);
      if (!attacker) {
        return `<tr class="no-attack">
          <th scope="row">${esc(teamLabel(team))}</th>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>0</td>
          <td class="muted">не атаковала</td>
        </tr>`;
      }
      const total = Number(attacker.total ?? 0);
      const passed = Number(attacker.passed ?? 0);
      const failed = Number(attacker.failed ?? Math.max(0, total - passed));
      const statusClass = failed === 0 ? 'good' : 'bad';
      const status = failed === 0 ? 'не пробила' : 'пробила';
      const stats = testStats(attacker.tests);
      return `
        <tr>
          <th scope="row">${esc(teamLabel(team))}</th>
          <td>${passed}/${total}</td>
          <td class="${statusClass}">${failed}</td>
          <td class="time-cell">${formatSeconds(stats.total)}<small>${formatSeconds(stats.perLine)}/стр.</small></td>
          <td>${Number(attacker.revision ?? 0) + 1}</td>
          <td class="${statusClass}">${status}</td>
        </tr>
        ${renderAttackRevision(target, team, entry)}
        ${renderAttackerTests(attacker)}
      `;
    }).join('');

  const failuresHtml = failures.length
    ? failures.map((test) => renderFailure(test, target, entry)).join('')
    : emptyState('Провалов нет', 'Защита выдержала все атаки.');
  const latest = latestEntries()[target];
  const archive = latest && state.selectedEntryId && latest.id !== state.selectedEntryId;

  els.defense.innerHTML = `
    <div class="panel-head defense-head">
      <div>
        <h2>${esc(teamLabel(target))}</h2>
        <p class="muted">${defense.held ? 'Защита выстояла' : 'Защита пробита'} · попыток решения: ${solutionRev + 1}${archive ? ' · исторический батл' : ''}</p>
      </div>
      <a class="btn compact" href="${repoUrl(`/tree/attack-${target}`)}" target="_blank" rel="noopener">Ветка на GitHub</a>
    </div>

    <div class="metric-grid">
      <article class="metric ${defense.held ? 'metric-win' : ''}">
        <span class="metric-label">Защита</span>
        <strong class="score"><b>${defense.passed ?? 0}</b><span>/${defense.total ?? 0}</span></strong>
        <span class="badge ${defense.held ? 'win' : ''}">${defense.held ? 'выстояла' : 'пробита'}</span>
      </article>
      ${metric('Попыток решения', solutionRev + 1)}
      ${metric('Попыток атаки', attackAttempts)}
      ${metric('Атакующих команд', attackers.length, `из ${TEAMS.length - 1}`)}
      ${metric('Время тестов', formatSeconds(defenseStats.total), `${formatSeconds(defenseStats.perLine)}/строка`)}
    </div>
    ${renderSolutionDiffs(target)}

    <div class="panel-head">
      <h2>Атаки <span class="count">${defense.total ?? 0}</span></h2>
    </div>
    <div class="table-wrap">
      <table class="matrix attack-table">
        <thead>
          <tr>
            <th scope="col">Атакующая команда</th>
            <th scope="col">Пройдено</th>
            <th scope="col">Провалено</th>
            <th scope="col">Время</th>
            <th scope="col">Попытки</th>
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
    const entry = latest[String(defender)];
    const attempts = Number(entry?.solution_rev ?? 0);
    rows += `<tr><th scope="row" class="matrix-defender"><span>${groupLabel(defender)}</span><small>попыток ${attempts + 1}</small>${renderSolutionDiffs(String(defender), true)}</th>`;
    TEAMS.forEach((attacker) => {
      const classes = ['cell'];
      if (defender === attacker) {
        classes.push('diag');
        rows += `<td class="${classes.join(' ')}">—</td>`;
        return;
      }
      const attack = entry && (entry.attackers || []).find(
        (item) => String(item.team) === String(attacker)
      );
      if (!attack || !attack.total) {
        classes.push('no-data');
        rows += `<td class="${classes.join(' ')}" title="Команда не присылала тесты">—</td>`;
        return;
      }
      const ratio = attack.passed / attack.total;
      classes.push(ratio >= 0.999 ? 'good' : ratio >= 0.5 ? 'mid' : 'bad');
      rows += `<td class="${classes.join(' ')}" title="Пройдено ${attack.passed} из ${attack.total}"><span class="cell-score">${attack.passed}/${attack.total}</span></td>`;
    });
    rows += '</tr>';
  });

  els.matrix.innerHTML = `
    <div class="panel-head">
      <h2>Краш-матрица</h2>
      <p class="muted">Строки — защита, столбцы — атакующие команды. Итоги — во вкладке «Результаты».</p>
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
      <li><span class="swatch no-data"></span> нет атак</li>
    </ul>
  `;
}

function rankKey(team) {
  return [
    Number(team.score ?? 0),
    Number(team.defense_quality ?? 0),
    Number(team.attack_quality ?? 0),
    Number(team.speed_quality ?? 0),
    -Number(team.solution_rev ?? 0),
    -Number(team.attack_revs ?? 0),
    -Number(team.team ?? 0),
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
  const label = solution ? 'защита' : 'атака';
  const main = solution
    ? `Защита ${groupLabel(item.target)} · попытка ${item.revision + 1}`
    : `Атака на ${groupLabel(item.target)} · попытка ${item.revision + 1}`;
  const result = solution
    ? `защита ${item.passed}/${item.total}`
    : `пробито ${item.failed}/${item.total}`;
  return `
    <li class="revision-item">
      <span class="revision-tag ${esc(item.kind)}">${label}</span>
      <span class="revision-main">${esc(main)}</span>
      <span class="revision-meta">${result}</span>
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
    const history = teamRevisionHistory(team.team);
    const isWinner = winner === String(team.team);
    const status = defense.held ? 'защита выстояла' : 'защита пробита';
    const defenseQuality = Math.round(Number(team.defense_quality ?? 0) * 100);
    const attackQuality = Math.round(Number(team.attack_quality ?? 0) * 100);
    const speedQuality = Math.round(Number(team.speed_quality ?? 0) * 100);
    const defenseAttempts = Array.isArray(team.defense_attempts) ? team.defense_attempts : [];
    const attackAttempts = (Array.isArray(team.attack_attempts) ? team.attack_attempts : [])
      .slice()
      .sort((a, b) => teamIndex(a.target) - teamIndex(b.target) || Number(a.revision) - Number(b.revision));
    const attemptLabel = (revision) => `попытка ${Number(revision ?? 0) + 1}`;
    const speedValue = formatSeconds(team.avg_time);
    const speedPerLine = formatSeconds(team.time_per_line);
    return `
      <article class="result-card ${isWinner ? 'winner' : ''}">
        <div class="result-top">
          <span class="result-place">${String(index + 1).padStart(2, '0')}</span>
          <div class="result-title">
            <h3>${esc(teamLabel(team.team))}</h3>
            <span class="badge ${defense.held ? 'win' : ''}">${status}</span>
          </div>
          <div class="result-points">
            <strong>${Number(team.score ?? 0).toFixed(2)}</strong>
            <span>баллов</span>
          </div>
        </div>
        <div class="result-stats">
          <div>
            <span>Защита</span>
            <strong>${defenseQuality}%</strong>
            <small>${team.defense_passed ?? 0}/${team.defense_total ?? 0} тестов · покрытие ${Math.round(Number(team.defense_coverage ?? 0) * 100)}%</small>
          </div>
          <div>
            <span>Атака</span>
            <strong>${attackQuality}%</strong>
            <small>${team.attack_points ?? 0}/${team.attack_total ?? 0} пробито · покрытие ${Math.round(Number(team.attack_coverage ?? 0) * 100)}%</small>
          </div>
          <div>
            <span>Скорость</span>
            <strong>${speedQuality}%</strong>
            <small>${speedValue} · ${speedPerLine}/строка · 20% балла</small>
          </div>
          <div>
            <span>Попыток решения / атак</span>
            <strong>${solutionRev + 1} / ${attackAttempts.length}</strong>
          </div>
        </div>
        <div class="attempt-breakdown">
          <div class="attempt-group">
            <div class="attempt-head">
              <span>Защита</span>
              <span>${team.defense_passed ?? 0}/${team.defense_total ?? 0} тестов</span>
            </div>
            <ul class="attempt-list">
              ${defenseAttempts.map((attempt) => `
                <li>
                  <span>${attemptLabel(attempt.revision)}</span>
                  <span>${attempt.passed ?? 0}/${attempt.total ?? 0} тестов</span>
                </li>
              `).join('')}
            </ul>
          </div>
          <div class="attempt-group">
            <div class="attempt-head">
              <span>Атака · по всем защитам</span>
              <span>${team.attack_points ?? 0}/${team.attack_total ?? 0} пробито</span>
            </div>
            <ul class="attempt-list">
              ${attackAttempts.map((attempt) => `
                <li>
                  <span>${esc(teamLabel(attempt.target))} · ${attemptLabel(attempt.revision)}</span>
                  <span>${attempt.failed ?? 0}/${attempt.total ?? 0} пробито</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>
        <p class="attempt-note muted">Защита — своя, атака — по всем защитам.</p>
        <details class="revision-log">
          <summary>История изменений <span class="count">${history.length}</span></summary>
          ${history.length
            ? `<ul class="revision-list">${history.map(revisionItem).join('')}</ul>`
            : '<p class="muted">Изменений пока нет.</p>'}
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
    </div>
    ${winner ? '' : '<p class="results-tie">Основные показатели лидеров совпали — ничья.</p>'}
    <div class="results-grid">${cards}</div>
  `;
}

function renderHistory() {
  const all = battleEntries();
  if (!all.length) {
    els.history.innerHTML = emptyState(
      'Батлов пока нет',
      'Здесь появятся все защиты. Внутри карточки видно попытки команд.'
    );
    return;
  }

  const rows = all.map((entry) => {
    const target = String(entry.target);
    const defense = entry.defense || {};
    const status = defense.held ? 'выстояла' : 'пробита';
    const revisionTotal = revisionCount(entry);
    const solutionRev = Number(entry.solution_rev ?? 0);
    const attackers = Array.isArray(entry.attackers) ? entry.attackers : [];
    const attackAttempts = attackers.reduce(
      (sum, attacker) => sum + Number(attacker.revision ?? 0) + 1,
      0
    );
    const revisions = [
      solutionRev > 0
        ? `<li class="battle-rev-row">
            <span class="revision-tag solution">защита</span>
            <span class="revision-main">Защита ${esc(teamLabel(target))} · попытка ${solutionRev + 1}</span>
            <span class="revision-meta">${defense.passed ?? 0}/${defense.total ?? 0} тестов</span>
          </li>`
        : '',
      ...attackers
        .filter((attacker) => Number(attacker.revision ?? 0) > 0)
        .map((attacker) => `
          <li class="battle-rev-row">
            <span class="revision-tag attack">атака</span>
            <span class="revision-main">${esc(teamLabel(attacker.team))} → ${esc(teamLabel(target))} · попытка ${Number(attacker.revision) + 1}</span>
            <span class="revision-meta">${attacker.failed ?? 0}/${attacker.total ?? 0} пробито</span>
          </li>
        `),
    ].join('');

    return `
      <article class="battle-card">
        <div class="battle-head">
          <div class="battle-title">
            <strong>Защита ${esc(teamLabel(target))}</strong>
            <span class="battle-meta">
              <span>${defense.passed ?? 0}/${defense.total ?? 0} · ${status}</span>
              <span>Попыток решения: ${solutionRev + 1}</span>
              <span>Атакующих: ${attackers.length}</span>
              <span>Попыток атаки: ${attackAttempts}</span>
            </span>
          </div>
          <div class="history-side">
            <span class="badge ${defense.held ? 'win' : ''}">${status}</span>
            <button type="button" class="btn" data-battle="${esc(entry.id)}">Открыть</button>
          </div>
        </div>
        <details class="battle-revisions">
          <summary>Изменения <span class="count">${revisionTotal}</span></summary>
          <div class="battle-rev-body">
            ${revisionTotal ? `<ul class="battle-rev-list">${revisions}</ul>` : '<p class="muted">Начальная защита — изменений пока нет.</p>'}
          </div>
        </details>
      </article>
    `;
  }).join('');

  els.history.innerHTML = `
    <div class="panel-head">
      <h2>История батлов <span class="count">${all.length}</span></h2>
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
  const [scoreboard, historyData, configData] = await Promise.all([
    fetchJson('scoreboard.json', null, true),
    fetchJson('history.json', { attacks: [] }),
    fetchJson('config.json', null, true),
  ]);
  applyConfig(configData);

  state.scoreboard = scoreboard;
  state.history = historyData && Array.isArray(historyData.attacks)
    ? historyData
    : { attacks: [] };

  const targets = availableTargets();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const hashTarget = fromHash.match(/^attack-(.+)$/)?.[1];
  const hashBattle = fromHash.match(/^battle-(.+)$/)?.[1];
  const battle = hashBattle && attackEntries().find((entry) => entry.id === hashBattle);
  const latest = latestEntries();
  const defaultTarget = battle
    ? String(battle.target)
    : targets.includes(hashTarget)
      ? hashTarget
      : targets[targets.length - 1] || null;

  state.selectedTarget = defaultTarget;
  state.selectedEntryId = battle ? battle.id : null;
  if (defaultTarget) {
    window.history.replaceState(
      null,
      '',
      battle ? `#battle-${battle.id}` : `#attack-${defaultTarget}`
    );
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
  const button = event.target.closest('[data-battle]');
  if (!button) return;
  selectBattle(button.dataset.battle);
  setTab('defense');
});

window.addEventListener('hashchange', () => {
  const hash = decodeURIComponent(location.hash.slice(1));
  const target = hash.match(/^attack-(.+)$/)?.[1];
  if (target && TEAMS.includes(target) && latestEntries()[target]) {
    state.selectedTarget = target;
    state.selectedEntryId = null;
    els.select.value = target;
    renderDefense();
    return;
  }
  const battleId = hash.match(/^battle-(.+)$/)?.[1];
  const battle = battleId && attackEntries().find((entry) => entry.id === battleId);
  if (battle) {
    state.selectedTarget = String(battle.target);
    state.selectedEntryId = battle.id;
    els.select.value = state.selectedTarget;
    renderDefense();
  }
});

load();
