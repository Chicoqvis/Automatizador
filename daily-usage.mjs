export function quotaSummary(row, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0,10);
  const resetAt = Date.parse(day+'T00:00:00Z')+86400000;
  const quota = (name,used,limit) => ({name,used,limit,remaining:Math.max(0,limit-used)});
  return {day,resetAt,updatedAt:now,startedAt:row?.started_at||now,estimated:true,aiCalls:row?.ai_calls||0,aiUnknown:row?.ai_unknown||0,
    quotas:[{...quota('IA — neurônios',row?.ai_exhausted?10000:Math.ceil(row?.neurons||0),10000),remaining:row?.ai_unknown&&!row?.ai_exhausted?null:Math.max(0,10000-(row?.ai_exhausted?10000:Math.ceil(row?.neurons||0)))},quota('Site — requisições',row?.requests||0,100000),quota('Banco — linhas lidas',row?.rows_read||0,5000000),quota('Banco — linhas gravadas',row?.rows_written||0,100000)]};
}

export function measuredAiUsage(result, model) {
  const usage=result?.usage;
  if(model!=='@cf/meta/llama-3.3-70b-instruct-fp8-fast'||!Number.isFinite(usage?.prompt_tokens)||!Number.isFinite(usage?.completion_tokens))return {aiUnknown:1};
  return {neurons:(usage.prompt_tokens*26668+usage.completion_tokens*204805)/1000000};
}

export function trackDailyUsage(env, now=Date.now()) {
  const original=env.DB;
  const totals={reads:0,writes:0,neurons:0,aiCalls:0,aiUnknown:0,aiExhausted:0};
  function count(result){totals.reads+=result?.meta?.rows_read||0;totals.writes+=result?.meta?.rows_written||0;return result}
  function wrap(statement){return {
    bind(...values){return wrap(statement.bind(...values))},
    async first(...args){const result=await statement.all();count(result);const row=result.results?.[0]||null;return args.length?row?.[args[0]]??null:row},
    async all(...args){return count(await statement.all(...args))},
    async run(...args){return count(await statement.run(...args))},
    _statement:statement
  }}
  const DB={prepare(sql){return wrap(original.prepare(sql))},async batch(statements){return (await original.batch(statements.map(s=>s._statement||s))).map(count)}};
  return {env:{...env,DB,usage:totals},async flush(){
    // Include the counter's own row read/write; the overall totals remain estimates.
    await original.prepare(`INSERT INTO daily_usage(day,requests,rows_read,rows_written,neurons,ai_calls,ai_unknown,ai_exhausted,started_at) VALUES(?,1,?,?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET requests=requests+1,rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written,neurons=neurons+excluded.neurons,ai_calls=ai_calls+excluded.ai_calls,ai_unknown=ai_unknown+excluded.ai_unknown,ai_exhausted=MAX(ai_exhausted,excluded.ai_exhausted)`).bind(new Date(now).toISOString().slice(0,10),totals.reads+1,totals.writes+1,totals.neurons,totals.aiCalls,totals.aiUnknown,totals.aiExhausted,now).run();
  }};
}
