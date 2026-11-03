// src/components/StatTile.jsx

export default function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/30 p-5 shadow-lg">
      <div className="text-xs tracking-widest text-white/60 uppercase">{label}</div>
      <div className="mt-2 text-3xl font-extrabold text-white">{value}</div>
      {sub ? <div className="mt-2 text-sm text-white/70">{sub}</div> : null}
    </div>
  );
}
