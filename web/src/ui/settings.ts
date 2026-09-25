/**
 * The game's settings as the pages see them (difficulty, stat detail,
 * advice). App provides them from the status; tables and pages read them to
 * decide how much sabermetric detail to show.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { GameSettings } from "../api/protocol";

export const DEFAULT_SETTINGS: GameSettings = { difficulty: "normal", statView: "full", advice: true };

export const SettingsContext = createContext<GameSettings>(DEFAULT_SETTINGS);

export const useSettings = () => useContext(SettingsContext);

/** Basics mode: the familiar numbers only. */
export const useBasics = () => useSettings().statView === "basics";
