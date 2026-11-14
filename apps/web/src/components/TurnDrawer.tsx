import { AnimatePresence, motion } from 'framer-motion';
import { Activity, ChevronUp, Lock, LockOpen, Stethoscope } from 'lucide-react';
import { useTokenStore, turnCompositeKey } from '../stores/useTokenStore';
import { ALL_CLIENTS, CLIENT_LABELS, formatDuration, formatTokens } from '../utils/format';
import { TurnDetail } from './TurnDetail';
import { OnboardingCard } from './OnboardingCard';

export function TurnDrawer() {
  const turnsMap = useTokenStore((s) => s.turns);
  const health = useTokenStore((s) => s.health);
  const selectedClient = useTokenStore((s) => s.selectedClient);
  const autoSwitch = useTokenStore((s) => s.autoSwitch);
  const expandedTurnKey = useTokenStore((s) => s.expandedTurnKey);
  const showOnboarding = useTokenStore((s) => s.showOnboarding);
  const wsConnected = useTokenStore((s) => s.wsConnected);

  const setSelectedClient = useTokenStore((s) => s.setSelectedClient);
  const toggleAutoSwitch = useTokenStore((s) => s.toggleAutoSwitch);
  const setUiState = useTokenStore((s) => s.setUiState);
  const setExpandedTurnKey = useTokenStore((s) => s.setExpandedTurnKey);
  const setShowOnboarding = useTokenStore((s) => s.setShowOnboarding);
  const setHealth = useTokenStore((s) => s.setHealth);

  const allTurns = Object.values(turnsMap).sort((a, b) => a.startedAt - b.startedAt);
  const clientTurns = allTurns.filter((t) => t.client === selectedClient);

  const totalSessionTokens = clientTurns.reduce((acc, t) => acc + t.totalTokens, 0);
  const totalCachedTokens = clientTurns.reduce((acc, t) => acc + t.cachedTokens, 0);
  const totalInputBase = clientTurns.reduce((acc, t) => acc + t.inputTokens + t.cachedTokens, 0);
  const cacheHitRate = totalInputBase > 0 ? Math.round((totalCachedTokens / totalInputBase) * 100) : 0;
  const hasEstimated = clientTurns.some((t) => t.usageAccuracy === 'estimated');

  const handleRefreshHealth = async () => {
    try {
      const res = await fetch('/api/health');
      const data = (await res.json()) as { health: typeof health };
      setHealth(data.health);
    } catch {
      // Ignore network error
    }
  };

  const handleStartSim = async () => {
    try {
      await fetch('/api/sim/start', { method: 'POST' });
      setShowOnboarding(false);
    } catch {
      // Ignore network error
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -6 }}
      transition={{ duration: 0.18 }}
      className="glass-surface w-[360px] h-[580px] rounded-2xl flex flex-col overflow-hidden text-zinc-100"
    >
      {/* Top Bar */}
      <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${wsConnected ? 'text-emerald-400' : 'text-zinc-500'}`} />
          <span className="text-xs font-semibold tracking-wide">TokenLens</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-zinc-400">
            {wsConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleAutoSwitch}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              autoSwitch
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/25'
                : 'bg-white/5 text-zinc-400 hover:text-zinc-200'
            }`}
            title={autoSwitch ? '自动跟随激活源：开启（点击锁定当前端）' : '已锁定当前端（点击恢复自动跟随）'}
          >
            {autoSwitch ? <LockOpen className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setShowOnboarding(!showOnboarding)}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              showOnboarding ? 'bg-sky-500/20 text-sky-300' : 'bg-white/5 text-zinc-400 hover:text-zinc-200'
            }`}
            title="客户端连接诊断"
          >
            <Stethoscope className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setUiState('pill')}
            className="p-1.5 rounded-lg bg-white/5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="收起为胶囊态 (Alt+T)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Client Switcher Tabs */}
      <div className="px-2.5 py-2 border-b border-white/10 flex gap-1 overflow-x-auto thin-scrollbar">
        {ALL_CLIENTS.map((client) => {
          const count = allTurns.filter((t) => t.client === client).length;
          const isRunning = allTurns.some((t) => t.client === client && t.status === 'running');
          const active = selectedClient === client && !showOnboarding;
          return (
            <button
              key={client}
              type="button"
              onClick={() => {
                setShowOnboarding(false);
                setSelectedClient(client);
              }}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-white/15 text-white border border-white/15'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
              <span>{CLIENT_LABELS[client]}</span>
              {count > 0 && (
                <span className="text-[10px] font-mono text-zinc-400">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {showOnboarding ? (
          <OnboardingCard
            health={health}
            onRefresh={handleRefreshHealth}
            onStartSim={handleStartSim}
          />
        ) : (
          <div className="p-3 space-y-3">
            {/* Session Summary Card */}
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                  {CLIENT_LABELS[selectedClient]} 会话总计
                </div>
                <div className="text-lg font-mono font-bold text-zinc-100 mt-0.5">
                  {formatTokens(totalSessionTokens, hasEstimated)}
                  <span className="text-xs font-normal text-zinc-400 ml-1">tokens</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">缓存命中</div>
                <div className="text-sm font-mono font-semibold text-emerald-400 mt-0.5">
                  {cacheHitRate}% · {formatTokens(totalCachedTokens, hasEstimated)}
                </div>
              </div>
            </div>

            {/* Per-Turn List */}
            {clientTurns.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="text-xs text-zinc-400">
                  暂无 {CLIENT_LABELS[selectedClient]} 逐轮记录
                </div>
                <button
                  type="button"
                  onClick={handleStartSim}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-zinc-300 cursor-pointer"
                >
                  运行回放模拟器测试
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {[...clientTurns].reverse().map((turn) => {
                  const key = turnCompositeKey(turn);
                  const isExpanded = expandedTurnKey === key;
                  const totalMix = turn.cachedTokens + turn.inputTokens + turn.outputTokens;
                  const cachedPct = totalMix > 0 ? (turn.cachedTokens / totalMix) * 100 : 0;
                  const freshPct = totalMix > 0 ? 100 - cachedPct : 0;

                  return (
                    <div
                      key={key}
                      className="rounded-xl bg-white/[0.03] border border-white/10 overflow-hidden hover:border-white/20 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedTurnKey(key)}
                        className="w-full text-left p-2.5 space-y-1.5 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                turn.status === 'running'
                                  ? 'bg-amber-400 animate-pulse'
                                  : turn.status === 'completed'
                                    ? 'bg-emerald-400'
                                    : 'bg-rose-400'
                              }`}
                            />
                            <span className="font-mono text-[11px] font-semibold text-zinc-200">
                              T{turn.turnIndex}
                            </span>
                            <span className="text-xs text-zinc-300 truncate">
                              {turn.promptSummary || '(无摘要)'}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] shrink-0 flex items-center gap-1.5">
                            <span className="text-zinc-100 font-semibold">
                              {formatTokens(turn.totalTokens, turn.usageAccuracy === 'estimated')}
                            </span>
                            <span className="text-zinc-500 text-[10px]">
                              {formatDuration(turn.durationMs)}
                            </span>
                          </div>
                        </div>

                        {/* Dual-Color Progress Bar: Emerald (Cached) vs Sky/Indigo (Fresh Input+Output) */}
                        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden flex">
                          <div
                            className="h-full bg-emerald-400/85 transition-all duration-300"
                            style={{ width: `${cachedPct}%` }}
                          />
                          <div
                            className="h-full bg-sky-400/85 transition-all duration-300"
                            style={{ width: `${freshPct}%` }}
                          />
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && <TurnDetail turn={turn} />}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
