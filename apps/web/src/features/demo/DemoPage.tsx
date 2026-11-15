import { t, tf } from "../../i18n";

const SLIDE_WIDTH = 1919;
const SLIDE_HEIGHT = 1080;
const SLIDES = [1, 2, 3, 4, 5] as const;

/** True for /demo and /demo/, so a trailing slash still opens the presentation. */
export function isDemoPath(pathname: string): boolean {
  return pathname === "/demo" || pathname === "/demo/";
}

// E-84: standalone presentation at /demo — no globe, no how-to, no API calls.
export function DemoPage() {
  return (
    <div className="demo-page">
      <header className="demo-page__bar">
        <a className="td-button td-button--primary" href="/">
          {t("demo.backToApp")}
        </a>
      </header>
      <main className="demo-page__slides">
        {SLIDES.map((n) => (
          <img
            key={n}
            className="demo-page__slide"
            src={`/demo/slide-${String(n)}.jpg`}
            alt={tf("demo.slideAlt", { n: String(n) })}
            width={SLIDE_WIDTH}
            height={SLIDE_HEIGHT}
            loading={n === 1 ? "eager" : "lazy"}
          />
        ))}
      </main>
    </div>
  );
}
