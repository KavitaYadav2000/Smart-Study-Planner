/* StudyFlow scheduling engine (pure functions, no DOM).
   The plan is always *derived* from the current state, so when you miss a day
   the unfinished sessions are simply re-spread over the days that are left. */
(function (root) {
    const SESSION = 45; // minutes per study session
    const PER = { 1: 1, 2: 2, 3: 3 }; // sessions per topic by difficulty (Easy / Medium / Hard)

    const pad = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
    const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

    /** All study sessions of one subject, in topic order. IDs are stable so "done" survives replanning. */
    function sessionsOf(subj) {
        const n = PER[subj.difficulty] || 2;
        const out = [];
        subj.topics.forEach(t => {
            for (let p = 1; p <= n; p++) {
                out.push({
                    id: `${t.id}:${p}`, subjectId: subj.id, type: 'study', mins: SESSION,
                    label: n > 1 ? `${t.name} (${p}/${n})` : t.name
                });
            }
        });
        return out;
    }

    /** More days before the exam -> more revision days at the end. */
    function computeRevDays(today, exam) {
        const n = diffDays(today, exam);
        return n >= 10 ? 2 : n >= 5 ? 1 : 0;
    }

    /**
     * st = { exam:'YYYY-MM-DD', hours:number, revDays:number, subjects:[{id,name,difficulty,topics:[{id,name}]}],
     *        done:{ sessionId: 'YYYY-MM-DD' }, skip:{ 'YYYY-MM-DD': true } }
     */
    function buildPlan(st, today) {
        const lookup = {}, bySubj = [];
        st.subjects.forEach(s => {
            const arr = sessionsOf(s);
            arr.forEach(x => { lookup[x.id] = x; });
            bySubj.push({ s, arr });
        });
        const ids = Object.keys(lookup);
        const res = {
            days: [], lookup, total: ids.length, done: ids.filter(id => st.done[id]).length,
            unscheduled: 0, hoursNeed: 0, examIn: 0, cap: 0, remaining: 0
        };
        if (!st.exam) return res;
        const examIn = diffDays(today, st.exam);
        res.examIn = examIn;
        if (examIn <= 0 || !st.subjects.length) return res;

        const cap = Math.max(1, Math.floor(st.hours * 60 / SESSION));
        res.cap = cap;
        const revN = Math.min(st.revDays || 0, Math.max(0, examIn - 1));
        const dates = Array.from({ length: examIn }, (_, i) => addDays(today, i));
        const studyDates = dates.slice(0, examIn - revN);
        const revDates = dates.slice(examIn - revN);

        // 1) interleave the remaining sessions so subjects are mixed and finish together
        const queues = bySubj.map(({ s, arr }) => ({ s, list: arr.filter(x => !st.done[x.id]) }));
        const order = [];
        let last = -1;
        for (; ;) {
            let c = queues.map((_, i) => i).filter(i => queues[i].list.length);
            if (!c.length) break;
            if (c.length > 1) c = c.filter(i => i !== last);
            c.sort((a, b) => queues[b].list.length - queues[a].list.length
                || queues[b].s.difficulty - queues[a].s.difficulty || a - b);
            last = c[0];
            order.push(queues[last].list.shift());
        }
        res.remaining = order.length;

        // 2) spread them evenly over the study days that are left (skipped days get nothing)
        const active = studyDates.filter(d => !st.skip[d]);
        const doneToday = ids.filter(id => st.done[id] === today).length; // finished today: counts toward today's share
        const pacingTotal = order.length + doneToday;
        let p = 0, activeIdx = 0;
        studyDates.forEach((date, idx) => {
            const skipped = !!st.skip[date];
            const tasks = [];
            if (idx === 0) { // sessions already finished today stay visible
                ids.filter(id => st.done[id] === date).forEach(id => tasks.push({ ...lookup[id], done: true }));
            }
            if (!skipped) {
                const cum = Math.ceil(pacingTotal * (activeIdx + 1) / active.length);
                const room = Math.max(0, cap - tasks.length);
                const take = Math.max(0, Math.min(room, cum - p - doneToday));
                order.slice(p, p + take).forEach(x => tasks.push({ ...x, done: false }));
                p += take;
                activeIdx++;
            }
            res.days.push({ date, kind: skipped ? 'rest' : tasks.length ? 'study' : 'free', tasks });
        });
        res.unscheduled = order.length - p;
        if (res.unscheduled > 0) {
            const need = Math.ceil(order.length / Math.max(1, active.length));
            res.hoursNeed = Math.ceil(need * SESSION / 60 * 2) / 2;
        }

        // 3) revision days at the end: every subject, hardest first
        const subs = [...st.subjects].sort((a, b) => b.difficulty - a.difficulty);
        let r = 0;
        revDates.forEach(date => {
            const tasks = [];
            for (let k = 0; k < cap; k++) {
                const s = subs[r++ % subs.length];
                const id = `rev:${s.id}:${date}:${k}`;
                tasks.push({ id, subjectId: s.id, type: 'rev', mins: SESSION, label: 'Revise: ' + s.name, done: !!st.done[id] });
            }
            res.days.push({ date, kind: 'revision', tasks });
        });
        return res;
    }

    /** Current & best streak (a day counts if at least one session was finished). */
    function streaks(done, today) {
        const set = new Set(Object.values(done));
        let cur = 0, d = set.has(today) ? today : addDays(today, -1);
        while (set.has(d)) { cur++; d = addDays(d, -1); }
        const sorted = [...set].sort();
        let best = 0, run = 0;
        sorted.forEach((s, i) => {
            run = i > 0 && diffDays(sorted[i - 1], s) === 1 ? run + 1 : 1;
            best = Math.max(best, run);
        });
        return { current: cur, best };
    }

    /** Sessions finished per day for the last n days (oldest first). */
    function activity(done, today, n) {
        const counts = {};
        Object.values(done).forEach(d => { counts[d] = (counts[d] || 0) + 1; });
        return Array.from({ length: n }, (_, i) => {
            const date = addDays(today, i - (n - 1));
            return { date, count: counts[date] || 0 };
        });
    }

    const api = { SESSION, PER, ymd, parse, addDays, diffDays, sessionsOf, computeRevDays, buildPlan, streaks, activity };
    if (typeof module !== 'undefined') module.exports = api;
    else root.Planner = api;
})(typeof window !== 'undefined' ? window : this);
