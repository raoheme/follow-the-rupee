import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { PAGE_ROUTES } from "../routes";

/**
 * Responsive navigation for the twelve pages. Below 960px the list is a disclosure (button with aria-expanded) that
 * closes after navigation; from 960px it is a permanent side rail. The current page is marked with aria-current and a
 * non-colour cue (bold text and a left bar), not colour alone.
 */
export function NavMenu() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  return (
    <nav className="nav" aria-label={t("nav.label")}>
      <button
        type="button"
        className="nav__toggle"
        aria-expanded={open}
        aria-controls="nav-list"
        onClick={() => setOpen((o) => !o)}
      >
        {t("nav.menu")}
      </button>
      <ul id="nav-list" className="nav__list" data-open={open}>
        {PAGE_ROUTES.map((r) => (
          <li key={r.pageId}>
            <NavLink to={r.path} className="nav__link">
              <span className="nav__id">{r.pageId}</span> {t(r.nameKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
