import { describe, expect, it } from 'vitest';
import { SeatedElbowAnalyzer, summarizeElbow, type ElbowConfig, type ElbowAttempt } from './seated-elbow.js';
import type { ReachFrame } from './reach-contract.js';

function frame(time: number, angle = 180): ReachFrame {
  const radians = angle * Math.PI / 180;
  return { timestampMs: time, width: 400, height: 300, orientation: 'side-view', side: 'left', landmarks: {
    shoulder: { x: 0.5, y: 100 / 300, confidence: 1 }, elbow: { x: 0.5, y: 0.5, confidence: 1 },
    wrist: { x: (200 + 50 * Math.sin(radians)) / 400, y: (150 - 50 * Math.cos(radians)) / 300, confidence: 1 },
    hip: { x: 0.5, y: 250 / 300, confidence: 1 },
  } };
}
function config(): ElbowConfig {
  return { sessionId: 'test', configurationId: 'elbow-fixture', version: 'elbow.experimental-v1', mode: 'rehabilitation', side: 'left', frameWidth: 400, frameHeight: 300, orientation: 'side-view', forwardSign: 1,
    baseline: { shoulder: { x: 200, y: 100 }, elbow: { x: 200, y: 150 }, wrist: { x: 200, y: 200 }, hip: { x: 200, y: 250 } }, endpointDeg: 90,
    settings: { minConfidence: { shoulder: 0.5, elbow: 0.5, wrist: 0.5, hip: 0.5 }, minSegmentPx: 1,
      restToleranceDeg: 5, endpointToleranceDeg: 5, onsetExcursionDeg: 20, returnHysteresisDeg: 10,
      readinessMs: 100, onsetDwellMs: 100, endpointDwellMs: 100, returnDwellMs: 100, timeoutMs: 2000,
      smoothingTauMs: 0, filterResetGapMs: 100, sampleSupportMs: 75, maxGapMs: 200, minCoverage: 0.8, minObservations: 6 }, criteria: [] };
}
function ready(engine: SeatedElbowAnalyzer, offset = 0) { [0,50,100].forEach((t)=>engine.accept(frame(offset+t))); }
function cycle(engine: SeatedElbowAnalyzer, offset = 0, endpoint = 90, incomplete = false) {
  ready(engine,offset);
  [150,200,250].forEach((t)=>engine.accept(frame(offset+t,150)));
  [300,350,400,450,500].forEach((t)=>engine.accept(frame(offset+t,incomplete?130:endpoint)));
  [550,600,650].forEach((t)=>engine.accept(frame(offset+t,140)));
  [700,750,800].forEach((t)=>engine.accept(frame(offset+t)));
  engine.advance(offset+801);
}
describe('SR02 angle-driven bend and straighten', () => {
  it('measures minimum angle, excursion and distinct bend/return timing', () => {
    const engine=new SeatedElbowAnalyzer(config()); cycle(engine);
    const a=engine.drain()[0]!;
    expect(a.classification).toBe('measurable');
    expect(a).toMatchObject({startMs:150,endpointMs:300,returnStartMs:550,endMs:800});
    expect(a.metrics.minElbowDeg.value).toBeCloseTo(90);
    expect(a.metrics.bendExcursionDeg.value).toBeCloseTo(90);
    expect(a.metrics.bendDurationSec.value).toBe(0.15);
    expect(a.metrics.returnDurationSec.value).toBe(0.15);
    expect(a.metrics.torsoForwardPeakDeg.value).toBe(0);
    expect(engine.drain()).toEqual([]);
  });
  it('produces 12/10/2/4 with strict criteria and no invented excluded values', () => {
    const c=config(); c.settings.endpointToleranceDeg=21; c.criteria=[{metric:'minElbowDeg',operator:'<',threshold:100}];
    const engine=new SeatedElbowAnalyzer(c); const results:ElbowAttempt[]=[];
    for(let i=0;i<12;i++){cycle(engine,i*1000,i<4?90:110,i>=10);results.push(...engine.drain());}
    expect(results).toHaveLength(12);
    expect(results.filter((a)=>a.classification==='measurable')).toHaveLength(10);
    expect(results.filter((a)=>a.flags.length)).toHaveLength(4);
    expect(summarizeElbow(results)).toMatchObject({detected:12,measurable:10,excluded:2,flagged:4,flagRate:0.4});
    expect(results[10]!.metrics.minElbowDeg.value).toBeNull(); expect(results[10]!.reasons).toContain('ENDPOINT_NOT_REACHED');
  });
  it('held endpoint counts once and later deeper bend cannot change outward minimum', () => {
    const engine=new SeatedElbowAnalyzer(config()); ready(engine);
    [150,200,250].forEach((t)=>engine.accept(frame(t,150)));
    engine.accept(frame(300,90)); [350,400].forEach((t)=>engine.accept(frame(t,90)));
    [450,500,550,600].forEach((t)=>engine.accept(frame(t,60)));
    [650,700,750].forEach((t)=>engine.accept(frame(t)));
    engine.advance(751); const a=engine.drain()[0]!;
    expect(a.classification).toBe('measurable'); expect(a.metrics.minElbowDeg.value).toBeCloseTo(90);
    expect(a.returnStartMs).toBe(650); expect(a.metrics.returnDurationSec.value).toBe(0);
  });
  it('equality is not flagged and disabled criteria stay disabled', () => {
    const c=config(); c.criteria=[{metric:'bendDurationSec',operator:'>',threshold:0.15},{metric:'returnDurationSec',operator:'<',threshold:0.15}];
    const engine=new SeatedElbowAnalyzer(c); cycle(engine); expect(engine.drain()[0]!.flags).toEqual([]);
  });
  it.each(['STOPPED_EARLY','DISCOMFORT_STOP','SETUP_CHANGED'] as const)('same-time %s overrides completion exactly once',(reason)=>{
    const engine=new SeatedElbowAnalyzer(config()); ready(engine);
    [150,200,250].forEach((t)=>engine.accept(frame(t,150)));
    [300,350,400].forEach((t)=>engine.accept(frame(t,90)));
    [450,500,550].forEach((t)=>engine.accept(frame(t)));
    engine.interrupt(550,reason); engine.interrupt(550,reason); engine.advance(900);
    const results=engine.drain(); expect(results).toHaveLength(1); expect(results[0]!.reasons).toContain(reason); expect(results[0]!.flags).toEqual([]);
  });
  it('outward gaps reset endpoint dwell and exclude unreliable peaks',()=>{
    const engine=new SeatedElbowAnalyzer(config()); ready(engine);
    [150,200,250].forEach((t)=>engine.accept(frame(t,150)));
    engine.accept(frame(300,90));engine.accept({...frame(350),landmarks:{}});
    [400,450,500].forEach((t)=>engine.accept(frame(t,90)));
    [550,600,650].forEach((t)=>engine.accept(frame(t)));
    engine.advance(651); const a=engine.drain()[0]!;
    expect(a.endpointMs).toBe(400);expect(a.reasons).toContain('CRITICAL_PEAK_GAP');expect(a.metrics.minElbowDeg.value).toBeNull();
  });
  it('watchdog handles silence and rejects late results until rest is reacquired',()=>{
    const engine=new SeatedElbowAnalyzer(config());ready(engine);
    [150,200,250].forEach((t)=>engine.accept(frame(t,150)));
    engine.advance(451);engine.accept(frame(400,90));expect(engine.drain()[0]!.reasons).toContain('TRACKING_GAP');
    cycle(engine,1000);expect(engine.drain()[0]!.classification).toBe('measurable');
  });
  it('times out despite continuing valid observations',()=>{
    const engine=new SeatedElbowAnalyzer(config());ready(engine);
    for(let t=150;t<=2200;t+=50) engine.accept(frame(t,150));
    expect(engine.drain()[0]!.reasons).toContain('TIMEOUT');
  });
  it('retains anatomy and angle metrics when reflected to the right side',()=>{
    const c=config();c.side='right';c.forwardSign=-1;
    for(const p of Object.values(c.baseline))p.x=400-p.x;
    const engine=new SeatedElbowAnalyzer(c);
    const feed=(t:number,angle:number)=>{const f=frame(t,angle);f.side='right';for(const p of Object.values(f.landmarks))if(p)p.x=1-p.x;engine.accept(f);};
    [0,50,100].forEach((t)=>feed(t,180));[150,200,250].forEach((t)=>feed(t,150));[300,350,400].forEach((t)=>feed(t,90));[450,500,550].forEach((t)=>feed(t,180));
    engine.advance(551);const a=engine.drain()[0]!;expect(a.side).toBe('right');expect(a.metrics.minElbowDeg.value).toBeCloseTo(90);
  });
  it('validates angular regions and does not accept a reach target in its contract',()=>{
    const c=config();expect(()=>new SeatedElbowAnalyzer({...c,target:{x:1,y:1}})).toThrow();
    c.endpointDeg=175;expect(()=>new SeatedElbowAnalyzer(c)).toThrow('distinct');
  });
  it('copies configuration and handles delayed frames while watchdog advances',()=>{
    const c=config(),engine=new SeatedElbowAnalyzer(c);c.endpointDeg=0;
    for(const [t,angle] of [[0,180],[50,180],[100,180],[150,150],[200,150],[250,150],[300,90],[350,90],[400,90],[450,180],[500,180],[550,180]]) {
      engine.advance(t!+10);engine.accept(frame(t!,angle!));
    }
    engine.advance(570);expect(engine.drain()[0]!.classification).toBe('measurable');
  });
  it('does not invent empty medians or merge incompatible groups',()=>{
    expect(summarizeElbow([])).toMatchObject({detected:0,flagRate:null,medians:{minElbowDeg:null}});
    const engine=new SeatedElbowAnalyzer(config());cycle(engine);const a=engine.drain()[0]!;
    expect(()=>summarizeElbow([a,a])).toThrow('Duplicate');
    expect(()=>summarizeElbow([a,{...a,id:'other',configurationId:'other'}])).toThrow('incompatible');
  });
  it('rejected-only arrivals still finalize a tracking-loss exclusion',()=>{
    const engine=new SeatedElbowAnalyzer(config());ready(engine);
    [150,200,250].forEach((t)=>engine.accept(frame(t,150)));
    for(let t=300;t<=600;t+=50)engine.accept({...frame(t),landmarks:{}});
    const results=engine.drain();expect(results).toHaveLength(1);expect(results[0]!.reasons).toContain('TRACKING_GAP');
  });
  it('setup changes stop the engine even when the frame arrives behind the watchdog clock',()=>{
    const engine=new SeatedElbowAnalyzer(config());ready(engine);
    [150,200,250].forEach((t)=>engine.accept(frame(t,150)));
    engine.advance(320);engine.accept({...frame(300,90),width:300});cycle(engine,1000);
    const results=engine.drain();expect(results).toHaveLength(1);expect(results[0]!.reasons).toContain('SETUP_CHANGED');
  });
});
