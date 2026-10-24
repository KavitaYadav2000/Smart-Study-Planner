const P = require('./planner.js');
const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('ok -', m); };

const mk = (id, name, diff, topics) => ({ id, name, difficulty: diff, topics: topics.map((t, i) => ({ id: id + 't' + i, name: t })) });
const base = () => ({
    exam: '2026-11-08', hours: 3, revDays: P.computeRevDays('2026-10-18', '2026-11-08'),
    subjects: [mk('m', 'Maths', 3, ['Calculus', 'Algebra', 'Probability', 'Stats']), mk('p', 'Physics', 2, ['Kinematics', 'Optics', 'Heat', 'Electricity']), mk('e', 'English', 1, ['Grammar', 'Essay', 'Comprehension'])],
    done: {}, skip: {}
});
const planned = pl => pl.days.flatMap(d => d.tasks).filter(t => t.type === 'study');

// 1. everything gets scheduled, nothing after exam, revision at the end
let st = base(), pl = P.buildPlan(st, '2026-10-18');
ok(pl.total === 23, 'total sessions = 12 + 8 + 3');
ok(planned(pl).length === 23 && pl.unscheduled === 0, 'all sessions scheduled');
ok(pl.days.length === 21 && pl.days[20].date === '2026-11-07', 'plan ends the day before the exam');
ok(pl.days.slice(-2).every(d => d.kind === 'revision'), 'last 2 days are revision');
ok(pl.days.every(d => d.tasks.length <= pl.cap), 'never exceeds daily capacity');
ok(new Set(planned(pl).map(t => t.id)).size === 23, 'session ids unique');

// 2. plan is spread out, not front-loaded
const firstHalf = pl.days.slice(0, 9).flatMap(d => d.tasks).length;
ok(firstHalf < 23 && firstHalf >= 8, 'sessions spread across the period (' + firstHalf + ' in first 9 days)');

// 3. MISSED DAYS: nothing done for 6 days -> everything is re-spread over the remaining days
const t6 = P.addDays('2026-10-18', 6);
const pl6 = P.buildPlan(st, t6);
ok(planned(pl6).length === 23 && pl6.unscheduled === 0, 'after 6 missed days all sessions are still scheduled');
ok(pl6.days[0].date === t6 && pl6.days.length === 15, 'new plan starts today, ends before exam');
const perDay0 = pl.days.slice(0, 15).reduce((a, d) => a + d.tasks.length, 0) / 15;
const perDay6 = planned(pl6).length / (pl6.days.length - 2);
ok(perDay6 > perDay0 * 1.2, `daily load rises after missing days (${perDay0.toFixed(2)} -> ${perDay6.toFixed(2)})`);

// 4. completed work is never re-planned
st.done[pl.days[0].tasks[0].id] = '2026-10-18';
const after = P.buildPlan(st, '2026-10-19');
ok(!planned(after).some(t => t.id === pl.days[0].tasks[0].id), 'finished sessions are not scheduled again');
ok(after.done === 1, 'progress counts finished session');

// 5. sessions finished today remain visible (as done) and count against today's capacity
const s2 = base(); const todayPlan = P.buildPlan(s2, '2026-10-18');
todayPlan.days[0].tasks.forEach(t => { s2.done[t.id] = '2026-10-18'; });
const again = P.buildPlan(s2, '2026-10-18');
ok(again.days[0].tasks.filter(t => t.done).length === todayPlan.days[0].tasks.length, 'done-today sessions still listed');


// 5b. ticking a session must not add a new one to today's list
const s5 = base(); const b5 = P.buildPlan(s5, '2026-10-18');
s5.done[b5.days[0].tasks[0].id] = '2026-10-18';
const a5 = P.buildPlan(s5, '2026-10-18');
ok(a5.days[0].tasks.length === b5.days[0].tasks.length, 'ticking a session keeps today\'s list size (' + b5.days[0].tasks.length + ')');
ok(planned(a5).length === 23 && a5.unscheduled === 0, 'nothing lost or duplicated after ticking');

// 6. rest day pushes work forward
const s3 = base(); s3.skip['2026-10-18'] = true;
const p3 = P.buildPlan(s3, '2026-10-18');
ok(p3.days[0].kind === 'rest' && p3.days[0].tasks.length === 0, 'rest day has no sessions');
ok(planned(p3).length === 23, 'rest day: all sessions still fit');

// 7. overload warning
const s4 = base(); s4.hours = 1; s4.exam = '2026-10-22'; s4.revDays = 0;
const p4 = P.buildPlan(s4, '2026-10-18');
ok(p4.unscheduled > 0 && p4.hoursNeed > 1, 'overload detected, suggests more hours (' + p4.hoursNeed + 'h)');

// 8. edge cases
ok(P.buildPlan({ ...base(), exam: '2026-10-18' }, '2026-10-18').days.length === 0, 'exam today -> empty plan');
ok(P.buildPlan({ ...base(), subjects: [] }, '2026-10-18').days.length === 0, 'no subjects -> empty plan');
ok(P.buildPlan({ ...base(), exam: '' }, '2026-10-18').days.length === 0, 'no exam -> empty plan');
const one = P.buildPlan({ ...base(), exam: '2026-10-19' }, '2026-10-18');
ok(one.days.length === 1 && one.days[0].kind === 'study', 'exam tomorrow -> one study day');

// 9. streaks
const d = { a: '2026-10-14', b: '2026-10-15', c: '2026-10-16', e: '2026-10-18', f: '2026-10-10' };
let s = P.streaks(d, '2026-10-18'); ok(s.current === 1 && s.best === 3, 'streak: today only = 1, best = 3');
s = P.streaks({ a: '2026-10-16', b: '2026-10-17' }, '2026-10-18'); ok(s.current === 2, 'streak continues if yesterday done');
s = P.streaks({ a: '2026-10-10' }, '2026-10-18'); ok(s.current === 0, 'streak broken after a gap');
ok(P.activity(d, '2026-10-18', 14).length === 14 && P.activity(d, '2026-10-18', 14)[13].count === 1, 'activity series ok');

console.log(`\n${n} checks passed`);
