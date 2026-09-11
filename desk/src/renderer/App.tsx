// Stub: T15 replaces this with the app shell (boot, nav, screens).
// primitives.css (T8) is imported here rather than from theme.css, which is
// done and out of scope for this task; T15 must keep this import when it
// replaces the rest of this file.
import './components/primitives.css';

export default function App() {
  return (
    <main className="grid-bg">
      <h1 className="label">Paddock</h1>
    </main>
  );
}
