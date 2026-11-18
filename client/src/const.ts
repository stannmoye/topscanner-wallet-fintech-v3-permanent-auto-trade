export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Authentication and sessions are owned by this application and its database.
// Navigating to customer access opens the local register/sign-in form; no hosted
// OAuth portal or project-specific redirect is involved.
//
// Item 49: the administrator console is reached only under its own path prefix.
// "/admin" is intentionally NOT treated as an alias, because redirecting it to the
// console path would disclose the console location to anyone who probes /admin.
export const startLogin = () => {
  const target = window.location.pathname.startsWith("/ops-console")
    ? "/ops-console-7f3a"
    : "/customer";
  if (window.location.pathname !== target) window.location.assign(target);
};
