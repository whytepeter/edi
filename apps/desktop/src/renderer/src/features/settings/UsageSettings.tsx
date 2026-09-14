import { useEffect, useState } from 'react';
import type { UsagePeriod, UsageSummary, UsageTotals } from '@edi/contracts';
import { Button, GroupedList, GroupedRow, SegmentedControl } from '../../components/ui';
import './settings.css';

const periods = ['Today', '7 days', '30 days'] as const;
type PeriodLabel = (typeof periods)[number];
const periodDays: Record<PeriodLabel, UsagePeriod> = { Today: 1, '7 days': 7, '30 days': 30 };

export const formatCost = (usd: number) =>
  usd === 0 ? '$0.00' : usd < 0.001 ? '<$0.001' : `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;
const compact = (value: number) =>
  (value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, '');
export const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${compact(tokens / 1_000_000)}M`
    : tokens >= 1_000
      ? `${compact(tokens / 1_000)}K`
      : String(tokens);
/** "anthropic/claude-sonnet-5" → "Claude Sonnet 5". */
export const modelName = (id: string) =>
  (id.split('/').at(-1) ?? id)
    .split('-')
    .map(word => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');

function tokenDetail(totals: UsageTotals) {
  const parts = [
    `${formatTokens(totals.inputTokens)} in`,
    `${formatTokens(totals.outputTokens)} out`,
  ];
  if (totals.cachedTokens > 0 && totals.inputTokens > 0)
    parts.push(`${Math.round((totals.cachedTokens / totals.inputTokens) * 100)}% from cache`);
  return parts.join(' · ');
}

/** Settings → Usage: what Edi spent on OpenRouter and sent to cloud voices, from its own records. */
export function UsageSettings({ refreshKey }: { refreshKey: string }) {
  const [period, setPeriod] = useState<PeriodLabel>('7 days');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const days = periodDays[period];

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .usage(days)
      .then(value => {
        if (!alive) return;
        setSummary(value);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [days, refreshKey]);

  const current = summary?.days === days ? summary : null;
  const answers = current?.byKind.find(entry => entry.kind === 'answer');
  const reading = current?.byKind.find(entry => entry.kind === 'page-reader');
  const peak = Math.max(...(current?.daily.map(day => day.costUsd) ?? [0]), 0);
  const nothing = current && current.total.calls === 0 && current.voice.length === 0;

  return (
    <div className="settings-page">
      <SegmentedControl<PeriodLabel>
        label="Period"
        options={periods}
        value={period}
        onChange={setPeriod}
      />

      <section className="usage-hero" aria-live="polite">
        <span className="usage-hero-label">Spent on OpenRouter</span>
        <strong className="usage-hero-cost">
          {current ? formatCost(current.total.costUsd) : failed ? '—' : '…'}
        </strong>
        <span className="usage-hero-detail">
          {current
            ? `${current.answers} ${current.answers === 1 ? 'answer' : 'answers'} · ${current.total.calls} model ${current.total.calls === 1 ? 'call' : 'calls'}`
            : failed
              ? 'Couldn’t load usage.'
              : 'Loading…'}
        </span>
        {current && days > 1 && (
          <div className="usage-bars" role="img" aria-label={`Daily cost over ${days} days`}>
            {current.daily.map(day => (
              <span
                key={day.day}
                className="usage-bar"
                title={`${day.day}: ${formatCost(day.costUsd)}`}
                style={{ height: `${peak > 0 ? Math.max(4, (day.costUsd / peak) * 100) : 4}%` }}
              />
            ))}
          </div>
        )}
      </section>

      {nothing && <p className="settings-prose">Nothing used in this period yet.</p>}

      {current && current.total.calls > 0 && (
        <GroupedList
          title="Where it went"
          footer={`Costs are what OpenRouter reports for each request, including web search.${
            current.total.unpricedCalls > 0
              ? ` ${current.total.unpricedCalls} ${current.total.unpricedCalls === 1 ? 'call' : 'calls'} reported no cost, so the total may be a little higher.`
              : ''
          } Edi keeps counts and costs only, never what was said.`}
        >
          {answers && (
            <GroupedRow
              icon="chat"
              title="Answers"
              detail={tokenDetail(answers)}
              value={formatCost(answers.costUsd)}
            />
          )}
          {reading && (
            <GroupedRow
              icon="search"
              title="Reading web pages"
              detail={`${reading.calls} ${reading.calls === 1 ? 'page' : 'pages'} · ${tokenDetail(reading)}`}
              value={formatCost(reading.costUsd)}
            />
          )}
        </GroupedList>
      )}

      {current && current.byModel.length > 0 && (
        <GroupedList title="Models">
          {current.byModel.map(entry => (
            <GroupedRow
              key={entry.model}
              icon="cpu"
              title={modelName(entry.model)}
              detail={`${entry.calls} ${entry.calls === 1 ? 'call' : 'calls'} · ${tokenDetail(entry)}`}
              value={formatCost(entry.costUsd)}
            />
          ))}
        </GroupedList>
      )}

      {current && (
        <GroupedList
          title="Voice"
          footer="Kokoro and Chatterbox run on this Mac and cost nothing. Cartesia and ElevenLabs bill characters on your own plan."
        >
          {current.voice.length === 0 ? (
            <GroupedRow icon="waveform" title="On this Mac only" value="Free" />
          ) : (
            current.voice.map(entry => (
              <GroupedRow
                key={entry.provider}
                icon="waveform"
                title={entry.provider === 'cartesia' ? 'Cartesia' : 'ElevenLabs'}
                detail={`${entry.replies} ${entry.replies === 1 ? 'reply' : 'replies'}`}
                value={`${entry.characters.toLocaleString()} characters`}
              />
            ))
          )}
        </GroupedList>
      )}

      {current?.account && (
        <GroupedList title="OpenRouter key">
          <GroupedRow title="Spent with this key" value={formatCost(current.account.spentUsd)} />
          <GroupedRow
            title="Credit limit"
            value={
              current.account.limitUsd === null
                ? 'No limit'
                : `${formatCost(Math.max(0, current.account.remainingUsd ?? 0))} of ${formatCost(current.account.limitUsd)} left`
            }
            control={
              <Button
                size="small"
                trailingIcon="arrow-up-right"
                onClick={() =>
                  void window.edi?.command({
                    type: 'open-link',
                    url: 'https://openrouter.ai/activity',
                  })
                }
              >
                Activity
              </Button>
            }
          />
        </GroupedList>
      )}
    </div>
  );
}
