import Link from "next/link";import { ChevronRight } from "lucide-react";
export function MasterHeader({eyebrow,title,description}:{eyebrow:string;title:string;description:string}){return <header className="master-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><Link href="/dashboard">Dashboard <ChevronRight size={16}/></Link></header>}
