import type { ReactNode } from 'react';
import { AlertCircle,ArrowLeft,ArrowUpRight,Folder,Radio,Plus } from 'lucide-react';
import type { Participant,Status } from '../../shared/types';
import { statusLabels } from '../../shared/types';
import type { Health } from '../lib/api';
export function BrandHeader({back=false,health,onCreate}:{back?:boolean;health:Health|null;onCreate?:()=>void}){return <header className="brand-header"><a className="brand" href="#/"><span className="brand-mark"><Radio size={19}/></span>Panel Studio</a><nav><a className={!back?'selected':''} href="#/">{back&&<ArrowLeft size={15}/>}所有讨论</a></nav><div className="workspace-label"><Folder size={16}/><span>本地工作空间</span></div>{health?.mode==='demo'&&<span className="mode-tag">演示模式</span>}{health?.mode==='real'&&!health.configured&&<span className="mode-tag warning">模型待配置</span>}{onCreate&&<button className="button primary compact" onClick={onCreate}><Plus size={16}/>新建讨论</button>}</header>;}
export function Avatar({person,small=false}:{person:Participant;small?:boolean}){return <span className={`avatar ${small?'small':''}`} style={{background:person.color}} aria-hidden="true">{person.name.slice(0,1)}</span>;}
export function StatusLabel({status}:{status:Status}){return <span className={`status-label ${status}`}><span className="status-dot"/>{statusLabels[status]}</span>;}
export function ErrorBanner({children}:{children:ReactNode}){return <div className="error-banner" role="alert"><AlertCircle size={17}/><span>{children}</span></div>;}
export function SourceNotice({source}:{source:string}){if(source==='curated')return <div className="source-notice">人工编写示例 · 用于展示讨论结构，不代表真实模型运行结果。</div>;if(source==='test')return <div className="source-notice">演示模式 · 使用确定性测试模型，内容不代表真实 AI 输出。</div>;if(source==='real-example')return <div className="source-notice">真实模型生成示例 · 仍需人工审阅，生成观点未经外部核实。</div>;return null;}
export function EmptyState({title,children}:{title:string;children?:ReactNode}){return <div className="empty-state"><Radio size={30}/><h3>{title}</h3><p>{children}</p></div>;}
export function Footer(){return <footer className="app-footer"><span>AI 生成内容，请独立判断</span><a href="#/">Panel Studio <ArrowUpRight size={12}/></a></footer>;}
