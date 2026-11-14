import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { UnifiedTurnUsage } from '@tokenlens/core';
import { CLIENT_LABELS, formatDuration, formatTokens } from '../utils/format';

interface MiniPillProps {
  latestTurn: UnifiedTurnUsage | null;
  onExpand: () => void;
}

export function MiniPill({ latestTurn, onExpand }: MiniPillProps) {
  const isRunning = latestTurn?.status === 'running';
  const isSpike = (latestTurn?.inputTokens ?? 0) >= 50_000;

  const dotClass = isSpike
    ? 'bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]'
    : isRunning
      ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
      : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]';

  return (
    <motion.button
      type="button"
      onClick={onExpand}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.18 }}
      className="glass-surface h-[36px] w-[260px] rounded-full px-3 flex items-center justify-between text-xs text-zinc-100 cursor-pointer hover:border-white/20 transition-colors"
      title={isSpike ? '输入激增 >50k，点击展开 (Alt+T)' : '展开详情 (Alt+T)'}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
        <span className="font-medium text-zinc-300 truncate">
          {latestTurn ? CLIENT_LABELS[latestTurn.client] : 'TokenLens'}
        </span>
        <span className="text-zinc-500">·</span>
        <span className="font-mono text-zinc-200">
          {latestTurn ? `T${latestTurn.turnIndex}` : 'Idle'}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0 font-mono">
        <span className="text-emerald-300 font-semibold">
          {latestTurn
            ? formatTokens(latestTurn.totalTokens, latestTurn.usageAccuracy === 'estimated')
            : '--'}
        </span>
        <span className="text-zinc-400 text-[11px]">
          {latestTurn ? formatDuration(latestTurn.durationMs) : ''}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </div>
    </motion.button>
  );
}
