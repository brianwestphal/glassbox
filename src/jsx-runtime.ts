import { escapeAttr, escapeHtml } from './utils/escapeHtml.js';

export class SafeHtml {
  readonly __html: string;
  constructor(html: string) {
    this.__html = html;
  }
  toString(): string {
    return this.__html;
  }
}

export function raw(html: string): SafeHtml {
  return new SafeHtml(html);
}

type Child = SafeHtml | string | number | boolean | null | undefined;
type Children = Child | Children[];

interface Props {
  children?: Children;
  [key: string]: unknown;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

function renderChildren(children: Children): string {
  if (children == null || typeof children === 'boolean') return '';
  if (children instanceof SafeHtml) return children.__html;
  if (typeof children === 'string') return escapeHtml(children);
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(renderChildren).join('');
  return '';
}

function renderAttr(key: string, value: unknown): string {
  if (value == null || value === false) return '';
  if (value === true) return ` ${key}`;
  const name = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key;
  let strValue: string;
  if (value instanceof SafeHtml) {
    strValue = value.__html;
  } else if (typeof value === 'number') {
    strValue = String(value);
  } else if (typeof value === 'string') {
    strValue = escapeAttr(value);
  } else {
    strValue = '';
  }
  return ` ${name}="${strValue}"`;
}

export function jsx(
  tag: string | ((props: Props) => SafeHtml),
  props: Props,
): SafeHtml {
  if (typeof tag === 'function') return tag(props);

  const { children, ...attrs } = props;
  const attrStr = Object.entries(attrs).map(([k, v]) => renderAttr(k, v)).join('');

  if (VOID_TAGS.has(tag)) return new SafeHtml(`<${tag}${attrStr}>`);

  const childStr = children != null ? renderChildren(children) : '';
  return new SafeHtml(`<${tag}${attrStr}>${childStr}</${tag}>`);
}

export { jsx as jsxs };

export function Fragment({ children }: { children?: Children }): SafeHtml {
  return new SafeHtml(children != null ? renderChildren(children) : '');
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = SafeHtml;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}
