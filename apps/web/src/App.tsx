import { AnimatePresence } from 'framer-motion';
import { useTokenStream } from './hooks/useTokenStream';
import { useTauriBridge } from './hooks/useTauriBridge';
import { useTokenStore } from './stores/useTokenStore';
import { MiniPill } from './components/MiniPill';
import { TurnDrawer } from './components/TurnDrawer';

export function App() {
  useTokenStream();
  useTauriBridge();

  const uiState = useTokenStore((s) => s.uiState);
  const setUiState = useTokenStore((s) => s.setUiState);
  const turnsMap = useTokenStore((s) => s.turns);
  const selectedClient = useTokenStore((s) => s.selectedClient);

  const allTurns = Object.values(turnsMap).sort((a, b) => a.updatedAt - b.updatedAt);
  const clientTurns = allTurns.filter((t) => t.client === selectedClient);
  const latestTurn =
    clientTurns[clientTurns.length - 1] ?? allTurns[allTurns.length - 1] ?? null;

  return (
    <div className="min-h-screen w-full p-4 flex justify-end items-start">
      <AnimatePresence mode="wait">
        {uiState === 'pill' ? (
          <MiniPill
            key="pill"
            latestTurn={latestTurn}
            onExpand={() => setUiState('drawer')}
          />
        ) : (
          <TurnDrawer key="drawer" />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
