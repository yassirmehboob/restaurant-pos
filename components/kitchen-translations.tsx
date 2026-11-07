"use client";
import { useMemo,useRef,useState } from "react";
import { Check,CheckCheck,Languages,LoaderCircle,Square,TriangleAlert } from "lucide-react";
import { approveSuggestions,saveTranslation,suggestTranslations } from "@/app/(dashboard)/settings/translations/actions";
import { LOCAL_LANGUAGE_LABELS,type LocalLanguage } from "@/lib/kitchen-language";
import "./kitchen-translations.css";

type Status=""|"SUGGESTED"|"APPROVED";
export type TranslationRow={text:string;kind:"Item"|"Size"|"Deal";sd:string;sdStatus:Status;ur:string;urStatus:Status};
type Filter="ALL"|"REVIEW"|"MISSING";
// Each request suggests a few names (about 2.5 s each on a counter PC), so progress shows and Stop is quick.
const CHUNK=3;

export function KitchenTranslations({rows:initial,initialLanguage,modelReady,modelFolder}:{rows:TranslationRow[];initialLanguage:LocalLanguage;modelReady:boolean;modelFolder:string}){
  const[rows,setRows]=useState(initial),[language,setLanguage]=useState<LocalLanguage>(initialLanguage),[filter,setFilter]=useState<Filter>("ALL");
  const[drafts,setDrafts]=useState<Record<string,string>>({}),[saving,setSaving]=useState<string|null>(null),[message,setMessage]=useState<{text:string;ok:boolean}|null>(null);
  const[progress,setProgress]=useState<{done:number;total:number}|null>(null),stopped=useRef(false);
  const label=LOCAL_LANGUAGE_LABELS[language],statusOf=(row:TranslationRow)=>row[`${language}Status`],draftKey=(row:TranslationRow)=>`${language}:${row.text}`;
  const valueOf=(row:TranslationRow)=>drafts[draftKey(row)]??row[language];
  const counts=useMemo(()=>({approved:rows.filter(row=>row[`${language}Status`]==="APPROVED").length,review:rows.filter(row=>row[`${language}Status`]==="SUGGESTED").length,missing:rows.filter(row=>!row[language]).length}),[rows,language]);
  const shown=rows.filter(row=>filter==="ALL"||(filter==="REVIEW"?statusOf(row)==="SUGGESTED":!row[language]));
  const update=(text:string,patch:Partial<TranslationRow>)=>setRows(current=>current.map(row=>row.text===text?{...row,...patch}:row));

  const save=async(row:TranslationRow)=>{
    const value=valueOf(row).trim();setSaving(row.text);setMessage(null);
    try{
      const result=await saveTranslation({text:row.text,sd:language==="sd"?value:row.sd,ur:language==="ur"?value:row.ur});
      if(!result.ok){setMessage({text:result.message,ok:false});return}
      update(row.text,{[language]:value,[`${language}Status`]:value?"APPROVED":""});
      setDrafts(current=>{const next={...current};delete next[draftKey(row)];return next});
    }catch{setMessage({text:"Could not save. Check the connection and try again.",ok:false})}finally{setSaving(null)}
  };
  const suggest=async()=>{
    const targets=rows.filter(row=>!row[language]&&statusOf(row)!=="APPROVED").map(row=>row.text);
    if(!targets.length){setMessage({text:`Every name already has a ${label} translation.`,ok:true});return}
    stopped.current=false;setMessage(null);setProgress({done:0,total:targets.length});
    let filled=0,empty=0;
    try{
      for(let start=0;start<targets.length&&!stopped.current;start+=CHUNK){
        const result=await suggestTranslations({texts:targets.slice(start,start+CHUNK),language});
        if(!result.ok){setMessage({text:result.message,ok:false});return}
        for(const [text,suggestion] of Object.entries(result.suggestions)){if(suggestion){filled++;update(text,{[language]:suggestion,[`${language}Status`]:"SUGGESTED"})}else empty++}
        setProgress({done:Math.min(targets.length,start+CHUNK),total:targets.length});
      }
      setMessage({text:`${filled} ${label} ${filled===1?"suggestion":"suggestions"} added${empty?`, ${empty} could not be translated`:""}${stopped.current?" (stopped)":""}. Check each one, correct it if needed, and approve it. Only approved names print.`,ok:true});
      setFilter("REVIEW");
    }catch{setMessage({text:"The translator stopped unexpectedly. Try again.",ok:false})}finally{setProgress(null)}
  };
  const approveAll=async()=>{
    if(!window.confirm(`Approve all ${counts.review} ${label} suggestions as they are? They will print on kitchen tickets.`))return;
    setMessage(null);
    const result=await approveSuggestions(language);
    if(!result.ok){setMessage({text:result.message,ok:false});return}
    setRows(current=>current.map(row=>row[`${language}Status`]==="SUGGESTED"&&row[language]?{...row,[`${language}Status`]:"APPROVED"}:row));
    setMessage({text:`${result.approved} ${label} ${result.approved===1?"name":"names"} approved.`,ok:true});
  };

  const busy=Boolean(progress);
  return <section className="kt">
    <div className="kt-toolbar">
      <div className="kt-languages" role="tablist" aria-label="Language">{(["sd","ur"] as const).map(value=><button type="button" role="tab" aria-selected={language===value} className={language===value?"active":""} disabled={busy} key={value} onClick={()=>{setLanguage(value);setMessage(null)}}>{LOCAL_LANGUAGE_LABELS[value]}</button>)}</div>
      <div className="kt-counts"><span><b>{counts.approved}</b> approved</span><span className={counts.review?"is-review":""}><b>{counts.review}</b> to review</span><span><b>{counts.missing}</b> missing</span></div>
    </div>
    {!modelReady&&<p className="kt-alert"><TriangleAlert size={17}/>The offline translation model is not installed, so NLLB cannot suggest names. Run <code>npm run translation:download</code> once on the server (about 900 MB). Model folder: {modelFolder}. You can still type translations yourself.</p>}
    <div className="kt-actions">
      {busy?<><span className="kt-progress"><LoaderCircle className="kt-spin" size={16}/>Translating {progress!.done} of {progress!.total} with NLLB…</span><button type="button" onClick={()=>{stopped.current=true}}><Square size={14}/>Stop</button></>
      :<button type="button" className="kt-primary" disabled={!modelReady||!counts.missing} onClick={()=>void suggest()}><Languages size={16}/>Suggest missing {label} with NLLB</button>}
      <button type="button" disabled={busy||!counts.review} onClick={()=>void approveAll()}><CheckCheck size={16}/>Approve all {counts.review} suggestions</button>
      <div className="kt-filter" aria-label="Show">{([["ALL","All"],["REVIEW","To review"],["MISSING","Missing"]] as const).map(([value,text])=><button type="button" aria-pressed={filter===value} key={value} onClick={()=>setFilter(value)}>{text}</button>)}</div>
    </div>
    <p className="kt-note">Machine translations of dish names can be wrong (for example a meat named wrongly), so a suggestion prints only after you approve it. Names without an approved translation print in English.</p>
    {message&&<p className={`kt-message${message.ok?"":" is-error"}`} role={message.ok?"status":"alert"}>{message.text}</p>}
    <div className="kt-list">
      {shown.map(row=>{const status=statusOf(row),value=valueOf(row),changed=value.trim()!==row[language];
        return <div className="kt-row" key={row.text}>
          <div className="kt-english"><strong>{row.text}</strong><small>{row.kind}</small></div>
          <input dir="rtl" lang={language==="sd"?"sd":"ur"} className="kt-input" value={value} maxLength={300} placeholder={`${label} name`} aria-label={`${label} name for ${row.text}`} disabled={busy||saving===row.text} onChange={event=>setDrafts(current=>({...current,[draftKey(row)]:event.target.value}))}/>
          <span className={`kt-status is-${(status||"missing").toLowerCase()}`}>{changed?"Edited":status==="APPROVED"?"Approved":status==="SUGGESTED"?"NLLB suggestion":"Missing"}</span>
          <button type="button" className="kt-save" disabled={busy||saving===row.text||(!changed&&status!=="SUGGESTED")} onClick={()=>void save(row)}>{saving===row.text?<LoaderCircle className="kt-spin" size={15}/>:<Check size={15}/>}{status==="SUGGESTED"&&!changed?"Approve":"Save"}</button>
        </div>})}
      {!shown.length&&<p className="kt-empty">{filter==="REVIEW"?"No suggestions waiting for review.":filter==="MISSING"?`Every name has a ${label} translation.`:"No items on the menu yet."}</p>}
    </div>
  </section>;
}
