import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useEditor } from './store/editorStore';
import { saveProject } from './store/persistence';
import './styles.css';

// Autosave to the browser, debounced so drags don't write on every frame.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((state, prev) => {
  if (state.project === prev.project) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(useEditor.getState().project), 300);
});
window.addEventListener('beforeunload', () => saveProject(useEditor.getState().project));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
