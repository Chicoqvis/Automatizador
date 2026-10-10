// Workers AI renews its daily free allocation at 00:00 UTC.
export function dailyAiQuotaError(error, now = Date.now()) {
  const detail = [error?.message, error?.code, error?.cause?.message, error?.cause?.code, typeof error === 'string' ? error : ''].join(' ');
  if (!/\b3036\b|used up your daily free allocation|daily.*(?:neuron|free allocation).*(?:exceed|limit|exhaust)|(?:exceed|exhaust).*daily.*(?:neuron|free allocation)/i.test(detail)) return null;
  const date = new Date(now);
  const resetAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  const retryAfter = Math.ceil((resetAt - now) / 1000);
  const minutes = Math.ceil(retryAfter / 60);
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  const duration = hours ? `${hours} h${remainder ? ` e ${remainder} min` : ''}` : `${minutes} min`;
  return Object.assign(new Error(`A cota diária gratuita da IA foi atingida. Você poderá usar a IA novamente em aproximadamente ${duration}, às 21h (horário de Brasília). Seu texto foi preservado; você pode continuar editando os campos manualmente.`), { status: 429, code: 'AI_DAILY_QUOTA_EXCEEDED', resetAt, retryAfter });
}
