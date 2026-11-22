import { EmptyState } from '../../ui/EmptyState.tsx';

export function WallsScreen() {
  return (
    <section aria-labelledby="walls-h">
      <h1 id="walls-h">Walls</h1>
      <EmptyState
        title="No walls yet"
        body="Photograph a wall, type one measurement, and plan your art on it at true scale."
        action={
          <button className="primary" disabled title="Coming in a later milestone">
            Add a wall
          </button>
        }
      />
    </section>
  );
}
