import { z } from 'zod';
import { reachConfigSchema, REACH_JOINTS, reasonText, type ReachFrame, type PixelPose, type Reason, type Interruption } from './reach-contract.js';
import { pixelObservation, distance } from './reach-geometry.js';

const finite = z.number().finite();
const units = { minElbowDeg: 'degrees', bendExcursionDeg: 'degrees', torsoForwardPeakDeg: 'degrees', bendDurationSec: 'seconds', returnDurationSec: 'seconds' } as const;
type Metric = keyof typeof units;
type ElbowReason = Exclude<Reason, 'TARGET_NOT_REACHED'> | 'ENDPOINT_NOT_REACHED';
export const elbowConfigSchema = reachConfigSchema.omit({ reference: true, target: true, settings: true, criteria: true }).extend({
  forwardSign: z.union([z.literal(-1), z.literal(1)]), endpointDeg: finite.min(0).max(180),
  settings: reachConfigSchema.shape.settings.omit({ minReferencePx: true, minForwardPx: true, restRadius: true, targetRadius: true, onsetDistance: true, returnHysteresis: true, targetDwellMs: true }).extend({
    endpointDwellMs: finite.positive(), restToleranceDeg: finite.positive(), endpointToleranceDeg: finite.positive(), onsetExcursionDeg: finite.positive(), returnHysteresisDeg: finite.positive(),
  }),
  criteria: z.array(z.strictObject({ metric: z.enum(['minElbowDeg', 'bendExcursionDeg', 'torsoForwardPeakDeg', 'bendDurationSec', 'returnDurationSec']), operator: z.enum(['<', '>']), threshold: finite })),
});
export type ElbowConfig = z.infer<typeof elbowConfigSchema>;
export type ElbowObservation = { timestampMs: number; raw: PixelPose; filtered: PixelPose; elbowDeg: number; torsoDeltaDeg: number };
export type ElbowAttempt = {
  id: string; sessionId: string; configurationId: string; analysisVersion: string;
  exerciseId: 'seated_elbow_flexion_extension'; mode: ElbowConfig['mode']; side: ElbowConfig['side'];
  startMs: number; endpointMs: number | null; returnStartMs: number | null; endMs: number;
  classification: 'measurable' | 'excluded'; reasons: ElbowReason[]; explanations: string[];
  metrics: Record<Metric, { value: number | null; unit: string; reasons: ElbowReason[] }>;
  quality: { coverage: number; longestGapMs: number; observationCount: number };
  flags: { metric: Metric; operator: '<' | '>'; threshold: number; observed: number; replay: { startMs: number; endMs: number }; explanation: string }[];
  observations: ElbowObservation[]; evidence: { status: 'unavailable'; reason: string };
};
type Entry = { time: number; observation: ElbowObservation | null; reason: ElbowReason | null };
type Active = { start: number; endpoint: number | null; returnStart: number | null; restTime: number | null; completion: number | null; endpointMinimum: number; entries: Entry[]; reasons: Set<ElbowReason> };
type State = 'REACQUIRE_REST' | 'REST' | 'BENDING' | 'BEND_ENDPOINT' | 'STRAIGHTENING';
const angle = (p: PixelPose) => {
  const { shoulder: a, elbow: b, wrist: c } = p;
  return Math.acos(Math.max(-1, Math.min(1, ((a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y)) / (distance(a,b)*distance(c,b))))) * 180 / Math.PI;
};
const inclination = (p: PixelPose) => Math.atan2(p.shoulder.x-p.hip.x, -(p.shoulder.y-p.hip.y)) * 180 / Math.PI;
const wrap = (v: number) => ((v+180)%360+360)%360-180;
const validSegments = (p: PixelPose, minimum: number) => distance(p.shoulder,p.elbow)>=minimum && distance(p.wrist,p.elbow)>=minimum && distance(p.shoulder,p.hip)>=minimum;

/** SR02 only: comparatively straight baseline -> bend endpoint -> baseline return.
 * Host clocks, interruption precedence and drain semantics match the reach engine.
 * It never uses a reach target or wrist-displacement state driver.
 */
export class SeatedElbowAnalyzer {
  private readonly config: ElbowConfig;
  private readonly restAngle: number;
  private phase: State = 'REACQUIRE_REST';
  private clock = -1; private lastFrame = -1; private barrier = -1; private lastValid: number | null = null;
  private previous: ElbowObservation | null = null;
  private dwell = new Map<string, number>(); private onset: ElbowObservation[] = [];
  private active: Active | null = null; private nextId = 1; private stopped = false; private results: ElbowAttempt[] = [];
  constructor(input: unknown) {
    this.config = elbowConfigSchema.parse(structuredClone(input));
    const c = this.config, s = c.settings;
    if (!validSegments(c.baseline,s.minSegmentPx) || Object.values(c.baseline).some((p) => p.x<0 || p.y<0 || p.x>c.frameWidth || p.y>c.frameHeight)) throw new Error('Invalid elbow baseline');
    this.restAngle = angle(c.baseline);
    if (c.endpointDeg-s.endpointToleranceDeg<0 || c.endpointDeg+s.endpointToleranceDeg>=this.restAngle-s.onsetExcursionDeg ||
        s.onsetExcursionDeg<=s.restToleranceDeg || s.returnHysteresisDeg>=this.restAngle-c.endpointDeg-s.restToleranceDeg ||
        s.sampleSupportMs>s.maxGapMs || s.filterResetGapMs>s.maxGapMs ||
        [s.readinessMs,s.onsetDwellMs,s.endpointDwellMs,s.returnDwellMs].some((v)=>v>=s.timeoutMs)) throw new Error('Elbow endpoint, rest and onset regions must be distinct');
  }
  get state(): State { return this.phase; }
  get configuration(): ElbowConfig { return structuredClone(this.config); }
  drain(): ElbowAttempt[] { const out=this.results; this.results=[]; return out; }
  advance(now: number): void {
    if (this.stopped || !Number.isFinite(now) || now<0 || now<this.clock) return;
    this.clock=now;
    if (this.active?.completion !== null && this.active?.completion !== undefined && now>this.active.completion) { this.finish(this.active.completion,[]); this.phase='REST'; }
    const reasons: ElbowReason[]=[];
    if (this.active && now-this.active.start>=this.config.settings.timeoutMs) reasons.push('TIMEOUT');
    if (this.lastValid !== null && now-this.lastValid>this.config.settings.maxGapMs) reasons.push('TRACKING_GAP');
    if (reasons.length) { this.finish(now,reasons); this.barrier=now; this.reacquire(); }
  }
  interrupt(now: number, reason: Interruption): void {
    if (this.stopped || !Number.isFinite(now) || now<0 || now<this.clock) return;
    this.advance(now); this.finish(now,[reason]); this.reacquire(); this.stopped=true;
  }
  accept(frame: ReachFrame): void {
    const time=frame.timestampMs, c=this.config, s=c.settings;
    if (this.stopped || !Number.isFinite(time) || time<0 || time<=this.lastFrame || time<=this.barrier) return;
    this.advance(Math.max(time,this.clock)); if (time<this.barrier) return; this.lastFrame=time;
    if (frame.side!==c.side || frame.width!==c.frameWidth || frame.height!==c.frameHeight || frame.orientation!==c.orientation) { this.interrupt(Math.max(time,this.clock),'SETUP_CHANGED'); return; }
    if (this.active?.completion !== null && this.active?.completion !== undefined) return;
    if (this.lastValid !== null && time-this.lastValid>s.sampleSupportMs) { this.resetDwell(); if (this.active && this.phase==='BENDING') this.active.reasons.add('CRITICAL_PEAK_GAP'); }
    const converted=pixelObservation(frame,c);
    if (converted.reason) { this.reject(time,converted.reason as ElbowReason); return; }
    if (this.previous && time-this.previous.timestampMs>s.filterResetGapMs) this.previous=null;
    const raw=converted.pose, filtered={} as PixelPose;
    const alpha=!this.previous || s.smoothingTauMs===0 ? 1 : 1-Math.exp(-(time-this.previous.timestampMs)/s.smoothingTauMs);
    for (const key of REACH_JOINTS) { const old=this.previous?.filtered[key]??raw[key]; filtered[key]={x:old.x+alpha*(raw[key].x-old.x),y:old.y+alpha*(raw[key].y-old.y)}; }
    if (!validSegments(filtered,s.minSegmentPx)) { this.reject(time,'DEGENERATE_GEOMETRY'); return; }
    const observation: ElbowObservation={timestampMs:time,raw,filtered,elbowDeg:angle(filtered),torsoDeltaDeg:c.forwardSign*wrap(inclination(filtered)-inclination(c.baseline))};
    this.previous=observation; this.lastValid=time;
    if (this.active) { this.active.entries.push({time,observation,reason:null}); if (this.active.entries.length>10_000) { this.finish(time,['BUFFER_LIMIT']); this.reacquire(); return; } }
    const resting=Math.abs(observation.elbowDeg-this.restAngle)<=s.restToleranceDeg;
    const endpoint=Math.abs(observation.elbowDeg-c.endpointDeg)<=s.endpointToleranceDeg;
    if (this.phase==='REACQUIRE_REST') { if (this.confirm('ready',resting,time,s.readinessMs)!==null) { this.phase='REST'; this.resetDwell(); this.previous=null; } return; }
    if (this.phase==='REST') {
      const bending=!resting && this.restAngle-observation.elbowDeg>s.onsetExcursionDeg;
      if (bending) this.onset.push(observation); else this.onset=[];
      if (this.onset.length>10_000) { this.reacquire(); return; }
      const first=this.confirm('onset',bending,time,s.onsetDwellMs);
      if (first!==null) {
        const buffer=this.onset;
        this.active={start:first,endpoint:null,returnStart:null,restTime:null,completion:null,endpointMinimum:Infinity,entries:buffer.map((o)=>({time:o.timestampMs,observation:o,reason:null})),reasons:new Set()};
        this.phase='BENDING'; this.resetDwell();
        for (const o of buffer) { const found=this.confirm('endpoint',Math.abs(o.elbowDeg-c.endpointDeg)<=s.endpointToleranceDeg,o.timestampMs,s.endpointDwellMs); if (found!==null) { this.enterEndpoint(found); break; } }
      }
      return;
    }
    const a=this.active; if (!a) return;
    if (this.phase==='BENDING') {
      const found=this.confirm('endpoint',endpoint,time,s.endpointDwellMs);
      if (found!==null) this.enterEndpoint(found);
      else if (this.confirm('early',resting,time,s.returnDwellMs)!==null) { this.finish(time,['ENDPOINT_NOT_REACHED']); this.phase='REST'; }
      return;
    }
    if (this.phase==='BEND_ENDPOINT') {
      a.endpointMinimum=Math.min(a.endpointMinimum,observation.elbowDeg);
      const returnStart=this.confirm('departure',observation.elbowDeg-a.endpointMinimum>s.returnHysteresisDeg,time,s.returnDwellMs);
      const restTime=this.confirm('rest',resting,time,s.returnDwellMs);
      if (returnStart!==null) { a.returnStart=returnStart; this.phase='STRAIGHTENING'; }
      if (restTime!==null && a.returnStart!==null) { a.restTime=restTime; a.completion=time; }
      return;
    }
    if (this.phase==='STRAIGHTENING') { const restTime=this.confirm('rest',resting,time,s.returnDwellMs); if (restTime!==null) { a.restTime=restTime; a.completion=time; } }
  }
  private enterEndpoint(time: number): void {
    const a=this.active!; a.endpoint=time;
    a.endpointMinimum=Math.min(...a.entries.filter((e)=>e.time>=time && e.observation).map((e)=>e.observation!.elbowDeg));
    this.phase='BEND_ENDPOINT'; this.resetDwell();
  }
  private confirm(key:string,condition:boolean,time:number,duration:number):number|null {
    if (!condition) { this.dwell.delete(key); return null; }
    const first=this.dwell.get(key)??time; this.dwell.set(key,first); return time-first>=duration?first:null;
  }
  private resetDwell():void { this.dwell.clear(); this.onset=[]; }
  private reacquire():void { this.phase='REACQUIRE_REST'; this.resetDwell(); this.previous=null; this.lastValid=null; }
  private reject(time:number,reason:ElbowReason):void {
    this.resetDwell(); if (!this.active) return;
    this.active.entries.push({time,observation:null,reason});
    if (this.phase==='BENDING') this.active.reasons.add('CRITICAL_PEAK_GAP');
    if (this.active.entries.length>10_000) { this.finish(time,['BUFFER_LIMIT']); this.reacquire(); }
  }
  private finish(end:number,extra:ElbowReason[]):void {
    const a=this.active; if (!a) return; this.active=null; this.resetDwell(); this.previous=null;
    const s=this.config.settings, reasons=new Set<ElbowReason>([...a.reasons,...extra]);
    if (a.endpoint===null) reasons.add('ENDPOINT_NOT_REACHED');
    if (a.completion===null && !extra.includes('ENDPOINT_NOT_REACHED')) reasons.add('RETURN_NOT_OBSERVED');
    let cursor=a.start,support=0,longestGapMs=0;
    for (const [i,e] of a.entries.entries()) { if (!e.observation) continue; const until=Math.min(end,e.time+s.sampleSupportMs,a.entries[i+1]?.time??end); longestGapMs=Math.max(longestGapMs,e.time-cursor); support+=Math.max(0,until-e.time); cursor=Math.max(cursor,until); }
    longestGapMs=Math.max(longestGapMs,end-cursor);
    const observations=a.entries.flatMap((e)=>e.observation?[e.observation]:[]), coverage=end>a.start?support/(end-a.start):0;
    if (coverage<s.minCoverage) reasons.add('INSUFFICIENT_COVERAGE');
    if (longestGapMs>s.maxGapMs) reasons.add('TRACKING_GAP');
    if (observations.length<s.minObservations) reasons.add('INSUFFICIENT_OBSERVATIONS');
    if (reasons.size) for (const e of a.entries) if (e.reason) reasons.add(e.reason);
    const measurable=reasons.size===0, outward=observations.filter((o)=>a.endpoint!==null && o.timestampMs<=a.endpoint);
    const min=measurable?Math.min(...outward.map((o)=>o.elbowDeg)):null;
    const values:Record<Metric,number|null>={minElbowDeg:min,bendExcursionDeg:min===null?null:this.restAngle-min,torsoForwardPeakDeg:measurable?Math.max(0,...outward.map((o)=>o.torsoDeltaDeg)):null,
      bendDurationSec:measurable?(a.endpoint!-a.start)/1000:null,returnDurationSec:measurable?(a.restTime!-a.returnStart!)/1000:null};
    const list=[...reasons];
    const metrics=Object.fromEntries((Object.keys(units) as Metric[]).map((key)=>[key,{value:values[key],unit:units[key],reasons:[...list]}])) as ElbowAttempt['metrics'];
    const flags:ElbowAttempt['flags']=[];
    if (measurable) for (const criterion of this.config.criteria) { const observed=values[criterion.metric]!; if (criterion.operator==='>'?observed>criterion.threshold:observed<criterion.threshold) flags.push({...criterion,observed,replay:{startMs:a.start,endMs:end},explanation:`${criterion.metric} ${observed} ${units[criterion.metric]} exceeded configured ${criterion.operator} ${criterion.threshold}. Review replay.`}); }
    this.results.push({id:`${this.config.sessionId}:elbow:${this.nextId++}`,sessionId:this.config.sessionId,configurationId:this.config.configurationId,analysisVersion:this.config.version,
      exerciseId:'seated_elbow_flexion_extension',mode:this.config.mode,side:this.config.side,startMs:a.start,endpointMs:a.endpoint,returnStartMs:a.returnStart,endMs:end,
      classification:measurable?'measurable':'excluded',reasons:list,explanations:list.map((r)=>r==='ENDPOINT_NOT_REACHED'?'The configured bend endpoint was not observed.':reasonText[r]),
      metrics,flags,quality:{coverage,longestGapMs,observationCount:observations.length},observations,evidence:{status:'unavailable',reason:'Capture/replay integration and physical-device verification pending.'}});
  }
}

export function summarizeElbow(attempts: ElbowAttempt[]) {
  const groups = new Set(attempts.map((a) => `${a.mode}/${a.exerciseId}/${a.configurationId}/${a.analysisVersion}`));
  if (groups.size > 1) throw new Error('Cannot summarize incompatible elbow configurations');
  if (new Set(attempts.map((a) => a.id)).size !== attempts.length) throw new Error('Duplicate attempt IDs');
  const measurable = attempts.filter((a) => a.classification === 'measurable');
  const flagged = measurable.filter((a) => a.flags.length > 0).length;
  const medians = Object.fromEntries((Object.keys(units) as Metric[]).map((key) => {
    const values = measurable.flatMap((a) => a.metrics[key].value === null ? [] : [a.metrics[key].value!]).sort((a,b) => a-b);
    return [key, values.length ? (values[Math.floor((values.length-1)/2)]! + values[Math.floor(values.length/2)]!) / 2 : null];
  }));
  return { detected: attempts.length, measurable: measurable.length, excluded: attempts.length-measurable.length, flagged,
    flagRate: measurable.length ? flagged/measurable.length : null, medians };
}
