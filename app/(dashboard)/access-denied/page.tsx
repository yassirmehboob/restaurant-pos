import Link from "next/link";
export default function AccessDeniedPage(){return <main className="master-page"><h1>Access restricted</h1><p>Your account does not have permission to open this page. Ask the restaurant owner to update your privileges.</p><Link href="/dashboard">Return to dashboard</Link></main>}
