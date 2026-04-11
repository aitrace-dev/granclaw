import { useState, useEffect, useRef } from 'react';
import { fetchUsage, type UsageSummary } from '../lib/api.ts';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Pull theme colors out of the CSS vars so Chart.js matches the rest of
// the dashboard and flips with dark mode. The vars are RGB triplets —
// we wrap them in rgb()/rgba() for Chart.js's string-based color props.
function themeColor(token: string, alpha = 1): string {
  if (typeof document === 'undefined') return `rgba(0,0,0,${alpha})`;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
  if (!value) return `rgba(0,0,0,${alpha})`;
  return `rgba(${value.split(/\s+/).join(', ')}, ${alpha})`;
}

function TokenChart({ data }: { data: UsageSummary }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || data.daily.length === 0) return;

    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: data.daily.map(d => d.date.slice(5)), // MM-DD
        datasets: [
          {
            label: 'Input',
            data: data.daily.map(d => d.inputTokens),
            backgroundColor: themeColor('primary', 0.75),
            borderRadius: 2,
          },
          {
            label: 'Output',
            data: data.daily.map(d => d.outputTokens),
            backgroundColor: themeColor('info', 0.7),
            borderRadius: 2,
          },
          {
            label: 'Cache Read',
            data: data.daily.map(d => d.cacheReadTokens),
            backgroundColor: themeColor('success', 0.45),
            borderRadius: 2,
          },
          {
            label: 'Cache Write',
            data: data.daily.map(d => d.cacheCreateTokens),
            backgroundColor: themeColor('tertiary-fixed', 0.75),
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: themeColor('on-surface-variant'), font: { size: 10, family: 'monospace' }, boxWidth: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatTokens(ctx.raw as number)} tokens`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: themeColor('outline-variant', 0.3) },
            ticks: { color: themeColor('on-surface-variant'), font: { size: 9, family: 'monospace' } },
          },
          y: {
            stacked: true,
            grid: { color: themeColor('outline-variant', 0.3) },
            ticks: {
              color: themeColor('on-surface-variant'),
              font: { size: 9, family: 'monospace' },
              callback: (v) => formatTokens(v as number),
            },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); };
  }, [data]);

  return <canvas ref={canvasRef} />;
}

function CostChart({ data }: { data: UsageSummary }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || data.daily.length === 0) return;

    if (chartRef.current) chartRef.current.destroy();

    // Bar chart (not line): a Chart.js line chart with a single data
    // point draws nothing — just a lone dot with no connecting line —
    // so fresh agents that had one session saw a confusingly empty
    // cost chart. A bar chart renders one bar cleanly regardless of
    // day count, and still reads as a trend when there are many days.
    // See regression C.
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: data.daily.map(d => d.date.slice(5)),
        datasets: [
          {
            label: 'Est. Cost (USD)',
            data: data.daily.map(d => Number(d.estimatedCostUsd.toFixed(2))),
            backgroundColor: themeColor('secondary', 0.75),
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: themeColor('on-surface-variant'), font: { size: 10, family: 'monospace' }, boxWidth: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `$${(ctx.raw as number).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: themeColor('outline-variant', 0.3) },
            ticks: { color: themeColor('on-surface-variant'), font: { size: 9, family: 'monospace' } },
          },
          y: {
            grid: { color: themeColor('outline-variant', 0.3) },
            ticks: {
              color: themeColor('on-surface-variant'),
              font: { size: 9, family: 'monospace' },
              callback: (v) => `$${v}`,
            },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); };
  }, [data]);

  return <canvas ref={canvasRef} />;
}

export function UsageView({ agentId }: { agentId: string }) {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchUsage(agentId, days).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [agentId, days]);

  if (loading || !data) {
    return <div className="text-on-surface-variant/70 text-xs p-6">Scanning sessions...</div>;
  }

  const models = Object.entries(data.byModel).sort((a, b) => b[1].estimatedCostUsd - a[1].estimatedCostUsd);

  return (
    <div className="flex flex-col h-full w-full min-w-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-2">
          <span className="text-[13px] opacity-60">📊</span>
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-on-surface-variant">
            Usage
          </span>
        </div>
        <div className="flex items-center gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
                days === d ? 'bg-primary/20 text-primary' : 'text-on-surface-variant/70 hover:text-on-surface-variant/70'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4">
            <p className="text-[9px] uppercase text-on-surface-variant/60 mb-1.5">Total Tokens</p>
            <p className="font-mono text-[20px] text-on-surface/80">{formatTokens(data.totalInputTokens + data.totalOutputTokens)}</p>
            <p className="font-mono text-[9px] text-on-surface-variant/60 mt-1">{formatTokens(data.totalCacheReadTokens + data.totalCacheCreateTokens)} cached</p>
          </div>
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4">
            <p className="text-[9px] uppercase text-on-surface-variant/60 mb-1.5">Sessions</p>
            <p className="font-mono text-[20px] text-on-surface/80">{data.totalSessions}</p>
            <p className="font-mono text-[9px] text-on-surface-variant/60 mt-1">{Object.keys(data.byModel).length} models</p>
          </div>
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4">
            <p className="text-[9px] uppercase text-on-surface-variant/60 mb-1.5">Est. Cost</p>
            <p className="font-mono text-[20px] text-error/80">${data.totalEstimatedCostUsd.toFixed(2)}</p>
            <p className="font-mono text-[9px] text-on-surface-variant/60 mt-1">{days} day period</p>
          </div>
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4">
            <p className="text-[9px] uppercase text-on-surface-variant/60 mb-1.5">Avg/Day</p>
            <p className="font-mono text-[20px] text-warning/80">${data.daily.length > 0 ? (data.totalEstimatedCostUsd / data.daily.length).toFixed(2) : '0.00'}</p>
            <p className="font-mono text-[9px] text-on-surface-variant/60 mt-1">{data.daily.length > 0 ? Math.round(data.totalSessions / data.daily.length) : 0} sessions/day</p>
          </div>
        </div>

        {/* Token chart */}
        <div>
          <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
            Daily Token Usage
          </p>
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4" style={{ height: '300px' }}>
            {data.daily.length > 0 ? (
              <TokenChart data={data} />
            ) : (
              <p className="text-on-surface-variant/25 text-xs text-center pt-20">No usage data</p>
            )}
          </div>
        </div>

        {/* Cost chart */}
        <div>
          <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
            Daily Estimated Cost
          </p>
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4" style={{ height: '250px' }}>
            {data.daily.length > 0 ? (
              <CostChart data={data} />
            ) : (
              <p className="text-on-surface-variant/25 text-xs text-center pt-16">No cost data</p>
            )}
          </div>
        </div>

        {/* Model breakdown */}
        {models.length > 0 && (
          <div>
            <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
              By Model
            </p>
            <div className="space-y-1">
              {models.map(([model, stats]) => (
                <div key={model} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-[10px] text-on-surface/70 truncate block">{model}</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60">
                      {stats.sessions} sessions · {formatTokens(stats.inputTokens)} in · {formatTokens(stats.outputTokens)} out
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-error/60 flex-shrink-0">
                    ${stats.estimatedCostUsd.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Token breakdown */}
        <div>
          <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
            Token Breakdown
          </p>
          <div className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3 space-y-1.5">
            <div className="flex justify-between">
              <span className="font-mono text-[10px] text-on-surface-variant">Input tokens</span>
              <span className="font-mono text-[10px] text-primary">{formatTokens(data.totalInputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-[10px] text-on-surface-variant">Output tokens</span>
              <span className="font-mono text-[10px] text-info">{formatTokens(data.totalOutputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-[10px] text-on-surface-variant">Cache read</span>
              <span className="font-mono text-[10px] text-success">{formatTokens(data.totalCacheReadTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-[10px] text-on-surface-variant">Cache write</span>
              <span className="font-mono text-[10px] text-warning">{formatTokens(data.totalCacheCreateTokens)}</span>
            </div>
          </div>
        </div>

        {/* Tool usage */}
        {Object.keys(data.byTool).length > 0 && (
          <div>
            <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
              Tool Invocations
            </p>
            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-3 space-y-1">
              {Object.entries(data.byTool).sort((a, b) => b[1] - a[1]).map(([tool, count]) => {
                const maxCount = Math.max(...Object.values(data.byTool));
                return (
                  <div key={tool} className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-on-surface-variant w-40 truncate flex-shrink-0" title={tool}>{tool}</span>
                    <div className="flex-1 h-3 rounded-sm bg-background overflow-hidden">
                      <div
                        className="h-full rounded-sm bg-primary/40"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="font-mono text-[9px] text-on-surface-variant/70 w-8 text-right flex-shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Daily detail table */}
        <div>
          <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
            Daily Breakdown
          </p>
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-outline-variant/30">
                  <th className="px-3 py-2 text-left text-[9px] font-mono text-on-surface-variant/70 font-medium">Date</th>
                  <th className="px-3 py-2 text-right text-[9px] font-mono text-on-surface-variant/70 font-medium">Sessions</th>
                  <th className="px-3 py-2 text-right text-[9px] font-mono text-on-surface-variant/70 font-medium">Input</th>
                  <th className="px-3 py-2 text-right text-[9px] font-mono text-on-surface-variant/70 font-medium">Output</th>
                  <th className="px-3 py-2 text-right text-[9px] font-mono text-on-surface-variant/70 font-medium">Cache</th>
                  <th className="px-3 py-2 text-right text-[9px] font-mono text-on-surface-variant/70 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...data.daily].reverse().map(d => (
                  <tr key={d.date} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5 font-mono text-[10px] text-on-surface/70">{d.date}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-on-surface-variant text-right">{d.sessions}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-primary text-right">{formatTokens(d.inputTokens)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-info text-right">{formatTokens(d.outputTokens)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-success text-right">{formatTokens(d.cacheReadTokens + d.cacheCreateTokens)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-error/60 text-right">${d.estimatedCostUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
