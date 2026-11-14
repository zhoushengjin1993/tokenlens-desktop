import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  DollarSign,
  Folder,
  Lock,
  LockOpen,
  MessageSquare,
  SlidersHorizontal,
  Stethoscope,
} from 'lucide-react';
import { calculateTurnCost } from '@tokenlens/core/pricing';
import type { UnifiedTurnUsage } from '@tokenlens/core';
import { useTokenStore, turnCompositeKey } from '../stores/useTokenStore';
import { ALL_CLIENTS, CLIENT_LABELS, formatDuration, formatTokens } from '../utils/format';
import { TurnDetail } from './TurnDetail';
import { OnboardingCard } from './OnboardingCard';
import { apiBaseUrl } from '../hooks/useTokenStream';

interface SessionGroup {
  sessionId: string;
  sessionTitle: string;
  projectId: string;
  projectName: string;
  projectPath?: string;
  archived: boolean;
  archivedAt?: number;
  model?: string;
  turns: UnifiedTurnUsage[];
  totalTokens: number;
  cachedTokens: number;
  inputBase: number;
  latestUpdatedAt: number;
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectPath?: string;
  sessions: SessionGroup[];
  turnCount: number;
  totalTokens: number;
  cachedTokens: number;
  inputBase: number;
  latestUpdatedAt: number;
}

function summarizeTurns(turns: UnifiedTurnUsage[]) {
  let totalTokens = 0;
  let cachedTokens = 0;
  let inputBase = 0;
  let savingsUsd = 0;
  let hasEstimated = false;

  for (const t of turns) {
    totalTokens += t.totalTokens;
    cachedTokens += t.cachedTokens;
    inputBase += t.inputTokens + t.cachedTokens;
    savingsUsd += calculateTurnCost(t).cacheSavingsUsd;
    if (t.usageAccuracy === 'estimated') hasEstimated = true;
  }

  const cacheHitRate = inputBase > 0 ? Math.round((cachedTokens / inputBase) * 100) : 0;
  return { totalTokens, cachedTokens, inputBase, cacheHitRate, savingsUsd, hasEstimated };
}

function groupSessions(turns: UnifiedTurnUsage[]): SessionGroup[] {
  const map = new Map<string, SessionGroup>();
  for (const t of turns) {
    let group = map.get(t.sessionId);
    if (!group) {
      group = {
        sessionId: t.sessionId,
        sessionTitle: t.sessionTitle || t.promptSummary || t.sessionId,
        projectId: t.projectId,
        projectName: t.projectName,
        projectPath: t.projectPath,
        archived: t.archived,
        archivedAt: t.archivedAt,
        model: t.model,
        turns: [],
        totalTokens: 0,
        cachedTokens: 0,
        inputBase: 0,
        latestUpdatedAt: t.updatedAt,
      };
      map.set(t.sessionId, group);
    }
    group.turns.push(t);
    group.totalTokens += t.totalTokens;
    group.cachedTokens += t.cachedTokens;
    group.inputBase += t.inputTokens + t.cachedTokens;
    if (t.updatedAt > group.latestUpdatedAt) group.latestUpdatedAt = t.updatedAt;
    if (t.sessionTitle) group.sessionTitle = t.sessionTitle;
    if (t.model) group.model = t.model;
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.archivedAt ?? b.latestUpdatedAt) - (a.archivedAt ?? a.latestUpdatedAt),
  );
}

function groupProjects(turns: UnifiedTurnUsage[]): ProjectGroup[] {
  const sessions = groupSessions(turns);
  const map = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    let proj = map.get(s.projectId);
    if (!proj) {
      proj = {
        projectId: s.projectId,
        projectName: s.projectName,
        projectPath: s.projectPath,
        sessions: [],
        turnCount: 0,
        totalTokens: 0,
        cachedTokens: 0,
        inputBase: 0,
        latestUpdatedAt: s.latestUpdatedAt,
      };
      map.set(s.projectId, proj);
    }
    proj.sessions.push(s);
    proj.turnCount += s.turns.length;
    proj.totalTokens += s.totalTokens;
    proj.cachedTokens += s.cachedTokens;
    proj.inputBase += s.inputBase;
    if (s.latestUpdatedAt > proj.latestUpdatedAt) proj.latestUpdatedAt = s.latestUpdatedAt;
  }
  return Array.from(map.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
}

function formatShortTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TurnDrawer() {
  const turnsMap = useTokenStore((s) => s.turns);
  const health = useTokenStore((s) => s.health);
  const selectedClient = useTokenStore((s) => s.selectedClient);
  const viewMode = useTokenStore((s) => s.viewMode);
  const timeRange = useTokenStore((s) => s.timeRange);
  const onlySpikes = useTokenStore((s) => s.onlySpikes);
  const spikeThreshold = useTokenStore((s) => s.spikeThreshold);
  const selectedProjectId = useTokenStore((s) => s.selectedProjectId);
  const selectedSessionId = useTokenStore((s) => s.selectedSessionId);
  const autoSwitch = useTokenStore((s) => s.autoSwitch);
  const showCost = useTokenStore((s) => s.showCost);
  const expandedTurnKey = useTokenStore((s) => s.expandedTurnKey);
  const showOnboarding = useTokenStore((s) => s.showOnboarding);
  const showSettings = useTokenStore((s) => s.showSettings);
  const wsConnected = useTokenStore((s) => s.wsConnected);

  const setSelectedClient = useTokenStore((s) => s.setSelectedClient);
  const setViewMode = useTokenStore((s) => s.setViewMode);
  const setTimeRange = useTokenStore((s) => s.setTimeRange);
  const toggleOnlySpikes = useTokenStore((s) => s.toggleOnlySpikes);
  const setSpikeThreshold = useTokenStore((s) => s.setSpikeThreshold);
  const selectProject = useTokenStore((s) => s.selectProject);
  const selectSession = useTokenStore((s) => s.selectSession);
  const goRoot = useTokenStore((s) => s.goRoot);
  const toggleAutoSwitch = useTokenStore((s) => s.toggleAutoSwitch);
  const toggleShowCost = useTokenStore((s) => s.toggleShowCost);
  const setUiState = useTokenStore((s) => s.setUiState);
  const setExpandedTurnKey = useTokenStore((s) => s.setExpandedTurnKey);
  const setShowOnboarding = useTokenStore((s) => s.setShowOnboarding);
  const setShowSettings = useTokenStore((s) => s.setShowSettings);
  const setHealth = useTokenStore((s) => s.setHealth);

  const thresholdLabel = `${Math.round(spikeThreshold / 1000)}k`;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const clientTurns = Object.values(turnsMap)
    .filter((t) => t.client === selectedClient)
    .filter((t) => (timeRange === 'today' ? t.startedAt >= todayStartMs : true))
    .filter((t) => (onlySpikes ? t.inputTokens >= spikeThreshold : true))
    .sort((a, b) => a.startedAt - b.startedAt);

  const activeTurns = clientTurns.filter((t) => !t.archived);
  const archivedTurns = clientTurns.filter((t) => t.archived);

  const projects = groupProjects(activeTurns);
  const archivedSessions = groupSessions(archivedTurns);

  const currentProject = selectedProjectId
    ? projects.find((p) => p.projectId === selectedProjectId) ?? null
    : null;

  const currentSession = selectedSessionId
    ? (viewMode === 'archived'
        ? archivedSessions.find((s) => s.sessionId === selectedSessionId)
        : (currentProject?.sessions ?? groupSessions(activeTurns)).find(
            (s) => s.sessionId === selectedSessionId,
          )) ?? null
    : null;

  const scopedTurns = currentSession
    ? currentSession.turns
    : currentProject
      ? currentProject.sessions.flatMap((s) => s.turns)
      : viewMode === 'archived'
        ? archivedTurns
        : activeTurns;

  const summary = summarizeTurns(scopedTurns);
  const summaryTitle = currentSession
    ? '当前会话总计'
    : currentProject
      ? `${currentProject.projectName} · 项目总计`
      : viewMode === 'archived'
        ? `${CLIENT_LABELS[selectedClient]} · 已归档总计`
        : `${CLIENT_LABELS[selectedClient]} · 活跃总计`;

  const handleBack = () => {
    if (selectedSessionId) {
      selectSession(null);
      return;
    }
    if (selectedProjectId) {
      selectProject(null);
    }
  };

  const handleRefreshHealth = async () => {
    try {
      const res = await fetch(`${apiBaseUrl()}/api/health`);
      const data = (await res.json()) as { health: typeof health };
      setHealth(data.health);
    } catch {
      // Ignore network error
    }
  };

  const handleStartSim = async () => {
    try {
      await fetch(`${apiBaseUrl()}/api/sim/start`, { method: 'POST' });
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
      className="glass-surface w-[400px] h-[610px] rounded-2xl flex flex-col overflow-hidden text-zinc-100"
    >
      {/* Top Bar */}
      <div
        data-tauri-drag-region
        className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between cursor-grab active:cursor-grabbing"
      >
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
            onClick={toggleShowCost}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              showCost
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/25'
                : 'bg-white/5 text-zinc-400 hover:text-zinc-200'
            }`}
            title={showCost ? '隐藏费用' : '显示费用'}
          >
            <DollarSign className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={toggleAutoSwitch}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              autoSwitch
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/25'
                : 'bg-white/5 text-zinc-400 hover:text-zinc-200'
            }`}
            title={autoSwitch ? '自动跟随中' : '已锁定当前端'}
          >
            {autoSwitch ? <LockOpen className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              showSettings ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-zinc-400 hover:text-zinc-200'
            }`}
            title="预警阈值设置"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowOnboarding(!showOnboarding)}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              showOnboarding ? 'bg-sky-500/20 text-sky-300' : 'bg-white/5 text-zinc-400 hover:text-zinc-200'
            }`}
            title="连接诊断"
          >
            <Stethoscope className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setUiState('pill')}
            className="p-1.5 rounded-lg bg-white/5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="收起为胶囊 (Alt+T)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Client Tabs (2x3 Grid - zero horizontal scrollbar) */}
      <div className="px-3 py-2 grid grid-cols-3 gap-1 border-b border-white/10">
        {ALL_CLIENTS.map((client) => {
          const active = selectedClient === client;
          const count = Object.values(turnsMap).filter((t) => t.client === client).length;
          return (
            <button
              key={client}
              type="button"
              onClick={() => setSelectedClient(client)}
              title={`切换至 ${CLIENT_LABELS[client]}`}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex items-center justify-between gap-1 ${
                active
                  ? 'bg-white/15 text-white border border-white/15 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              <span className="truncate">{CLIENT_LABELS[client]}</span>
              {count > 0 && (
                <span className="text-[10px] font-mono text-zinc-400 shrink-0">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active / Archived Switch, Filters & Breadcrumb */}
      {!showOnboarding && !showSettings && (
        <div className="px-3 py-2 border-b border-white/10 space-y-1.5">
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-black/25 border border-white/5">
            <button
              type="button"
              onClick={() => setViewMode('active')}
              title="查看活跃项目"
              className={`py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                viewMode === 'active'
                  ? 'bg-white/12 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Folder className="w-3 h-3" />
              <span>活跃项目 ({projects.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('archived')}
              title="查看已归档会话"
              className={`py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                viewMode === 'archived'
                  ? 'bg-white/12 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Archive className="w-3 h-3" />
              <span>已归档 ({archivedSessions.length})</span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-1.5 text-[10px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTimeRange('all')}
                title="显示全部时间"
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  timeRange === 'all'
                    ? 'bg-white/12 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setTimeRange('today')}
                title="仅显示今日消耗"
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  timeRange === 'today'
                    ? 'bg-white/12 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                今日
              </button>
            </div>

            <button
              type="button"
              onClick={toggleOnlySpikes}
              title={`仅看单轮输入 ≥${thresholdLabel} 的高耗记录`}
              className={`px-2 py-0.5 rounded-md border transition-colors cursor-pointer flex items-center gap-1 font-mono ${
                onlySpikes
                  ? 'bg-orange-500/20 border-orange-400/40 text-orange-300'
                  : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              <span>仅看 &gt;{thresholdLabel}</span>
            </button>
          </div>

          {(selectedProjectId || selectedSessionId) && (
            <div className="flex items-center gap-1 text-[11px] text-zinc-400 min-w-0">
              <button
                type="button"
                onClick={handleBack}
                title="返回上一级"
                className="p-0.5 rounded hover:bg-white/10 text-zinc-300 cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={goRoot}
                title="返回列表"
                className="hover:text-zinc-200 cursor-pointer shrink-0"
              >
                {viewMode === 'archived' ? '已归档' : '活跃项目'}
              </button>
              {currentProject && viewMode === 'active' && (
                <>
                  <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
                  <button
                    type="button"
                    onClick={() => selectSession(null)}
                    title="返回项目会话"
                    className={`truncate cursor-pointer ${
                      currentSession ? 'hover:text-zinc-200' : 'text-zinc-100 font-medium'
                    }`}
                  >
                    {currentProject.projectName}
                  </button>
                </>
              )}
              {currentSession && (
                <>
                  <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
                  <span className="truncate text-zinc-100 font-medium">
                    {currentSession.sessionTitle}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {showSettings ? (
          <div className="p-3 space-y-3">
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 space-y-2.5">
              <div>
                <div className="text-xs font-semibold text-zinc-100">高耗预警阈值 (Spike)</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  单轮输入 Token 达到该阈值时触发橙色预警提示
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[30_000, 50_000, 80_000, 100_000].map((val) => {
                  const active = spikeThreshold === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSpikeThreshold(val)}
                      className={`py-1.5 rounded-lg text-xs font-mono border transition-colors cursor-pointer ${
                        active
                          ? 'bg-orange-500/20 border-orange-400/50 text-orange-200 font-semibold'
                          : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      {val / 1000}k
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : showOnboarding ? (
          <OnboardingCard
            health={health}
            onRefresh={handleRefreshHealth}
            onStartSim={handleStartSim}
          />
        ) : (
          <div className="p-3 space-y-3">
            {/* Scoped Summary Card */}
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 truncate">
                  {summaryTitle}
                </div>
                <div className="text-lg font-mono font-bold text-zinc-100 mt-0.5">
                  {formatTokens(summary.totalTokens, summary.hasEstimated)}
                  <span className="text-xs font-normal text-zinc-400 ml-1">tokens</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">缓存命中</div>
                <div className="text-sm font-mono font-semibold text-emerald-400 mt-0.5">
                  {summary.cacheHitRate}% · {formatTokens(summary.cachedTokens, summary.hasEstimated)}
                </div>
                {showCost && (
                  <div className="text-[10px] font-mono text-emerald-300/80">
                    已省 ${summary.savingsUsd.toFixed(4)}
                  </div>
                )}
              </div>
            </div>

            {/* Level 4: Session Turns */}
            {currentSession ? (
              <div className="space-y-2">
                {[...currentSession.turns].reverse().map((turn) => {
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
                        title="展开/收起轮次详情"
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
                            {turn.inputTokens >= spikeThreshold && (
                              <span
                                className="px-1 py-0.2 rounded bg-orange-500/15 border border-orange-400/30 text-[9px] font-mono text-orange-300 shrink-0"
                                title={`输入激增 >${thresholdLabel}，建议优化上下文`}
                              >
                                &gt;{thresholdLabel}
                              </span>
                            )}
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
            ) : viewMode === 'archived' ? (
              /* Level 3: Archived Sessions (with original project badge) */
              archivedSessions.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-400">
                  暂无 {CLIENT_LABELS[selectedClient]} 已归档会话
                </div>
              ) : (
                <div className="space-y-2">
                  {archivedSessions.map((sess) => {
                    const hitRate =
                      sess.inputBase > 0 ? Math.round((sess.cachedTokens / sess.inputBase) * 100) : 0;
                    const est = sess.turns.some((t) => t.usageAccuracy === 'estimated');
                    return (
                      <button
                        key={sess.sessionId}
                        type="button"
                        onClick={() => selectSession(sess.sessionId)}
                        title="查看归档详情"
                        className="w-full text-left rounded-xl bg-white/[0.03] border border-white/10 p-2.5 hover:border-white/20 transition-colors cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Archive className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span className="text-xs font-medium text-zinc-200 truncate">
                              {sess.sessionTitle}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-semibold text-zinc-100 shrink-0">
                            {formatTokens(sess.totalTokens, est)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-300 truncate max-w-[140px]">
                              {sess.projectName}
                            </span>
                            <span>{sess.turns.length} 轮</span>
                            <span>缓存 {hitRate}%</span>
                          </div>
                          <span className="font-mono shrink-0">
                            {formatShortTime(sess.archivedAt ?? sess.latestUpdatedAt)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : currentProject ? (
              /* Level 2: Sessions inside selected Project */
              <div className="space-y-2">
                {currentProject.sessions.map((sess) => {
                  const hitRate =
                    sess.inputBase > 0 ? Math.round((sess.cachedTokens / sess.inputBase) * 100) : 0;
                  const est = sess.turns.some((t) => t.usageAccuracy === 'estimated');
                  return (
                    <button
                      key={sess.sessionId}
                      type="button"
                      onClick={() => selectSession(sess.sessionId)}
                      title="查看逐轮详情"
                      className="w-full text-left rounded-xl bg-white/[0.03] border border-white/10 p-2.5 hover:border-white/20 transition-colors cursor-pointer space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <MessageSquare className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span className="text-xs font-medium text-zinc-200 truncate">
                            {sess.sessionTitle}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-zinc-100 shrink-0">
                          {formatTokens(sess.totalTokens, est)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {sess.model && (
                            <span className="px-1.5 py-0.5 rounded bg-white/5 font-mono text-zinc-300 truncate max-w-[140px]">
                              {sess.model}
                            </span>
                          )}
                          <span>{sess.turns.length} 轮</span>
                          <span>缓存 {hitRate}%</span>
                        </div>
                        <span className="font-mono shrink-0">
                          {formatShortTime(sess.latestUpdatedAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : projects.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="text-xs text-zinc-400">
                  暂无 {CLIENT_LABELS[selectedClient]} 活跃项目记录
                </div>
                <button
                  type="button"
                  onClick={handleStartSim}
                  title="启动回放演示"
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-zinc-300 cursor-pointer"
                >
                  运行回放模拟器测试
                </button>
              </div>
            ) : (
              /* Level 1: Projects under selected Client */
              <div className="space-y-2">
                {projects.map((proj) => {
                  const hitRate =
                    proj.inputBase > 0 ? Math.round((proj.cachedTokens / proj.inputBase) * 100) : 0;
                  const est = proj.sessions.some((s) =>
                    s.turns.some((t) => t.usageAccuracy === 'estimated'),
                  );
                  return (
                    <button
                      key={proj.projectId}
                      type="button"
                      onClick={() => selectProject(proj.projectId)}
                      title="查看项目会话"
                      className="w-full text-left rounded-xl bg-white/[0.03] border border-white/10 p-2.5 hover:border-white/20 transition-colors cursor-pointer space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Folder className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-xs font-medium text-zinc-100 truncate">
                            {proj.projectName}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-zinc-100 shrink-0">
                          {formatTokens(proj.totalTokens, est)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                        <div className="flex items-center gap-2">
                          <span>{proj.sessions.length} 会话</span>
                          <span>{proj.turnCount} 轮</span>
                          <span className="text-emerald-400/90">缓存 {hitRate}%</span>
                        </div>
                        <span className="font-mono truncate max-w-[150px]">
                          {proj.projectPath || '全局/未绑定'}
                        </span>
                      </div>
                    </button>
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
