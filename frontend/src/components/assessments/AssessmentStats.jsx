import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPercent } from '../../utils/format';
import { useCategoryAxisProps } from '../../hooks/useMediaQuery';
import { CHART } from '../../config/chartTheme';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(Number(n).toFixed(2)).toString());

function Tile({ label, value, hint }) {
  return (
    <div className="evsu-card p-3">
      <div className="small text-muted-evsu">{label}</div>
      <div className="h5 mb-0 fw-semibold">{value}</div>
      {hint && <div className="small text-muted-evsu">{hint}</div>}
    </div>
  );
}

/** Saved-score statistics for one assessment, with a score-distribution chart. */
export default function AssessmentStats({ stats, maxScore, showChart = true }) {
  const axisProps = useCategoryAxisProps();
  return (
    <section aria-label="Statistics" className="mb-4">
      <div className="evsu-stat-row mb-3">
        <Tile label="Students" value={stats.totalStudents} />
        <Tile label="With scores" value={stats.scoredCount} />
        <Tile label="Without scores" value={stats.missingCount} />
        <Tile label="Highest" value={fmt(stats.highest)} hint={`of ${maxScore}`} />
        <Tile label="Lowest" value={fmt(stats.lowest)} hint={`of ${maxScore}`} />
        <Tile label="Class average" value={fmt(stats.average)} hint={formatPercent(stats.averagePercent)} />
      </div>
      {showChart && stats.distribution && stats.scoredCount > 0 && (
        <div className="evsu-card p-3">
          <h3 className="h6 mb-3">Score distribution (% of total possible)</h3>
          <div style={{ width: '100%', height: 200 }} role="img" aria-label={`Distribution: ${stats.distribution.map((d) => `${d.range}%: ${d.count}`).join(', ')}`}>
            <ResponsiveContainer>
              <BarChart data={stats.distribution} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="range" {...axisProps} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => [value, 'Students']} labelFormatter={(label) => `${label}%`} />
                <Bar isAnimationActive={false} dataKey="count" fill={CHART.maroon} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
