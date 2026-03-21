import { escapeAttr, escapeHtml } from "./utils/escapeHtml.js";

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

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function renderChildren(children: Children): string {
  if (children == null || typeof children === "boolean") return "";
  if (children instanceof SafeHtml) return children.__html;
  if (typeof children === "string") return escapeHtml(children);
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(renderChildren).join("");
  return "";
}

const ATTR_ALIASES: Record<string, string> = {
  // HTML attributes
  className: "class",
  htmlFor: "for",
  httpEquiv: "http-equiv",
  acceptCharset: "accept-charset",
  accessKey: "accesskey",
  autoCapitalize: "autocapitalize",
  autoComplete: "autocomplete",
  autoFocus: "autofocus",
  autoPlay: "autoplay",
  colSpan: "colspan",
  contentEditable: "contenteditable",
  crossOrigin: "crossorigin",
  dateTime: "datetime",
  defaultChecked: "checked",
  defaultValue: "value",
  encType: "enctype",
  formAction: "formaction",
  formEncType: "formenctype",
  formMethod: "formmethod",
  formNoValidate: "formnovalidate",
  formTarget: "formtarget",
  hrefLang: "hreflang",
  inputMode: "inputmode",
  maxLength: "maxlength",
  minLength: "minlength",
  noModule: "nomodule",
  noValidate: "novalidate",
  readOnly: "readonly",
  referrerPolicy: "referrerpolicy",
  rowSpan: "rowspan",
  spellCheck: "spellcheck",
  srcDoc: "srcdoc",
  srcLang: "srclang",
  srcSet: "srcset",
  tabIndex: "tabindex",
  useMap: "usemap",

  // SVG presentation attributes (camelCase → kebab-case)
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeDasharray: "stroke-dasharray",
  strokeDashoffset: "stroke-dashoffset",
  strokeMiterlimit: "stroke-miterlimit",
  strokeOpacity: "stroke-opacity",
  fillOpacity: "fill-opacity",
  fillRule: "fill-rule",
  clipPath: "clip-path",
  clipRule: "clip-rule",
  colorInterpolation: "color-interpolation",
  colorInterpolationFilters: "color-interpolation-filters",
  floodColor: "flood-color",
  floodOpacity: "flood-opacity",
  lightingColor: "lighting-color",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  shapeRendering: "shape-rendering",
  imageRendering: "image-rendering",
  textRendering: "text-rendering",
  pointerEvents: "pointer-events",
  vectorEffect: "vector-effect",
  paintOrder: "paint-order",

  // SVG text/font attributes
  fontFamily: "font-family",
  fontSize: "font-size",
  fontStyle: "font-style",
  fontVariant: "font-variant",
  fontWeight: "font-weight",
  fontStretch: "font-stretch",
  textAnchor: "text-anchor",
  textDecoration: "text-decoration",
  dominantBaseline: "dominant-baseline",
  alignmentBaseline: "alignment-baseline",
  baselineShift: "baseline-shift",
  letterSpacing: "letter-spacing",
  wordSpacing: "word-spacing",
  writingMode: "writing-mode",
  glyphOrientationHorizontal: "glyph-orientation-horizontal",
  glyphOrientationVertical: "glyph-orientation-vertical",

  // SVG marker/gradient/filter attributes
  markerStart: "marker-start",
  markerMid: "marker-mid",
  markerEnd: "marker-end",
  gradientUnits: "gradientUnits",
  gradientTransform: "gradientTransform",
  spreadMethod: "spreadMethod",
  patternUnits: "patternUnits",
  patternContentUnits: "patternContentUnits",
  patternTransform: "patternTransform",
  maskUnits: "maskUnits",
  maskContentUnits: "maskContentUnits",
  filterUnits: "filterUnits",
  primitiveUnits: "primitiveUnits",
  clipPathUnits: "clipPathUnits",

  // SVG xlink (legacy but still used)
  xlinkHref: "xlink:href",
  xlinkShow: "xlink:show",
  xlinkActuate: "xlink:actuate",
  xlinkType: "xlink:type",
  xlinkRole: "xlink:role",
  xlinkTitle: "xlink:title",
  xlinkArcrole: "xlink:arcrole",
  xmlBase: "xml:base",
  xmlLang: "xml:lang",
  xmlSpace: "xml:space",
  xmlns: "xmlns",
  xmlnsXlink: "xmlns:xlink",

  // SVG filter primitive attributes
  stdDeviation: "stdDeviation",
  baseFrequency: "baseFrequency",
  numOctaves: "numOctaves",
  kernelMatrix: "kernelMatrix",
  surfaceScale: "surfaceScale",
  specularConstant: "specularConstant",
  specularExponent: "specularExponent",
  diffuseConstant: "diffuseConstant",
  pointsAtX: "pointsAtX",
  pointsAtY: "pointsAtY",
  pointsAtZ: "pointsAtZ",
  limitingConeAngle: "limitingConeAngle",
  tableValues: "tableValues",

  // viewBox, preserveAspectRatio stay as-is (already correct casing)
};

function renderAttr(key: string, value: unknown): string {
  const name = ATTR_ALIASES[key] ?? key;
  if (value == null || value === false) return "";
  if (value === true) return ` ${name}`;
  let strValue: string;
  if (value instanceof SafeHtml) {
    strValue = value.__html;
  } else if (typeof value === "number") {
    strValue = String(value);
  } else if (typeof value === "string") {
    strValue = escapeAttr(value);
  } else {
    strValue = "";
  }
  return ` ${name}="${strValue}"`;
}

export function jsx(tag: string | ((props: Props) => SafeHtml), props: Props): SafeHtml {
  if (typeof tag === "function") return tag(props);

  const { children, ...attrs } = props;
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => renderAttr(k, v))
    .join("");

  if (VOID_TAGS.has(tag)) return new SafeHtml(`<${tag}${attrStr}>`);

  const childStr = children != null ? renderChildren(children) : "";
  return new SafeHtml(`<${tag}${attrStr}>${childStr}</${tag}>`);
}

export { jsx as jsxs };

export function Fragment({ children }: { children?: Children }): SafeHtml {
  return new SafeHtml(children != null ? renderChildren(children) : "");
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
