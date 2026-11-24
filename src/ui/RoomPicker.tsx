// Pick an existing room or type a new one.
import { useState } from 'react';

export function RoomPicker({ rooms, value, onChange }: { rooms: string[]; value: string; onChange: (room: string) => void }) {
  const [typing, setTyping] = useState(!rooms.includes(value) && value !== '');
  return (
    <div className="field">
      <span className="label">Room</span>
      <div className="chips" role="radiogroup" aria-label="Room">
        {rooms.map((rm) => (
          <button
            key={rm}
            type="button"
            role="radio"
            aria-checked={!typing && value === rm}
            className={`chip-btn${!typing && value === rm ? ' on' : ''}`}
            onClick={() => {
              setTyping(false);
              onChange(rm);
            }}
          >
            {rm}
          </button>
        ))}
        <button
          type="button"
          className={`chip-btn${typing ? ' on' : ''}`}
          onClick={() => {
            setTyping(true);
            onChange('');
          }}
        >
          + New room
        </button>
      </div>
      {typing && <input aria-label="New room name" placeholder="e.g. Living room" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />}
    </div>
  );
}
