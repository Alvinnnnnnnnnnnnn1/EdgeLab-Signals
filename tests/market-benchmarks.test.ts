import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,type Receipt,type Terms} from '../src/core/domain';
import {MarketBenchmarkAdapter,compareBookmakerMarkets,researchBooks,reviewMarketReceipt} from '../src/research/market-benchmarks';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/core/store';
import {configSchema} from '../src/core/config';

const at='2026-11-21T20:15:00.000Z';
function fixture(){
  const source:Receipt={provider:'TEST-ONLY mapping proof',endpoint:'https://example.invalid/test-only',retrievedAt:at,publishedAt:null,hash:hash('TEST-ONLY'),simulated:false};
  const event={id:'TEST-ONLY-game',league:'NBA' as const,season:'2026',homeId:'TEST-ONLY-home',awayId:'TEST-ONLY-away',home:'TEST-ONLY Home',away:'TEST-ONLY Away',startsAt:'2026-11-21T21:45:00.000Z'};
  const registry={events:[{oddsId:'TEST-ONLY-odds',event,verifiedAt:at,source}],players:[{eventId:event.id,description:'TEST-ONLY Player',playerId:'TEST-ONLY-player',player:'TEST-ONLY Player',teamId:event.homeId,verifiedAt:at,source}]};
  const terms:Terms[]=researchBooks.map(bookmaker=>({id:`TEST-ONLY-terms-${bookmaker}`,bookmaker,prop:'points',league:'NBA',includesOvertime:true,integerPush:true,dnpVoid:true,source}));
  const raw={id:'TEST-ONLY-odds',sport_key:'basketball_nba',commence_time:event.startsAt,home_team:event.home,away_team:event.away,bookmakers:researchBooks.map(key=>({key,title:key,markets:[{key:'player_points',last_update:at,outcomes:[{name:'Over',description:'TEST-ONLY Player',point:20.5,price:key==='tab'?2:1.9},{name:'Under',description:'TEST-ONLY Player',point:20.5,price:key==='tab'?1.8:1.9}]}]}))};
  const receipt={...source,provider:'odds',endpoint:'https://api.the-odds-api.com/v4/sports/basketball_nba/events/TEST-ONLY-odds/odds',hash:hash(JSON.stringify(raw))};
  const quotes=()=>researchBooks.flatMap(book=>new MarketBenchmarkAdapter(book).normalize(raw,receipt,registry,terms).quotes);
  return {source,receipt,event,registry,terms,raw,quotes};
}
test('optional adapters plan only allowlisted books and report genuinely observed event markets',()=>{
  const d=fixture(),tab=new MarketBenchmarkAdapter('tab');
  assert.equal(tab.plan('TEST-ONLY-odds').executable,false);assert.equal(tab.plan('TEST-ONLY-odds').prices.maximumCredits,4);
  assert.throws(()=>new MarketBenchmarkAdapter('bet365_au' as 'tab'));
  assert.throws(()=>tab.plan('../invalid'));
  const coverage=tab.discover(d.raw,d.receipt,d.registry);assert.equal(coverage.markets.find(m=>m.prop==='points')!.state,'recently_seen');assert.equal(coverage.markets.find(m=>m.prop==='threes')!.state,'not_observed');
  d.raw.bookmakers=d.raw.bookmakers.filter(b=>b.key==='sportsbet');assert.ok(tab.discover(d.raw,d.receipt,d.registry).markets.every(m=>m.state==='not_observed'));
  assert.equal(tab.normalize(d.raw,d.receipt,d.registry,d.terms).quotes.length,0);
  assert.throws(()=>tab.discover({...d.raw,commence_time:'2026-11-22T01:00:00.000Z'},d.receipt,d.registry),/changed/);
});
test('exact fresh two-sided lines produce per-book vig-adjusted disagreements without pooled evidence',()=>{
  const d=fixture(),r=compareBookmakerMarkets(d.quotes(),d.terms,at);assert.equal(r.comparisons.length,1);
  const c=r.comparisons[0];assert.equal(c.primary.over,.5);assert.equal(c.primary.under,.5);assert.equal(c.benchmarks.length,3);
  assert.ok(c.benchmarks.find(b=>b.bookmaker==='tab')!.overDisagreement<0);
  assert.equal(c.pooledProbability,null);assert.equal(c.independentObservations,false);assert.equal(r.qualifiedEligible,false);
});
test('different lines never substitute prices or Sportsbet primary markets',()=>{
  const d=fixture();for(const o of d.raw.bookmakers.find(b=>b.key==='tab')!.markets[0].outcomes)o.point=21.5;
  const r=compareBookmakerMarkets(d.quotes(),d.terms,at);assert.deepEqual(r.comparisons[0].missingBooks,['tab']);
  assert.ok(r.exclusions.some(e=>e.bookmaker==='tab'&&e.reason==='NO_SPORTSBET_AT_EXACT_LINE'));
  assert.equal(compareBookmakerMarkets(d.quotes().filter(q=>q.bookmaker!=='sportsbet'),d.terms,at).comparisons.length,0);
});
test('stale odds, unmatched settlement terms, asynchronous timestamps and ambiguous sides are excluded',()=>{
  const d=fixture();assert.equal(compareBookmakerMarkets(d.quotes(),d.terms,'2026-11-21T20:19:00.000Z').comparisons.length,0);
  assert.equal(compareBookmakerMarkets(d.quotes(),[],at).comparisons.length,0);
  const badTerms=d.terms.map(t=>({...t,includesOvertime:false})) as unknown as Terms[];assert.equal(compareBookmakerMarkets(d.quotes(),badTerms,at).comparisons.length,0);
  const shifted=d.quotes().map(q=>q.bookmaker==='tab'?{...q,quotedAt:'2026-11-21T20:14:00.000Z'}:q);
  assert.ok(compareBookmakerMarkets(shifted,d.terms,at).exclusions.some(e=>e.bookmaker==='tab'&&e.reason==='SETTLEMENT_OR_TIMESTAMP_MISMATCH'));
  const q=d.quotes();assert.equal(compareBookmakerMarkets([...q,q[0]],d.terms,at).comparisons.length,0);
  assert.equal(compareBookmakerMarkets(q.filter(q=>q.side==='over'),d.terms,at).comparisons.length,0);
  const mismatched=q.map(q=>q.bookmaker==='tab'?{...q,termsId:'unverified'}:q);assert.ok(compareBookmakerMarkets(mismatched,d.terms,at).comparisons[0].missingBooks.includes('tab'));
});
test('offline receipt review rejects unretained, simulated and non-provider market bytes without acquisition',()=>{
  const store=new Store(':memory:'),config=configSchema.parse({});try{
    assert.throws(()=>reviewMarketReceipt(store,config,'not-retained',at),/retained source/);
    const d=fixture(),body=JSON.stringify(d.raw),receipt={...d.receipt,simulated:true};store.receipt(receipt,body);
    assert.throws(()=>reviewMarketReceipt(store,config,hash(receipt),at),/Simulated/);
    const wrong={...d.receipt,endpoint:'https://example.invalid/fake'};store.receipt(wrong,body);assert.throws(()=>reviewMarketReceipt(store,config,hash(wrong),at),/genuine NBA/);
    const mismatch={...d.receipt,endpoint:d.receipt.endpoint.replace('TEST-ONLY-odds','different-event')};store.receipt(mismatch,body);assert.throws(()=>reviewMarketReceipt(store,config,hash(mismatch),at),/endpoint\/event/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM quota').get()!.n,0);assert.equal(store.signals().length,0);
  }finally{store.close();}
});

test('retained event catalogue and odds can be reviewed offline with verified identity and terms receipts',()=>{
  const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'edgelab-market-review-'));
  try{const d=fixture(),file=join(dir,'TEST-ONLY-evidence.json'),body=JSON.stringify(d.raw);
    store.receipt(d.receipt,body);
    writeFileSync(file,JSON.stringify({label:'licensed_export',licenseReference:'TEST-ONLY mocked permitted source',exportedAt:at,sources:[{receipt:d.source,body:'TEST-ONLY'},{receipt:d.receipt,body}],logs:[],contexts:[],terms:d.terms,registry:d.registry}),{mode:0o600});
    const config=configSchema.parse({evidenceFile:file}),report=reviewMarketReceipt(store,config,hash(d.receipt),at);
    assert.equal(report.networkRequests,0);assert.equal(report.comparisons.length,1);assert.equal(report.coverage.length,4);assert.equal(report.normalizationExclusions.length,0);
    const catalogue={...d.receipt,endpoint:d.receipt.endpoint.replace('/odds','/markets')};store.receipt(catalogue,body);
    const observed=reviewMarketReceipt(store,config,hash(catalogue),at);assert.equal(observed.comparisons.length,0);assert.equal(observed.coverage[1].markets[0].state,'recently_seen');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM quota').get()!.n,0);assert.equal(store.signals().length,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
