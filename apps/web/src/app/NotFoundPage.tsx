import { t } from "../i18n";

/** Home path of the app: Vite base, or "/" when the base is the site root. */
export function appHomePath(base: string = import.meta.env.BASE_URL): string {
  if (base === "" || base === "/") return "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** True for the start page; every other path is an unknown URL (UI-ERR, no router). */
export function isAppHomePath(
  pathname: string,
  base: string = import.meta.env.BASE_URL,
): boolean {
  const trim = (path: string) => path.replace(/\/+$/, "") || "/";
  return trim(pathname) === trim(base);
}

/** 404 page for unknown URLs, with a link back to the start page. */
export function NotFoundPage() {
  return (
    <div className="error-screen" data-testid="not-found">
      <div className="error-screen__card">
        <h1 className="error-screen__title">{t("error.notFound.title")}</h1>
        <a className="td-button td-button--primary" href={appHomePath()}>
          {t("error.notFound.home")}
        </a>
      </div>
    </div>
  );
}
