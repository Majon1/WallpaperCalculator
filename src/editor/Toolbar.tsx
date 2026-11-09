import { useRef, useState } from 'react';
import { parseLength } from '../model/units';
import { actions, useEditor } from '../store/editorStore';
import { downloadProject, readProjectFile } from '../store/persistence';

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);

  const [rectOpen, setRectOpen] = useState(false);
  const [rectWidth, setRectWidth] = useState('400');
  const [rectLength, setRectLength] = useState('300');
  const [rectError, setRectError] = useState<string | null>(null);

  const addRect = () => {
    const w = parseLength(rectWidth);
    const l = parseLength(rectLength);
    if (w === null || l === null || w < 100 || l < 100 || w > 100_000 || l > 100_000) {
      setRectError('Enter sizes between 10 and 10 000 cm, e.g. 400 or 352.5');
      return;
    }
    setTool('select');
    actions.addRectRoom(w, l);
    setRectOpen(false);
    setRectError(null);
  };

  return (
    <header className="toolbar">
      <div className="brand">WallpaperCalculator</div>

      <div className="group">
        <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select (V)">
          Select
        </button>
        <button className={tool === 'draw' ? 'active' : ''} onClick={() => setTool('draw')} title="Draw room (R)">
          Draw room
        </button>
        <div className="popover-anchor">
          <button className={rectOpen ? 'active' : ''} onClick={() => setRectOpen((o) => !o)}>
            Rectangle room
          </button>
          {rectOpen && (
            <form
              className="popover"
              onSubmit={(e) => {
                e.preventDefault();
                addRect();
              }}
              onKeyDown={(e) => e.key === 'Escape' && setRectOpen(false)}
            >
              <label>
                Width
                <input autoFocus value={rectWidth} onChange={(e) => setRectWidth(e.target.value)} />
                <span className="unit">cm</span>
              </label>
              <label>
                Length
                <input value={rectLength} onChange={(e) => setRectLength(e.target.value)} />
                <span className="unit">cm</span>
              </label>
              {rectError && <p className="error">{rectError}</p>}
              <div className="actions">
                <button type="button" onClick={() => setRectOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Add room
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="group">
        <button disabled={!canUndo} onClick={() => useEditor.getState().undo()} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button disabled={!canRedo} onClick={() => useEditor.getState().redo()} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <button onClick={() => useEditor.getState().requestFit()} title="Fit view (F)">
          Fit
        </button>
      </div>

      <div className="spacer" />

      <div className="group">
        <button
          onClick={() => {
            if (confirm('Start a new, empty project? (You can undo this.)')) actions.newProject();
          }}
        >
          New
        </button>
        <button onClick={() => fileRef.current?.click()}>Open…</button>
        <button onClick={() => downloadProject(useEditor.getState().project)}>Save file</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              actions.loadProject(await readProjectFile(file));
            } catch (err) {
              alert(err instanceof Error ? err.message : 'Could not open the file.');
            }
          }}
        />
      </div>
    </header>
  );
}
