'use strict';

const $ = (selector) => document.querySelector(selector);
const loginPage = document.body.dataset.page === 'login';
const koreanDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long' });
const koreanTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
const currentDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

function show(id, message = '') {
  const target = $(id);
  target.textContent = message;
  target.hidden = !message;
}
function node(tag, message, className) {
  const element = document.createElement(tag);
  if (message !== undefined) element.textContent = message;
  if (className) element.className = className;
  return element;
}
function button(message, className, handler) {
  const element = node('button', message, className);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
}
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && !loginPage) location.replace('/login');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function busy(control, task, errorTarget) {
  if (control.disabled) return;
  control.disabled = true;
  show(errorTarget);
  return Promise.resolve().then(task).catch((error) => {
    show(errorTarget, error instanceof TypeError ? '연결을 확인해 주세요.' : error.message);
  }).finally(() => { control.disabled = false; });
}

function login() {
  let signup = false;
  const password = $('#password');
  const submit = $('#auth-submit');
  function mode(value) {
    signup = value;
    $('#show-login').setAttribute('aria-pressed', String(!signup));
    $('#show-signup').setAttribute('aria-pressed', String(signup));
    $('#auth-heading').textContent = signup ? '나만의 다이어리 시작하기' : '오늘을 기록해 볼까요?';
    $('#auth-intro').textContent = signup ? '아이디와 비밀번호를 정해 주세요.' : '로그인하고 내 다이어리를 열어 보세요.';
    $('#password-hint').hidden = !signup;
    submit.textContent = signup ? '계정 만들기' : '로그인';
    password.value = '';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    document.title = (signup ? '회원가입' : '로그인') + ' · 하루결';
    show('#message');
  }
  $('#show-login').onclick = () => mode(false);
  $('#show-signup').onclick = () => mode(true);
  $('#auth-form').onsubmit = (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget));
    busy(submit, async () => {
      await api(signup ? 'signup' : 'login', 'POST', input);
      location.replace('/diary');
    }, '#message');
  };
}

function diary() {
  const entryDialog = $('#entry-dialog');
  const entryForm = $('#entry-form');
  const deleteDialog = $('#delete-dialog');
  const ruleForm = $('#rule-form');
  const moods = { good: '좋았어요', steady: '평온했어요', hard: '버거웠어요' };
  let editId;
  let deleteTarget;
  let currentRule;

  function edit(entry) {
    editId = entry?.id;
    entryForm.reset();
    $('#dialog-title').textContent = entry ? '기록 수정' : '새 기록';
    const day = entryForm.elements.namedItem('day');
    day.max = currentDay();
    day.value = entry?.day ?? day.max;
    for (const field of ['title', 'plan', 'action', 'reflection', 'mood']) {
      entryForm.elements.namedItem(field).value = entry?.[field] ?? '';
    }
    show('#entry-error');
    entryDialog.showModal();
  }

  function entryCard(entry) {
    const card = node('details', undefined, 'entry-card');
    const summary = node('summary');
    const date = node('time', koreanDate.format(new Date(entry.day + 'T00:00:00+09:00')));
    date.dateTime = entry.day;
    summary.append(date, node('h3', entry.title));
    if (entry.mood) summary.append(node('span', moods[entry.mood], 'entry-mood'));
    const body = node('div', undefined, 'entry-body');
    for (const [name, heading, stage] of [['plan', '계획', 'PLAN'], ['action', '실행', 'DO'], ['reflection', '회고', 'SEE']]) {
      const group = node('section');
      const title = node('h4');
      title.className = 'entry-section-title';
      title.append(node('span', stage, 'stage ' + stage.toLowerCase()), ' ' + heading);
      group.append(title, node('p', entry[name] || '기록 없음'));
      body.append(group);
    }
    const actions = node('div', undefined, 'card-actions');
    actions.append(button('수정', 'ghost', async (event) => {
      const control = event.currentTarget;
      await busy(control, async () => edit(await api('diaries/' + entry.id)), '#status');
    }), button('삭제', 'ghost', () => {
      deleteTarget = entry.id;
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    }));
    body.append(actions);
    card.append(summary, body);
    return card;
  }

  async function loadEntries() {
    const { entries } = await api('diaries');
    const dates = new Set(entries.map((entry) => entry.day));
    const completed = [...dates].slice(0, 5).length;
    const marks = $('#day-marks');
    marks.replaceChildren();
    for (let day = 1; day <= 5; day++) {
      const mark = node('li', day <= completed ? '✓' : String(day), day <= completed ? 'filled' : '');
      mark.setAttribute('aria-label', day + '번째 기록 ' + (day <= completed ? '완료' : '대기'));
      marks.append(mark);
    }
    $('#progress-detail').textContent = '서로 다른 날짜 ' + completed + ' / 5일 기록';
    $('#entry-count').textContent = entries.length + '개';
    const list = $('#entries');
    if (entries.length) {
      list.replaceChildren(...entries.map(entryCard));
    } else {
      const empty = node('div', undefined, 'empty');
      empty.append(node('h3', '아직 기록이 없어요'), node('p', '새 기록을 눌러 오늘의 계획을 남겨 보세요.'));
      list.replaceChildren(empty);
    }
  }

  function ruleSection(title, value, stamp, reason) {
    const section = node('section');
    const time = node('time', koreanTime.format(new Date(stamp)));
    time.dateTime = stamp;
    section.append(node('h2', title), time, node('p', value));
    if (reason) section.append(node('p', '변경 이유 · ' + reason, 'muted'));
    return section;
  }
  async function loadRules() {
    const { rule, deadline, today } = await api('rules');
    currentRule = rule;
    const summary = $('#rule-summary');
    summary.replaceChildren();
    ruleForm.reset();
    show('#rule-error');
    $('#reason-wrap').hidden = !rule;
    $('#rule-reason').required = Boolean(rule);
    $('#rule-form-heading').textContent = rule ? '규칙 변경' : '최초 규칙';
    $('#save-rule').textContent = rule ? '변경 기록 저장' : '규칙 저장';
    $('#rule-value').placeholder = rule ? '변경한 계획 규칙' : '예: 매일 아침에 할 일 3개를 적는다.';
    ruleForm.hidden = Boolean(rule && (!deadline || today >= deadline || rule.revised));
    summary.hidden = !rule && !deadline;
    if (rule) summary.append(ruleSection('최초 계획 규칙', rule.original, rule.created_at));
    if (rule?.revised) summary.append(ruleSection('변경한 계획 규칙', rule.revised, rule.revised_at, rule.reason));
    else if (deadline) summary.append(node('p', '변경 마감 · ' + deadline + ' 00:00 (한국 시간)', 'muted'));
    else if (rule) summary.append(node('p', '첫 기록을 저장하면 규칙 변경 기한이 시작돼요.', 'muted'));
  }
  for (const control of document.querySelectorAll('[data-view]')) {
    control.onclick = () => {
      const rules = control.dataset.view === 'rules';
      for (const menu of document.querySelectorAll('[data-view]')) {
        menu.setAttribute('aria-pressed', String(menu === control));
      }
      $('#entries-view').hidden = rules;
      $('#rules-view').hidden = !rules;
      if (rules) busy(control, loadRules, '#status');
    };
  }
  $('#add-entry').onclick = () => edit();
  $('#close-dialog').onclick = () => entryDialog.close();
  $('#cancel-dialog').onclick = () => entryDialog.close();
  entryForm.onsubmit = (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(entryForm));
    busy($('#save-entry'), async () => {
      await api(editId ? 'diaries/' + editId : 'diaries', editId ? 'PUT' : 'POST', data);
      entryDialog.close();
      try {
        await loadEntries();
        show('#status', '기록을 저장했어요.');
      } catch (error) {
        show('#status', '저장한 기록을 표시하지 못했어요. 페이지를 새로고침해 주세요.');
      }
    }, '#entry-error');
  };
  deleteDialog.addEventListener('close', async () => {
    if (deleteDialog.returnValue !== 'delete' || !deleteTarget) return;
    const id = deleteTarget;
    deleteTarget = undefined;
    try {
      await api('diaries/' + id, 'DELETE');
      await loadEntries();
      show('#status', '기록을 삭제했어요.');
    } catch (error) { show('#status', error.message); }
  });
  ruleForm.onsubmit = (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(ruleForm));
    busy($('#save-rule'), async () => {
      await api('rules', currentRule ? 'PUT' : 'POST', data);
      try {
        await loadRules();
        show('#status', '규칙을 저장했어요.');
      } catch (error) {
        show('#status', '저장한 규칙을 표시하지 못했어요. 페이지를 새로고침해 주세요.');
      }
    }, '#rule-error');
  };
  $('#logout').onclick = (event) => busy(event.currentTarget, async () => {
    await api('logout', 'POST');
    location.replace('/login');
  }, '#status');
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  $('#today-label').textContent = koreanDate.format(new Date());
  Promise.all([api('me'), loadEntries()]).then(([account]) => {
    $('#account').textContent = account.username;
    $('#avatar').textContent = account.username[0].toUpperCase();
  }).catch((error) => show('#status', error.message));
}

if (loginPage) login();
else diary();
