import { useCallback,useEffect,useRef,useState } from 'react';
import type { Activity,Discussion,Insight,Message,PanelEvent,Participant,Snapshot } from '../../shared/types';
import { api } from './api';
export function applyEvent(s:Snapshot,event:PanelEvent):Snapshot {
 if(event.discussionId!==s.discussion.id||event.seq<=s.cursor)return s;
 const next={...s,cursor:event.seq};
 if(['status','completed','error'].includes(event.type))next.discussion=event.data as Discussion;
 if(event.type==='activity'){const value=event.data as Activity&{participantId:string};next.activities={...s.activities,[value.participantId]:{state:value.state,focus:value.focus}};}
 if(event.type==='roster'){next.participants=event.data as Participant[];next.activities={};next.discussion={...s.discussion,status:'roster_ready',error:null};}
 if(event.type==='insights')next.insights=event.data as Insight[];
 if(event.type==='message'){const m=event.data as Message;if(!s.messages.some(old=>old.id===m.id)){next.messages=[...s.messages,m];next.discussion={...s.discussion,turns:s.discussion.turns+(s.participants.find(p=>p.id===m.participantId)?.role==='expert'?1:0),updatedAt:m.createdAt};}}
 return next;
}
export function usePanel(id:string){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);const [error,setError]=useState('');const [pending,setPending]=useState('');const [connection,setConnection]=useState<'connecting'|'connected'|'reconnecting'>('connecting');const generation=useRef(0);
 const accept=useCallback((incoming:Snapshot)=>setSnapshot(old=>!old||old.discussion.id!==incoming.discussion.id||incoming.cursor>=old.cursor?incoming:old),[]);
 useEffect(()=>{
  const run=++generation.current;let stream:EventSource|undefined;setSnapshot(null);setError('');setConnection('connecting');
  api.snapshot(id).then(s=>{if(run!==generation.current)return;accept(s);stream=new EventSource(`/api/discussions/${id}/events?after=${s.cursor}`);stream.onopen=()=>setConnection('connected');stream.onerror=()=>setConnection('reconnecting');stream.addEventListener('update',event=>{if(run!==generation.current)return;try{const update=JSON.parse((event as MessageEvent).data) as PanelEvent;setSnapshot(old=>old?applyEvent(old,update):old);}catch{setError('实时事件格式异常，请刷新恢复。');}});}).catch(e=>{if(run===generation.current)setError(e.message);});
  return()=>{generation.current++;stream?.close();};
 },[id,accept]);
 const command=useCallback(async(action:string)=>{const run=generation.current;setPending(action);setError('');try{const s=await api.command(id,action);if(run===generation.current)accept(s);}catch(e){if(run===generation.current){setError(e instanceof Error?e.message:'操作失败');try{accept(await api.snapshot(id));}catch{/* retain existing state */}}}finally{if(run===generation.current)setPending('');}},[id,accept]);
 return{snapshot,error,pending,connection,command};
}
