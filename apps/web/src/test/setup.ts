import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { HOW_TO_SEEN_KEY } from "../features/howto/HowToModal";

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
});

// E-79: existing tests should not see the first-visit how-to dialog.
beforeEach(() => {
  try {
    window.localStorage.setItem(HOW_TO_SEEN_KEY, "1");
  } catch {
    // jsdom storage is available; ignore a blocked store just in case.
  }
});

// recharts ResponsiveContainer needs a size in jsdom (UI-CHART).
class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    const width = target.clientWidth || 800;
    const height = target.clientHeight || 360;
    this.callback(
      [
        {
          target,
          contentRect: {
            width,
            height,
            top: 0,
            left: 0,
            bottom: height,
            right: width,
            x: 0,
            y: 0,
            toJSON() {
              return {};
            },
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = TestResizeObserver;
