(() => {
    const P = window.Planner;
    const $ = s => document.querySelector(s);
    const KEY = 'studyflow-v1', THEME = 'studyflow-theme';
    const COLORS = ['#34d399', '#818cf8', '#fb7185', '#fbbf24', '#38bdf8', '#c084fc', '#f97316', '#2dd4bf'];
    const DIFF = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    const uid = () => Math.random().toString(36).slice(2, 9);
    const todayStr = () => P.ymd(new Date());
    const fmt = s => { const d = P.parse(s); return { dow: DOW[d.getDay()], day: d.getDate(), mon: MON[d.getMonth()] }; };

    /* ---------- state ---------- */
    const fresh = () => ({ exam: '', hours: 3, revDays: 0, subjects: [], done: {}, skip: {}, lastPlan: {}, notice: null });
    let st = fresh();
    try { const raw = localStorage.getItem(KEY); if (raw) st = Object.assign(fresh(), JSON.parse(raw)); } catch (e) { }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { } };
    const colorOf = id => { const i = st.subjects.findIndex(s => s.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
    const nameOf = id => (st.subjects.find(s => s.id === id) || { name: '' }).name;

    let showAll = false, plan = null;

    /* ---------- missed-day detection (the "auto adjust" part) ---------- */
    function detectMissed() {
        const today = todayStr();
        const lookup = P.buildPlan(st, today).lookup;
        const missedDates = [];
        let missed = 0;
        Object.keys(st.lastPlan).forEach(date => {
            if (date >= today) return;
            if (!st.skip[date]) {
                const n = st.lastPlan[date].filter(id => !st.done[id] && (lookup[id] || (id.startsWith('rev:') && st.subjects.some(s => s.id === id.split(':')[1])))).length;
                if (n) { missed += n; missedDates.push(date); }
            }
            delete st.lastPlan[date];
        });
        if (missed) {
            st.notice = {
                kind: 'warn', title: `You missed ${missed} session${missed > 1 ? 's' : ''}`,
                text: `Missed on ${missedDates.map(d => { const f = fmt(d); return f.day + ' ' + f.mon; }).join(', ')}. No problem, I re-spread them over the days left before your exam.`
            };
        }
    }

    /* ---------- render ---------- */
    function render() {
        const today = todayStr();
        plan = P.buildPlan(st, today);
        // remember what was planned so tomorrow we can tell what was missed
        plan.days.forEach(d => { st.lastPlan[d.date] = d.tasks.map(t => t.id); });
        save();

        renderNotice();
        renderStats(today);
        renderToday(today);
        renderUpcoming(today);
        renderSettings(today);
        renderSubjects();
        renderActivity(today);
    }

    function renderNotice() {
        const el = $('#notice');
        let n = st.notice;
        if (!n && plan.examIn <= 0 && st.exam && st.subjects.length) {
            n = { kind: 'bad', title: 'Your exam date has passed', text: 'Pick a new exam date in Plan settings to build a fresh schedule.', sticky: true };
        } else if (!n && plan.unscheduled > 0) {
            n = {
                kind: 'warn', sticky: true, title: `${plan.unscheduled} session${plan.unscheduled > 1 ? 's' : ''} don't fit`,
                text: `At ${st.hours}h/day there isn't enough time before the exam. Try about ${plan.hoursNeed}h/day, or cut a topic.`
            };
        }
        if (!n) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="notice ${n.kind}"><div><b>${esc(n.title)}</b><p>${esc(n.text)}</p></div>${n.sticky ? '' : '<button aria-label="Dismiss" data-act="dismiss">×</button>'}</div>`;
    }

    function renderStats(today) {
        const { current, best } = P.streaks(st.done, today);
        const pct = plan.total ? Math.round(plan.done / plan.total * 100) : 0;
        const circ = 2 * Math.PI * 30;
        const td = plan.days[0] && plan.days[0].date === today ? plan.days[0].tasks : [];
        const tdDone = td.filter(t => t.done).length;
        const left = plan.examIn > 0 ? plan.examIn : (st.exam ? 0 : null);
        $('#stats').innerHTML = `
            <div class="stat"><small>Days to exam</small><strong>${left === null ? '–' : left}</strong><span>${st.exam ? esc(P.parse(st.exam).toDateString()) : 'Set your exam date'}</span></div>
            <div class="stat"><small>Streak</small><strong>${current} <span style="font-size:1.2rem">🔥</span></strong><span>Best: ${best} day${best === 1 ? '' : 's'}</span></div>
            <div class="stat ring"><svg width="74" height="74" viewBox="0 0 74 74"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs>
                <circle class="track" cx="37" cy="37" r="30"/><circle class="bar" cx="37" cy="37" r="30" transform="rotate(-90 37 37)" stroke-dasharray="${(circ * pct / 100).toFixed(1)} ${circ.toFixed(1)}"/></svg>
                <div><small>Progress</small><strong>${pct}%</strong><span>${plan.done}/${plan.total} sessions</span></div></div>
            <div class="stat"><small>Today</small><strong>${tdDone}/${td.length}</strong><span>${td.length ? Math.round(td.length * P.SESSION / 60 * 10) / 10 + 'h planned' : 'nothing planned'}</span></div>`;
    }

    function renderToday(today) {
        const el = $('#today');
        const f = fmt(today);
        const day = plan.days[0] && plan.days[0].date === today ? plan.days[0] : null;
        let body;
        if (!st.subjects.length || !st.exam) {
            body = `<div class="empty"><b>Let's build your plan 🚀</b>Set your exam date and add your subjects on the right. I'll turn them into a daily schedule that adapts when life happens.
                <br><button class="btn primary" style="max-width:240px" data-act="sample">Try a sample plan</button></div>`;
        } else if (plan.examIn <= 0) {
            body = `<div class="empty"><b>No upcoming exam</b>Choose a future exam date to get a schedule.</div>`;
        } else if (day && day.kind === 'rest') {
            body = `<div class="empty"><b>Rest day 😌</b>Enjoy the break. Your sessions have been moved to the coming days.</div>
                <div class="today-actions"><button class="btn ghost sm" data-act="unskip">Undo rest day</button></div>`;
        } else if (day && day.tasks.length) {
            const done = day.tasks.filter(t => t.done).length;
            body = `<div class="tasks">${day.tasks.map(t => `
                <label class="task ${t.done ? 'done' : ''}" style="--c:${colorOf(t.subjectId)}">
                    <input type="checkbox" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''}><span class="check">✓</span>
                    <span class="t"><b>${esc(t.label)}</b><span>${esc(nameOf(t.subjectId))}${t.type === 'rev' ? ' · revision' : ''}</span></span>
                    <span class="m">${t.mins} min</span></label>`).join('')}</div>
                <div class="today-actions">
                    ${done === day.tasks.length ? '' : '<button class="btn ghost sm" data-act="skip">Take a rest day</button>'}
                </div>`;
        } else {
            body = `<div class="empty"><b>Free day ✨</b>Nothing scheduled today, you're ahead of the plan.</div>
                <div class="today-actions"><button class="btn ghost sm" data-act="skip">Mark as rest day</button></div>`;
        }
        el.innerHTML = `<h2>Today <small>${f.dow}, ${f.day} ${f.mon}</small></h2>${body}`;
    }

    function dayRow(d) {
        const f = fmt(d.date);
        let inner;
        if (d.kind === 'rest') inner = '<span class="tag rest">Rest day</span>';
        else if (d.kind === 'free') inner = '<span class="tag free">Free day</span>';
        else {
            const tag = d.kind === 'revision' ? '<span class="tag rev">Revision</span>' : '';
            inner = tag + d.tasks.map(t => `<span class="chip" style="--c:${colorOf(t.subjectId)}"><i></i>${esc(t.label)}</span>`).join('');
        }
        return `<div class="day"><div class="d"><b>${f.dow}</b><span>${f.day} ${f.mon}</span></div><div class="chips">${inner}</div></div>`;
    }

    function renderUpcoming() {
        const el = $('#upcoming');
        const rest = plan.days.slice(1);
        if (!rest.length) { el.innerHTML = `<h2>Upcoming</h2><div class="no-subj">Your schedule for the coming days will appear here.</div>`; return; }
        const list = showAll ? rest : rest.slice(0, 7);
        el.innerHTML = `<h2>Upcoming <small>${rest.length} day${rest.length > 1 ? 's' : ''} until exam</small></h2>${list.map(dayRow).join('')}
            ${rest.length > 7 ? `<button class="link" data-act="toggleAll">${showAll ? 'Show less' : `Show full schedule (+${rest.length - 7} days)`}</button>` : ''}`;
    }

    function renderSettings(today) {
        const dt = $('#examDate');
        dt.min = P.addDays(today, 1);
        if (document.activeElement !== dt) dt.value = st.exam;
        const h = $('#hours');
        if (!h.options.length) for (let x = 1; x <= 8; x += .5) { const o = document.createElement('option'); o.value = x; o.textContent = x + ' h'; h.appendChild(o); }
        h.value = st.hours;
        const hint = $('#settingsHint');
        hint.classList.toggle('warn', plan.unscheduled > 0);
        hint.textContent = plan.examIn > 0
            ? `${plan.remaining} sessions left · up to ${plan.cap} per day · ${st.revDays ? st.revDays + ' revision day' + (st.revDays > 1 ? 's' : '') + ' before exam' : 'no revision days (exam is close)'}`
            : 'Each session is 45 minutes. Hard topics get 3 sessions, medium 2, easy 1.';
    }

    function renderSubjects() {
        const el = $('#subjectList');
        if (!st.subjects.length) { el.innerHTML = '<p class="no-subj">No subjects yet. Add your first one below.</p>'; return; }
        el.innerHTML = st.subjects.map((s, i) => {
            const all = P.sessionsOf(s), d = all.filter(x => st.done[x.id]).length;
            const pct = all.length ? Math.round(d / all.length * 100) : 0;
            return `<div class="subj" style="--c:${COLORS[i % COLORS.length]}">
                <div class="subj-top"><i></i><b>${esc(s.name)}</b><em>${DIFF[s.difficulty]} · ${s.topics.length} topic${s.topics.length > 1 ? 's' : ''}</em><button class="x" data-act="delSubject" data-id="${s.id}" aria-label="Delete ${esc(s.name)}">×</button></div>
                <div class="pbar"><div style="width:${pct}%"></div></div><small>${d}/${all.length} sessions done · ${pct}%</small>
                <form class="add-topic" data-id="${s.id}"><input type="text" placeholder="Add a topic" maxlength="40" aria-label="New topic for ${esc(s.name)}"><button aria-label="Add topic">+</button></form></div>`;
        }).join('');
    }

    function renderActivity(today) {
        const data = P.activity(st.done, today, 14);
        const max = Math.max(1, ...data.map(d => d.count));
        const total = data.reduce((a, d) => a + d.count, 0);
        $('#activity').innerHTML = `<h2>Last 14 days <small>${total} session${total === 1 ? '' : 's'}</small></h2>
            <div class="chart">${data.map((d, i) => `<div class="bar-col ${d.count ? '' : 'zero'} ${i === 13 ? 'today' : ''}" title="${d.date}: ${d.count}"><div style="height:${d.count ? Math.max(8, d.count / max * 100) : 3}%"></div><span>${DOW[P.parse(d.date).getDay()][0]}</span></div>`).join('')}</div>`;
    }

    /* ---------- actions ---------- */
    let tt;
    function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

    document.addEventListener('change', e => {
        const cb = e.target.closest('input[type=checkbox][data-id]');
        if (!cb) return;
        const today = todayStr();
        if (cb.checked) st.done[cb.dataset.id] = today; else delete st.done[cb.dataset.id];
        render();
        const day = plan.days[0];
        if (cb.checked && day && day.date === today && day.tasks.length && day.tasks.every(t => t.done)) toast('Day complete! Great work 🎉');
    });

    document.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const today = todayStr(), act = b.dataset.act;
        if (act === 'dismiss') { st.notice = null; render(); }
        else if (act === 'skip') {
            st.skip[today] = true; st.notice = null; render();
            toast('Rest day set. Sessions moved to coming days.');
        }
        else if (act === 'unskip') { delete st.skip[today]; render(); }
        else if (act === 'toggleAll') { showAll = !showAll; renderUpcoming(); }
        else if (act === 'sample') loadSample();
        else if (act === 'delSubject') {
            const s = st.subjects.find(x => x.id === b.dataset.id);
            if (s && confirm(`Delete "${s.name}" and its topics?`)) { st.subjects = st.subjects.filter(x => x.id !== s.id); render(); }
        }
    });

    $('#examDate').addEventListener('change', e => {
        const v = e.target.value, today = todayStr();
        if (!v) return;
        if (v <= today) { toast('Pick a date after today'); e.target.value = st.exam; return; }
        st.exam = v; st.revDays = P.computeRevDays(today, v); st.notice = null; render();
    });
    $('#hours').addEventListener('change', e => { st.hours = +e.target.value; st.notice = null; render(); });

    $('#subjectForm').addEventListener('submit', e => {
        e.preventDefault();
        const name = $('#subName').value.trim();
        if (!name) return;
        let lines = $('#subTopics').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30);
        if (!lines.length) lines = Array.from({ length: 5 }, (_, i) => 'Chapter ' + (i + 1));
        st.subjects.push({ id: uid(), name, difficulty: +$('#subDiff').value, topics: lines.map(n => ({ id: uid(), name: n })) });
        e.target.reset(); $('#subDiff').value = '2';
        st.notice = null; render();
        toast(`${name} added, schedule updated`);
    });

    document.addEventListener('submit', e => {
        const f = e.target.closest('.add-topic');
        if (!f) return;
        e.preventDefault();
        const inp = f.querySelector('input'), v = inp.value.trim(), s = st.subjects.find(x => x.id === f.dataset.id);
        if (!v || !s) return;
        s.topics.push({ id: uid(), name: v });
        render();
    });

    function daysFromNow(n) { return P.addDays(todayStr(), n); }
    function loadSample() {
        const mk = (name, difficulty, topics) => ({ id: uid(), name, difficulty, topics: topics.map(n => ({ id: uid(), name: n })) });
        const exam = daysFromNow(21);
        st = Object.assign(fresh(), {
            exam, hours: 3, revDays: P.computeRevDays(todayStr(), exam),
            subjects: [
                mk('Mathematics', 3, ['Calculus', 'Algebra', 'Probability', 'Statistics']),
                mk('Physics', 2, ['Kinematics', 'Optics', 'Thermodynamics', 'Electricity']),
                mk('English', 1, ['Grammar', 'Essay writing', 'Comprehension'])
            ]
        });
        render();
        toast('Sample plan loaded');
    }

    $('#sampleBtn').addEventListener('click', () => {
        if (!st.subjects.length || confirm('Replace your current plan with the sample?')) loadSample();
    });
    $('#resetBtn').addEventListener('click', () => {
        if (confirm('Delete all subjects and progress?')) { st = fresh(); render(); toast('Everything cleared'); }
    });

    /* theme */
    const setTheme = t => { document.documentElement.dataset.theme = t; try { localStorage.setItem(THEME, t); } catch (e) { } };
    try { const t = localStorage.getItem(THEME); if (t) setTheme(t); } catch (e) { }
    $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

    /* a tab left open past midnight should refresh itself */
    let lastDay = todayStr();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && todayStr() !== lastDay) { lastDay = todayStr(); detectMissed(); render(); }
    });

    detectMissed();
    render();
})();
