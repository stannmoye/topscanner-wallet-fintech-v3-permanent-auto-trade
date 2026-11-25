/**
 * DOM auto-translation engine.
 *
 * Walks the live document, sends each English text node (and a small set of
 * human-readable attributes) through a translation function, and writes the
 * result back in place. A MutationObserver keeps newly rendered content
 * translated as the single-page app re-renders, and every original string is
 * remembered so switching back to English restores the source exactly.
 *
 * Design notes:
 *  - Records keep the English `src`; `doneFor` marks which target language the
 *    current DOM value belongs to. This lets us retranslate when React
 *    overwrites a node with its English source without looping on strings that
 *    translate to themselves.
 *  - Machine values, code, inputs and the language/time selectors' own options
 *    are skipped (see `shouldTranslateText` and `SKIP_TAGS`).
 */

import { shouldTranslateText, type TranslateFn } from "./text-translation";

/** Elements whose text content must never be translated. */
const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE",
  "SVG", "CANVAS", "IFRAME", "TEMPLATE", "OPTION", "SELECT",
]);

/** Human-readable attributes that are safe (and useful) to translate. */
const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;

type TextRecord = { src: string; out: string; doneFor: string | null };

export type DomTranslator = {
  /** Switch target language. "en" restores the original English copy. */
  setLanguage: (language: string) => void;
  /** Tear down the observer and restore English. */
  destroy: () => void;
};

const MAX_CONCURRENCY = 6;

function isSkippedElement(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    if (SKIP_TAGS.has(current.tagName)) return true;
    if (current.getAttribute("data-no-translate") !== null) return true;
    if ((current as HTMLElement).isContentEditable) return true;
    current = current.parentElement;
  }
  return false;
}

export function createDomTranslator(translate: TranslateFn): DomTranslator {
  let language = "en";
  let destroyed = false;
  let observer: MutationObserver | null = null;
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;

  const textRecords = new Map<Text, TextRecord>();
  const attrRecords = new Map<Element, Map<string, TextRecord>>();

  type Job =
    | { kind: "text"; node: Text; text: string; target: string }
    | { kind: "attr"; element: Element; attribute: string; text: string; target: string };
  const queue: Job[] = [];
  let active = 0;

  const root = (): HTMLElement | null => (typeof document !== "undefined" ? document.body : null);

  function enqueue(job: Job) {
    queue.push(job);
    drain();
  }

  function drain() {
    if (destroyed) return;
    while (active < MAX_CONCURRENCY && queue.length) {
      const job = queue.shift() as Job;
      active += 1;
      translate(job.text, job.target)
        .then((result) => applyJob(job, result))
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  function applyJob(job: Job, result: string) {
    if (destroyed || job.target !== language) return;
    if (job.kind === "text") {
      const node = job.node;
      if (!node.isConnected) return;
      const record = textRecords.get(node);
      if (!record) return;
      record.out = result;
      record.doneFor = job.target;
      if (result && result !== node.nodeValue) node.nodeValue = result;
    } else {
      const map = attrRecords.get(job.element) || new Map<string, TextRecord>();
      const record = map.get(job.attribute);
      if (!record) return;
      record.out = result;
      record.doneFor = job.target;
      if (result && result !== job.element.getAttribute(job.attribute)) job.element.setAttribute(job.attribute, result);
    }
  }

  function handleTextNode(node: Text) {
    const value = node.nodeValue || "";
    let record = textRecords.get(node);
    if (!record) {
      record = { src: value, out: value, doneFor: null };
      textRecords.set(node, record);
    } else if (value !== record.src && value !== record.out) {
      // The app rendered brand-new copy: treat it as the new English source.
      record.src = value;
      record.out = value;
      record.doneFor = null;
    }
    if (language === "en") return;
    if (record.doneFor === language && value === record.out) return;
    if (!shouldTranslateText(record.src)) return;
    enqueue({ kind: "text", node, text: record.src, target: language });
  }

  function handleAttribute(element: Element, attribute: string) {
    const value = element.getAttribute(attribute) || "";
    let map = attrRecords.get(element);
    if (!map) {
      map = new Map<string, TextRecord>();
      attrRecords.set(element, map);
    }
    let record = map.get(attribute);
    if (!record) {
      record = { src: value, out: value, doneFor: null };
      map.set(attribute, record);
    } else if (value !== record.src && value !== record.out) {
      record.src = value;
      record.out = value;
      record.doneFor = null;
    }
    if (language === "en") return;
    if (record.doneFor === language && value === record.out) return;
    if (!shouldTranslateText(record.src)) return;
    enqueue({ kind: "attr", element, attribute, text: record.src, target: language });
  }

  function scan() {
    if (destroyed || language === "en") return;
    const container = root();
    if (!container) return;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = (node as Text).nodeValue || "";
        if (!text.trim()) return NodeFilter.FILTER_REJECT;
        if (isSkippedElement((node as Text).parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      handleTextNode(node as Text);
      node = walker.nextNode();
    }
    container.querySelectorAll(TRANSLATABLE_ATTRIBUTES.map((a) => `[${a}]`).join(",")).forEach((element) => {
      if (isSkippedElement(element)) return;
      for (const attribute of TRANSLATABLE_ATTRIBUTES) {
        if (element.hasAttribute(attribute)) handleAttribute(element, attribute);
      }
    });
  }

  function scheduleScan() {
    if (destroyed || language === "en") return;
    if (rescanTimer !== null) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      scan();
    }, 200);
  }

  function observe() {
    if (destroyed || observer) return;
    const container = root();
    if (!container || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(() => scheduleScan());
    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...TRANSLATABLE_ATTRIBUTES] });
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
    if (rescanTimer !== null) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
  }

  function restoreEnglish() {
    queue.length = 0;
    for (const [node, record] of textRecords) {
      if (node.isConnected && node.nodeValue !== record.src) node.nodeValue = record.src;
    }
    for (const [element, map] of attrRecords) {
      if (!element.isConnected) continue;
      for (const [attribute, record] of map) {
        if (element.getAttribute(attribute) !== record.src) element.setAttribute(attribute, record.src);
      }
    }
    textRecords.clear();
    attrRecords.clear();
  }

  function setLanguage(next: string) {
    if (destroyed || next === language) return;
    language = next;
    if (typeof document !== "undefined") document.documentElement.lang = next;
    if (next === "en") {
      restoreEnglish();
      disconnect();
      return;
    }
    observe();
    scan();
  }

  function destroy() {
    destroyed = true;
    queue.length = 0;
    restoreEnglish();
    disconnect();
  }

  return { setLanguage, destroy };
}
