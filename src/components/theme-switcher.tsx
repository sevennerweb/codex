"use client";

import { useSyncExternalStore, type KeyboardEvent } from "react";

const THEME_STORAGE_KEY = "travel-color-theme";
const THEME_CHANGE_EVENT = "travel-theme-change";
const themes = [
  { value: "forest", label: "포레스트", color: "#087c73", browserColor: "#f4f6f1" },
  { value: "ocean", label: "오션", color: "#286da8", browserColor: "#f3f6fa" },
  { value: "sunset", label: "선셋", color: "#b95339", browserColor: "#fbf5f1" },
  { value: "lilac", label: "라일락", color: "#6d57a7", browserColor: "#f7f5fb" },
] as const;

type ThemeName = (typeof themes)[number]["value"];

function isThemeName(value: string | null): value is ThemeName {
  return themes.some((theme) => theme.value === value);
}

function applyTheme(themeName: ThemeName) {
  document.documentElement.dataset.theme = themeName;
  const browserColor = themes.find((theme) => theme.value === themeName)?.browserColor;
  if (browserColor) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", browserColor);
}

function getThemeSnapshot(): ThemeName {
  const currentTheme = document.documentElement.dataset.theme ?? null;
  return isThemeName(currentTheme) ? currentTheme : "forest";
}

function subscribeToTheme(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY || !isThemeName(event.newValue)) return;
    applyTheme(event.newValue);
    onStoreChange();
  }

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => "forest");

  function changeTheme(nextTheme: ThemeName) {
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the selected theme active for the current page.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  function moveThemeSelection(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const keyOffsets: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let nextIndex = currentIndex;
    if (event.key in keyOffsets) nextIndex = (currentIndex + keyOffsets[event.key] + themes.length) % themes.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = themes.length - 1;
    else return;

    event.preventDefault();
    const nextTheme = themes[nextIndex];
    changeTheme(nextTheme.value);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-theme-option="${nextTheme.value}"]`)?.focus());
  }

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="색상 테마">
      <span className="theme-label" aria-hidden="true">테마</span>
      {themes.map((item) => (
        <button
          key={item.value}
          className="theme-option"
          type="button"
          role="radio"
          aria-checked={theme === item.value}
          aria-label={`${item.label} 테마`}
          title={`${item.label} 테마`}
          data-theme-option={item.value}
          tabIndex={theme === item.value ? 0 : -1}
          onClick={() => changeTheme(item.value)}
          onKeyDown={(event) => moveThemeSelection(event, themes.indexOf(item))}
        >
          <span className="theme-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
