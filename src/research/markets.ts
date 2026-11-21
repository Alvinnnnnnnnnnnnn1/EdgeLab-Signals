import { ms, hash, ev, type Quote } from '../core/domain';
export function comparableSides(over: Quote, under: Quote) {
  const key = (q: Quote) => hash([q.event, q.playerId, q.prop, q.line, q.bookmaker, q.termsId]);
  if (over.side !== 'over' || under.side !== 'under' || key(over) !== key(under) || !over.termsId || Math.abs(ms(over.quotedAt) - ms(under.quotedAt)) > 30000 || ms(over.retrievedAt) >= ms(over.event.startsAt) || ms(under.retrievedAt) >= ms(under.event.startsAt)) throw new Error('Not an exact comparable pregame two-sided market');
  const rawOver = 1 / over.decimalOdds, rawUnder = 1 / under.decimalOdds, sum = rawOver + rawUnder;
  if (sum < 1 || sum > 1.3) throw new Error('Unsupported overround or inconsistent quote');
  return { method: 'proportional-two-sided', conditionalOnNoPush: true, over: rawOver / sum, under: rawUnder / sum, overround: sum - 1, original: { over, under } };
}
export function marketEvaluation(q: Quote, p: { win: number; push: number; void: number }, paired?: Quote) {
  if (ms(q.quotedAt) >= ms(q.event.startsAt) || ms(q.retrievedAt) >= ms(q.event.startsAt)) throw new Error('Post-event price cannot become a historical benchmark');
  if (p.void < 0 || p.win + p.push + p.void > 1 + 1e-9) throw new Error('Invalid outcome masses');
  const nonWinReturn = p.push + p.void;
  return { quote: q, probability: p.win, ordinaryBreakEven: 1 / q.decimalOdds, unconditionalBreakEven: (1 - nonWinReturn) / q.decimalOdds,
    fairOdds: p.win ? (1 - nonWinReturn) / p.win : null, ev: ev(p.win, nonWinReturn, q.decimalOdds), devig: paired ? q.side === 'over' ? comparableSides(q, paired) : comparableSides(paired, q) : null };
}
export function observedCLV(open: Quote, close: Quote) {
  const key = (q: Quote) => hash([q.event.id, q.event.league, q.playerId, q.prop, q.side, q.bookmaker, q.termsId]);
  if (key(open) !== key(close) || ms(close.quotedAt) <= ms(open.quotedAt) || ms(close.retrievedAt) >= ms(open.event.startsAt) || ms(close.quotedAt) >= ms(open.event.startsAt)) throw new Error('Closing quote must be genuinely observed later and before tip-off');
  return { opening: open, closing: close, rawLineMovement: close.line - open.line, priceCLV: open.line === close.line ? open.decimalOdds / close.decimalOdds - 1 : null, limitation: 'Latest observed quote; not certified bookmaker close unless the collection schedule establishes that.' };
}
