import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/repo-review-tools.js';
const {pendingSummary,observeChanges}=globalThis.RepoReviewTools;
const now=Date.parse('2026-10-11T20:00:00Z'),row=(id,phase='business_approved')=>({id,number:42,title:'Solicitação',author:'author',body:'private body',state:'open',process:{currentPhase:phase,phaseLabel:phase==='business_approved'?'Aprovação de negócio':'Análise',phaseStatus:'pending',enteredCurrentPhaseAt:new Date(now-86400000).toISOString()}});
test('resumo conta 3 e 7 dias dentro do total e não inventa idade sem data',()=>{
 const rows=[1,4,8].map(days=>({enteredAt:new Date(now-days*86400000).toISOString()}));rows.push({enteredAt:null});assert.deepEqual(pendingSummary(rows,now),{total:4,over3:2,over7:1});
});
test('primeira consulta não inventa alterações; nova aprovação e movimento são detectados uma vez',()=>{
 let state=observeChanges(null,{workspace:'w',checkedAt:1,partial:false,items:[row('a','analyzed')]});assert.equal(state.events.length,0);state=observeChanges(state,{workspace:'w',checkedAt:2,partial:false,items:[row('a'),row('b')]});assert.equal(state.events.length,2);assert(state.events.every(event=>event.type==='new-approval'));assert(!JSON.stringify(state).includes('private body'));state=observeChanges(state,{workspace:'w',checkedAt:3,partial:false,items:[row('a'),row('b')]});assert.equal(state.events.length,2);state=observeChanges(state,{workspace:'w',checkedAt:4,partial:false,items:[row('a','analyzed')]});assert.equal(state.events.at(-1).type,'phase-changed');assert.equal(state.events.at(-1).from,'Aprovação de negócio');
});
test('consulta inicial parcial, fase desconhecida e consulta antiga não geram mudanças falsas',()=>{
 let state=observeChanges(null,{workspace:'w',checkedAt:1,partial:true,items:[row('a')]});state=observeChanges(state,{workspace:'w',checkedAt:2,partial:false,items:[row('a'),row('b')]});assert.equal(state.events.length,0);state=observeChanges(state,{workspace:'w',checkedAt:3,partial:true,items:[{...row('a'),process:null}]});assert.equal(state.baseline.a.process.currentPhase,'business_approved');assert.deepEqual(observeChanges(state,{workspace:'w',checkedAt:1,items:[row('a','analyzed')]}),state);
});
