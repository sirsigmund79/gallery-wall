import { EmptyState } from '../../ui/EmptyState.tsx';

export function ArtScreen() {
  return (
    <section aria-labelledby="art-h">
      <h1 id="art-h">Art</h1>
      <EmptyState
        title="Your art library is empty"
        body="Add pieces by typing their size, or by photographing them on the floor."
        action={
          <button className="primary" disabled title="Coming in a later milestone">
            Add art
          </button>
        }
      />
    </section>
  );
}
