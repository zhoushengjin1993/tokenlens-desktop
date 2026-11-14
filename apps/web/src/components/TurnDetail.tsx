import { motion } from 'framer-motion';
import { AlertTriangle, Cpu, GitBranch, Wrench } from 'lucide-react';
import type { UnifiedTurnUsage } from '@tokenlens/core';
import { useTokenStore } from '../stores/useTokenStore';
import { formatDuration, formatTokens } from '../utils/format';

interface TurnDetailProps {
  turn: UnifiedTurnUsage;
}

export function TurnDetail({ turn }: TurnDetailProps) {
  const spikeThreshold = useTokenStore((s) => s.spikeThreshold);
  const thresholdLabel = `${Math.round(spikeThreshold / 1000)}k`;
  const isEstimated = turn.usageAccuracy === 'estimated';
  const isSpike = turn.inputTokens >= spikeThreshold;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.16 }}
      className="overflow-hidden border-t border-white/10 bg-black/25 px-3 py-2.5 text-[11px] text-zinc-300 space-y-2"
    >
      <div className="flex flex-wrap gap-1.5">
        {turn.model && (
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-300 font-mono">
            {turn.model}
          </span>
        )}
        {isEstimated && (
          <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300">
            ≈ 本地估算
          </span>
        )}
        {turn.compacted && (
          <span className="px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-400/30 text-purple-300">
            Context Compacted
          </span>
        )}
        {isSpike && (
          <span
            className="px-1.5 py-0.5 rounded bg-orange-500/15 border border-orange-400/30 text-orange-300 flex items-center gap-1"
            title={`单轮输入 ≥${thresholdLabel}，建议精简上下文`}
          >
            <AlertTriangle className="w-3 h-3" /> Spike &gt;{thresholdLabel}
          </span>
        )}
      </div>

      {isSpike && (
        <div className="rounded-lg bg-orange-500/10 border border-orange-400/25 px-2.5 py-1.5 text-[10px] text-orange-200/90 leading-relaxed">
          ⚠ 单轮输入已超 {thresholdLabel}，建议减少整文件读取、清理无关历史或新开会话以节省 Token。
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
        <div className="flex items-center justify-between bg-white/[0.03] rounded px-2 py-1">
          <span className="text-zinc-400">Input</span>
          <span>{formatTokens(turn.inputTokens, isEstimated)}</span>
        </div>
        <div className="flex items-center justify-between bg-white/[0.03] rounded px-2 py-1">
          <span className="text-emerald-400">Cached</span>
          <span className="text-emerald-300">{formatTokens(turn.cachedTokens, isEstimated)}</span>
        </div>
        <div className="flex items-center justify-between bg-white/[0.03] rounded px-2 py-1">
          <span className="text-amber-400 flex items-center gap-1">
            <Cpu className="w-3 h-3" /> Reason
          </span>
          <span className="text-amber-300">{formatTokens(turn.reasoningTokens, isEstimated)}</span>
        </div>
        <div className="flex items-center justify-between bg-white/[0.03] rounded px-2 py-1">
          <span className="text-sky-400">Output</span>
          <span className="text-sky-300">{formatTokens(turn.outputTokens, isEstimated)}</span>
        </div>
      </div>

      {turn.subAgentCalls.length > 0 && (
        <div className="space-y-1">
          <div className="text-zinc-400 flex items-center gap-1 font-medium">
            <GitBranch className="w-3 h-3 text-indigo-400" /> Sub-Agent Calls ({turn.subAgentCalls.length})
          </div>
          {turn.subAgentCalls.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between bg-indigo-500/10 border border-indigo-400/20 rounded px-2 py-1"
            >
              <span className="truncate text-indigo-200">
                {sub.agentName ?? 'sub-agent'}
                {sub.role ? ` · ${sub.role}` : ''}
              </span>
              <span className="font-mono text-indigo-300 shrink-0">
                {formatTokens(sub.totalTokens)}
                {sub.durationMs ? ` · ${formatDuration(sub.durationMs)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {turn.toolCalls && turn.toolCalls.length > 0 && (
        <div className="space-y-1">
          <div className="text-zinc-400 flex items-center gap-1 font-medium">
            <Wrench className="w-3 h-3 text-zinc-400" /> Tools ({turn.toolCalls.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {turn.toolCalls.map((tc) => (
              <span
                key={tc.callId}
                className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[10px] text-zinc-300"
              >
                {tc.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
