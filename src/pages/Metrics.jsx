import { useEffect, useState } from "react";

export default function Metrics() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/.netlify/functions/tensec-metrics")
      .then(r => r.json())
      .then(setData)
      .catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="p-6 text-red-500">Error: {err}</div>;
  if (!data) return <div className="p-6">Loading…</div>;

  const winRate = data.totals.attempts ? ((data.totals.wins / data.totals.attempts) * 100).toFixed(2) : "0.00";

  return (
    <div className="max-w-5xl mx-auto p-6 text-white">
      <h1 className="text-2xl font-bold mb-4">10-Sec Challenge Metrics</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card title="Total Attempts" value={data.totals.attempts} />
        <Card title="Total Wins" value={data.totals.wins} />
        <Card title="Win Rate" value={`${winRate}%`} />
      </div>

      <Section title="Last 30 Days" rows={data.last30Days} label="date" />
      <Section title="Last 12 ISO Weeks" rows={data.last12Weeks} label="token" />
      <Section title="Last 12 Months" rows={data.last12Months} label="token" />
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs uppercase opacity-70">{title}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Section({ title, rows, label }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 mb-6 overflow-x-auto">
      <div className="text-sm font-semibold mb-3">{title}</div>
      <table className="min-w-[500px] w-full text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-left py-2">Period</th>
            <th className="text-left py-2">Attempts</th>
            <th className="text-left py-2">Wins</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.token || r.date} className="border-t border-neutral-800">
              <td className="py-2">{r[label]}</td>
              <td className="py-2">{r.attempts}</td>
              <td className="py-2">{r.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
