import { CheckCircle2, CircleDashed, RefreshCw } from 'lucide-react';
import type { AdapterHealth } from '@tokenlens/core';
import { useTokenStore } from '../stores/useTokenStore';
import { CLIENT_LABELS } from '../utils/format';
import { useI18n } from '../utils/i18n';

interface OnboardingCardProps {
  health: AdapterHealth[];
  onRefresh: () => void;
  onStartSim: () => void;
}

export function OnboardingCard({ health, onRefresh, onStartSim }: OnboardingCardProps) {
  const { t } = useI18n();
  const enabledClients = useTokenStore((s) => s.enabledClients);
  const toggleClientEnabled = useTokenStore((s) => s.toggleClientEnabled);

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-zinc-100">{t('onboardingTitle')}</div>
          <div className="text-[11px] text-zinc-400">{t('onboardingDesc')}</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors cursor-pointer"
          title={t('rescan')}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {health.map((item) => {
          const checked = enabledClients.includes(item.client);
          return (
            <div
              key={item.client}
              className="rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2 flex items-start gap-2"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleClientEnabled(item.client)}
                title={checked ? t('uncheckToHide') : t('checkToShow')}
                className="mt-0.5 accent-emerald-500 cursor-pointer shrink-0"
              />
              {item.available ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <CircleDashed className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-200">{CLIENT_LABELS[item.client]}</span>
                  <span
                    className={
                      item.available
                        ? 'text-emerald-400 text-[10px]'
                        : 'text-zinc-500 text-[10px]'
                    }
                  >
                    {item.available ? t('connected') : t('notDetected')}
                  </span>
                </div>
                {item.detectedPaths.length > 0 && (
                  <div className="text-[10px] text-zinc-400 font-mono truncate mt-0.5">
                    {item.detectedPaths[0]}
                  </div>
                )}
                {item.errors.length > 0 && (
                  <div className="text-[10px] text-orange-400 mt-0.5">{item.errors[0]}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onStartSim}
        className="w-full py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-200 text-xs font-medium transition-colors cursor-pointer"
        title={t('startReplayDemo')}
      >
        {t('startSimulatorBtn')}
      </button>
    </div>
  );
}
