import { create } from 'zustand';
import type { LengthUnit, Settings } from '../domain/types.ts';
import { defaultUnitForLocale } from '../geometry/units.ts';
import { db } from '../db/index.ts';

export function defaultSettings(locale = globalThis.navigator?.language): Settings {
  return { units: defaultUnitForLocale(locale), onboardingSeen: false };
}

interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  setUnits: (units: LengthUnit) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...defaultSettings(),
  loaded: false,
  load: async () => {
    const row = await db.settings.get('app');
    set({ ...defaultSettings(), ...(row ?? {}), loaded: true });
  },
  setUnits: async (units) => {
    set({ units });
    const { onboardingSeen } = get();
    await db.settings.put({ id: 'app', units, onboardingSeen });
  },
}));
