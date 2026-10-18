"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { DATE_PLACEHOLDER, dateISO, formatDate, isISODate, parseDisplayDate } from "@/lib/dates";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function DatePicker({ name, defaultValue = "", required = false, id, label }: {
  name: string; defaultValue?: string; required?: boolean; id?: string; label?: string;
}) {
  const [iso, setISO] = useState(defaultValue), [text, setText] = useState(defaultValue ? formatDate(defaultValue) : "");
  const [month, setMonth] = useState(() => (isISODate(defaultValue) ? defaultValue : dateISO()).slice(0, 7));
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), hidden = useRef<HTMLInputElement>(null), generatedId = useId();
  const titleId = `${generatedId}-title`, inputId = id ?? generatedId;
  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(), offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  useEffect(() => {
    const form = hidden.current?.form;
    const reset = () => { setISO(defaultValue); setText(defaultValue ? formatDate(defaultValue) : ""); input.current?.setCustomValidity(""); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue]);
  const choose = (value: string) => { setISO(value); setText(value ? formatDate(value) : ""); input.current?.setCustomValidity(""); dialog.current?.close(); input.current?.focus(); };
  const moveMonth = (amount: number) => { const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1)); setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`); };
  return <div className="date-picker">
    <input ref={hidden} type="hidden" name={name} value={iso}/>
    <div className="date-picker-control"><input ref={input} id={inputId} className="date-picker-text" value={text} onChange={event => { const next = event.target.value, parsed = parseDisplayDate(next); setText(next); setISO(parsed); event.target.setCustomValidity(next && !parsed ? `Enter a valid date as ${DATE_PLACEHOLDER}.` : ""); }} placeholder={DATE_PLACEHOLDER} aria-label={label ?? name.replace(/([A-Z])/g, " $1")} required={required} inputMode="numeric" autoComplete="off" maxLength={10}/><button type="button" className="date-picker-open" aria-label={`Choose ${label ?? name} date`} aria-haspopup="dialog" onClick={() => { setMonth((iso || dateISO()).slice(0, 7)); dialog.current?.showModal(); }}><CalendarDays size={19}/></button></div>
    <dialog ref={dialog} className="date-picker-dialog" aria-labelledby={titleId}>
      <header><div><span>{DATE_PLACEHOLDER}</span><h2 id={titleId}>{label ?? "Choose a date"}</h2></div><button type="button" aria-label="Close calendar" onClick={() => dialog.current?.close()}><X size={20}/></button></header>
      <div className="date-picker-month"><button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={20}/></button><select aria-label="Calendar month" value={monthNumber} onChange={event => setMonth(`${year}-${event.target.value.padStart(2, "0")}`)}>{months.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select><select aria-label="Calendar year" value={year} onChange={event => setMonth(`${event.target.value}-${String(monthNumber).padStart(2, "0")}`)}>{Array.from({ length: Math.max(2100, year) - Math.min(1900, year) + 1 }, (_, index) => Math.min(1900, year) + index).map(value => <option value={value} key={value}>{value}</option>)}</select><button type="button" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={20}/></button></div>
      <div className="date-picker-weekdays">{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="date-picker-days">{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`}/>)}{Array.from({ length: dayCount }, (_, index) => { const value = `${month}-${String(index + 1).padStart(2, "0")}`; return <button type="button" className={value === iso ? "selected" : value === dateISO() ? "today" : ""} key={value} aria-label={formatDate(value)} aria-pressed={value === iso} onClick={() => choose(value)}>{index + 1}</button>; })}</div>
      <footer>{!required && <button type="button" onClick={() => choose("")}>Clear</button>}<button type="button" onClick={() => choose(dateISO())}>Today</button><span>{iso ? formatDate(iso) : "Select a day"}</span></footer>
    </dialog>
  </div>;
}
