import { useLayoutEffect } from 'react';

interface PageStyleOptions {
  /** Raw CSS strings, injected as <style> tags in this order. */
  css: string[];
  /** Space-separated classes applied to <body> while mounted (from the original <body class>). */
  bodyClass?: string;
  /** document.title while mounted. */
  title?: string;
}

/**
 * Route-scoped CSS: the page's stylesheet exists in the document ONLY while the
 * route is mounted, so Landing/Home/auth CSS (which all define conflicting
 * globals) can never leak into each other. useLayoutEffect runs before paint,
 * so there is no flash of unstyled or wrongly-styled content between routes.
 */
export function usePageStyles({ css, bodyClass, title }: PageStyleOptions): void {
  const cssKey = css.join('\n/*--*/\n');
  useLayoutEffect(() => {
    const tags = css.map((text) => {
      const el = document.createElement('style');
      el.setAttribute('data-page-style', '');
      el.textContent = text;
      document.head.appendChild(el);
      return el;
    });
    const classes = bodyClass ? bodyClass.split(/\s+/).filter(Boolean) : [];
    document.body.classList.add(...classes);
    const prevTitle = document.title;
    if (title) document.title = title;
    return () => {
      tags.forEach((el) => el.remove());
      document.body.classList.remove(...classes);
      if (document.body.classList.length === 0) document.body.removeAttribute('class');
      document.title = prevTitle;
    };
    // cssKey captures the css array contents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cssKey, bodyClass, title]);
}
