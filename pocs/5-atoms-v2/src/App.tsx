import { useState, useCallback } from 'react';
import type { AtomKind, AtomInstance, InteractionMode } from './lib/types';
import { Viewport } from './components/Viewport';
import { AtomToolbar } from './components/AtomToolbar';
import { ParamPanel } from './components/ParamPanel';

export function App() {
  const [activeTool, setActiveTool] = useState<AtomKind | null>(null);
  const [mode, setMode] = useState<InteractionMode>('select');
  const [atomCount, setAtomCount] = useState(0);
  const [selectedAtom, setSelectedAtom] = useState<AtomInstance | null>(null);

  const handleSelectTool = useCallback((kind: AtomKind | null) => {
    setActiveTool(kind);
    setMode(kind ? 'place' : 'select');
  }, []);

  const handleAtomSpawned = useCallback((_atom: AtomInstance) => {
    setAtomCount((c) => c + 1);
  }, []);

  const handleAtomSelected = useCallback((atom: AtomInstance | null) => {
    setSelectedAtom(atom);
  }, []);

  const handleConnectionMade = useCallback((_flex: AtomInstance) => {
    setAtomCount((c) => c + 1);
    setMode('select');
  }, []);

  const handleReset = useCallback(() => {
    window.location.reload();
  }, []);

  const handleModeChange = useCallback((newMode: InteractionMode) => {
    setMode(newMode);
    if (newMode !== 'place') setActiveTool(null);
  }, []);

  return (
    <div className="app">
      <AtomToolbar
        activeTool={activeTool}
        mode={mode}
        onSelectTool={handleSelectTool}
        onModeChange={handleModeChange}
        onReset={handleReset}
      />
      <Viewport
        activeTool={activeTool}
        mode={mode}
        onAtomSpawned={handleAtomSpawned}
        onAtomSelected={handleAtomSelected}
        onConnectionMade={handleConnectionMade}
      />
      <ParamPanel
        selectedAtom={selectedAtom}
        atomCount={atomCount}
      />
    </div>
  );
}
