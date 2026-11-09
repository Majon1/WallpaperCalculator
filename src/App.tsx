import { Canvas } from './editor/Canvas';
import { PropertiesPanel } from './editor/PropertiesPanel';
import { Toolbar } from './editor/Toolbar';
import { WallView } from './editor/WallView';

export function App() {
  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <div className="plan-column">
          <Canvas />
          <WallView />
        </div>
        <PropertiesPanel />
      </main>
    </div>
  );
}
