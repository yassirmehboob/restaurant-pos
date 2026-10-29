import { ArrowUpRight, Check, ChefHat, ShieldCheck, UtensilsCrossed } from "lucide-react";
import "./auth.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell auth-refresh">
      <section className="auth-brand">
        <div className="auth-wordmark"><span><UtensilsCrossed size={23} aria-hidden="true" /></span>Restaurant <strong>POS</strong></div>
        <div className="auth-brand-content">
          <p className="auth-kicker"><span /> MADE FOR YOUR DAILY SERVICE</p>
          <h1>Great service starts<br />with a clear view.</h1>
          <p className="brand-copy">From the first order to the final bill, keep your team and your restaurant in sync.</p>
          <div className="service-preview" aria-hidden="true">
            <div className="service-preview-heading"><span><UtensilsCrossed size={17} /> Your service, in sync</span><span className="preview-live">Live overview</span></div>
            <div className="preview-order"><span className="preview-table">04</span><strong>Table 04<small>Dine-in · 2 guests</small></strong><span className="preview-status">In progress</span></div>
            <div className="preview-items"><span>Margherita pizza <small>× 1</small></span><span>Fresh lemonade <small>× 2</small></span></div>
            <div className="preview-flow"><span><Check size={13} /> Order taken</span><i /><span><ChefHat size={15} /> In the kitchen</span><ArrowUpRight size={17} /></div>
          </div>
          <div className="auth-benefits"><span><Check size={15} /> Orders in one place</span><span><Check size={15} /> A connected team</span></div>
        </div>
        <p className="auth-brand-footer"><ShieldCheck size={16} /> One workspace. Every part of your restaurant.</p>
      </section>
      <section className="auth-panel">{children}<p className="auth-panel-footer"><ShieldCheck size={15} aria-hidden="true" /> Secure access for owners and staff</p></section>
    </main>
  );
}
