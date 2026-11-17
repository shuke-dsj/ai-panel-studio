import { useEffect,useRef } from 'react';
import { ArrowRight,LoaderCircle,RefreshCw,Users } from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import { Avatar,ErrorBanner,SourceNotice } from '../components/Primitives';
export function Roster({snapshot,error,pending,command}:{snapshot:Snapshot;error:string;pending:string;command:(action:string)=>Promise<void>}){
 const attempted=useRef(false);const d=snapshot.discussion;const busy=!!pending||d.status==='generating';
 useEffect(()=>{if(!attempted.current&&d.status==='draft'&&!d.error){attempted.current=true;void command('roster');}},[d.status,d.error,command]);
 return <main className="roster-scroll"><section className="roster-content"><div className="roster-heading"><span className="step-text">01 阵容确认 <span>→</span> 02 进入演播厅</span><h1>{d.topic}</h1><p>不同专业、不同立场。确认这桌嘉宾，开始一场有来有往的讨论。</p></div><SourceNotice source={d.source}/>{(error||d.error)&&<ErrorBanner>{error||d.error}</ErrorBanner>}
 {busy&&<div className="generation-notice" role="status"><LoaderCircle className="spin" size={18}/>正在围绕议题寻找不同视角，生成虚构嘉宾阵容…</div>}
 {snapshot.participants.length===0&&!busy?<div className="empty-state"><Users size={32}/><h3>嘉宾尚未就位</h3><p>生成一位主持人与 {d.expertCount} 位专家，再确认进入演播厅。</p></div>:<div className="roster-grid">{snapshot.participants.map(p=><article className={`roster-card ${p.role==='moderator'?'host':''}`} key={p.id}><div className="roster-person"><Avatar person={p}/><div><h2>{p.name}<span>{p.role==='moderator'?'主持人':'专家'}</span></h2><p>{p.occupation}</p></div></div><div className="role-title">{p.title}</div><h3>讨论立场</h3><p>{p.stance}</p><h3>关注领域</h3><p className="muted">{p.focus}</p></article>)}</div>}
 <div className="roster-actions"><span className="muted">确认后锁定阵容 · 最多 {d.maxTurns} 次专家发言</span><div><button className="button" disabled={busy} onClick={()=>void command('roster')}><RefreshCw size={16}/>{snapshot.participants.length?'重新生成阵容':'生成阵容'}</button><button className="button primary" disabled={busy||d.status!=='roster_ready'} onClick={()=>void command('confirm')}><ArrowRight size={16}/>确认并进入演播厅</button></div></div></section></main>;
}
