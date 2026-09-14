import { characterParts, characterVariantNames, requiredCharacterParts } from './expressions';

/**
 * Character art comes from strangers, and it is drawn inside the pet window, which can reach the
 * microphone. So it is never inserted as given: this parses the SVG strictly, keeps only an
 * allowlist of drawing elements and attributes with checked values, and serializes a fresh copy.
 * Scripts, styles, images, links, animation, text and filters never survive, and every reference
 * must point at an id inside the same file.
 *
 * Ids are rewritten to `{{scope}}-id` so several copies of a character can share a page.
 */

export interface ArtProblem {
  level: 'error' | 'warning';
  message: string;
}

export interface SanitizedArt {
  /** Inner markup of the root <svg>, or '' when there were errors. */
  markup: string;
  viewBox: string | null;
  /** Variants each part offers, in document order. */
  variants: Record<string, string[]>;
  problems: ArtProblem[];
}

export const maxArtBytes = 512_000;
const maxElements = 6000;
const maxDepth = 40;

interface Element {
  name: string;
  attributes: Map<string, string>;
  children: Element[];
}

/** Motion targets that are not variant groups. Edi moves `pupils` for glances. */
const motionParts = ['pupils'] as const;
const knownParts = new Set<string>([...characterParts, ...motionParts]);
const knownVariants = new Set<string>(characterVariantNames);

const containers = new Set(['g', 'defs', 'clipPath', 'mask', 'pattern']);
const shapes = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'use']);
const gradients = new Set(['linearGradient', 'radialGradient']);
/** Dropped without comment: editor metadata. */
const quiet = new Set(['title', 'desc', 'metadata']);
/** Dropped with a note, so creators know why something vanished. */
const unsupported: Record<string, string> = {
  script: 'scripts never run in characters',
  foreignObject: 'embedded HTML is not allowed',
  style: 'style sheets are not supported; export with presentation attributes',
  image: 'embedded images are not supported; use vector shapes',
  a: 'links are not allowed',
  text: 'text is not supported; convert it to outlines',
  filter: 'filters are not supported yet; flatten blurs and shadows into shapes',
  animate: 'Edi animates characters itself',
  animateTransform: 'Edi animates characters itself',
  animateMotion: 'Edi animates characters itself',
  set: 'Edi animates characters itself',
};

const number = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?$/;
const numberList = /^[\d\s,.\-+eE%]*$/;
const pathData = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.\-+eE]*$/;
const transformList =
  /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.\-+eE]*\)\s*,?\s*)*$/;
const idPattern = /^[A-Za-z_][\w.-]{0,63}$/;
const namePattern = /^[a-z][a-z-]{0,23}$/;
const colorPattern =
  /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}|(?:rgb|rgba|hsl|hsla)\(\s*[\d\s.,%]+\))$/;
const localUrl = /^url\(\s*['"]?#([A-Za-z_][\w.-]{0,63})['"]?\s*\)(?:\s+(\S+))?$/;

type Kind =
  | 'number'
  | 'numbers'
  | 'path'
  | 'transform'
  | 'paint'
  | 'color'
  | 'reference'
  | 'href'
  | 'id'
  | 'name'
  | { oneOf: string[] };

const presentation: Record<string, Kind> = {
  fill: 'paint',
  stroke: 'paint',
  'fill-opacity': 'number',
  'stroke-opacity': 'number',
  opacity: 'number',
  'stroke-width': 'number',
  'stroke-miterlimit': 'number',
  'stroke-dashoffset': 'number',
  'stroke-dasharray': 'numbers',
  'stroke-linecap': { oneOf: ['butt', 'round', 'square'] },
  'stroke-linejoin': { oneOf: ['miter', 'round', 'bevel', 'miter-clip', 'arcs'] },
  'fill-rule': { oneOf: ['nonzero', 'evenodd'] },
  'clip-rule': { oneOf: ['nonzero', 'evenodd'] },
  'clip-path': 'reference',
  mask: 'reference',
  'paint-order': { oneOf: ['normal', 'fill', 'stroke', 'markers', 'stroke fill', 'fill stroke'] },
  'vector-effect': { oneOf: ['none', 'non-scaling-stroke'] },
  transform: 'transform',
};
const common: Record<string, Kind> = {
  ...presentation,
  id: 'id',
  'data-part': 'name',
  'data-variant': 'name',
};
const units = { oneOf: ['userSpaceOnUse', 'objectBoundingBox'] };
const specific: Record<string, Record<string, Kind>> = {
  path: { d: 'path' },
  circle: { cx: 'number', cy: 'number', r: 'number' },
  ellipse: { cx: 'number', cy: 'number', rx: 'number', ry: 'number' },
  rect: { x: 'number', y: 'number', width: 'number', height: 'number', rx: 'number', ry: 'number' },
  line: { x1: 'number', y1: 'number', x2: 'number', y2: 'number' },
  polyline: { points: 'numbers' },
  polygon: { points: 'numbers' },
  use: { href: 'href', x: 'number', y: 'number', width: 'number', height: 'number' },
  linearGradient: {
    x1: 'number',
    y1: 'number',
    x2: 'number',
    y2: 'number',
    gradientUnits: units,
    gradientTransform: 'transform',
    spreadMethod: { oneOf: ['pad', 'reflect', 'repeat'] },
    href: 'href',
  },
  radialGradient: {
    cx: 'number',
    cy: 'number',
    r: 'number',
    fx: 'number',
    fy: 'number',
    fr: 'number',
    gradientUnits: units,
    gradientTransform: 'transform',
    spreadMethod: { oneOf: ['pad', 'reflect', 'repeat'] },
    href: 'href',
  },
  stop: { offset: 'number', 'stop-color': 'color', 'stop-opacity': 'number' },
  clipPath: { clipPathUnits: units },
  mask: {
    maskUnits: units,
    maskContentUnits: units,
    x: 'number',
    y: 'number',
    width: 'number',
    height: 'number',
  },
  pattern: {
    x: 'number',
    y: 'number',
    width: 'number',
    height: 'number',
    patternUnits: units,
    patternContentUnits: units,
    patternTransform: 'transform',
    viewBox: 'numbers',
  },
};

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

class ParseError extends Error {}

/** A strict, small XML reader: elements and attributes only; no entities beyond the basic five. */
function parse(source: string): Element {
  let at = 0;
  let count = 0;
  const fail = (message: string): never => {
    throw new ParseError(message);
  };
  const decode = (value: string) =>
    value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);?/g, (match, entity: string) => {
      if (!match.endsWith(';')) return fail('Unfinished character reference in an attribute');
      if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
      return (
        entities[entity] ?? fail(`Unknown entity &${entity}; (only &amp; &lt; &gt; &quot; &apos;)`)
      );
    });
  const skipTo = (marker: string, what: string) => {
    const end = source.indexOf(marker, at);
    if (end < 0) fail(`Unclosed ${what}`);
    at = end + marker.length;
  };

  // Sticky patterns match in place, so reading never copies the rest of the file.
  const closingTag = /<\/([A-Za-z_][\w.:-]*)\s*>/y;
  const openingTag = /<([A-Za-z_][\w.:-]*)/y;
  const whitespace = /\s*/y;
  const attributePattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  const sticky = (pattern: RegExp, index: number) => {
    pattern.lastIndex = index;
    return pattern.exec(source);
  };

  const stack: Element[] = [];
  let root: Element | undefined;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    if (open < 0) break;
    at = open;
    if (source.startsWith('<?', at)) skipTo('?>', 'processing instruction');
    else if (source.startsWith('<!--', at)) skipTo('-->', 'comment');
    else if (source.startsWith('<![CDATA[', at)) fail('CDATA sections are not allowed');
    else if (source.startsWith('<!', at)) {
      const end = source.indexOf('>', at);
      if (end < 0) fail('Unclosed declaration');
      if (source.slice(at, end).includes('['))
        fail('DOCTYPE declarations with entities are not allowed');
      at = end + 1;
    } else if (source.startsWith('</', at)) {
      const match = sticky(closingTag, at);
      if (!match) fail('Malformed closing tag');
      const element = stack.pop();
      if (!element || element.name !== match![1])
        fail(`Closing </${match![1]}> does not match <${element?.name ?? 'nothing'}>`);
      at += match![0].length;
    } else {
      const nameMatch = sticky(openingTag, at);
      if (!nameMatch) fail('Malformed tag');
      at += nameMatch![0].length;
      const element: Element = { name: nameMatch![1]!, attributes: new Map(), children: [] };
      if (++count > maxElements) fail(`More than ${maxElements} elements`);
      if (stack.length >= maxDepth) fail(`Nested deeper than ${maxDepth} levels`);
      let selfClosing = false;
      for (;;) {
        const space = sticky(whitespace, at)![0].length;
        at += space;
        if (source.startsWith('/>', at)) {
          at += 2;
          selfClosing = true;
          break;
        }
        if (source.startsWith('>', at)) {
          at += 1;
          break;
        }
        const attribute = sticky(attributePattern, at);
        if (!attribute || space === 0) fail(`Malformed attribute in <${element.name}>`);
        const [whole, name, double, single] = attribute!;
        if (!element.attributes.has(name!))
          element.attributes.set(name!, decode(double ?? single ?? ''));
        at += whole.length;
      }
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (root) fail('Only one root element is allowed');
      else root = element;
      if (!selfClosing) stack.push(element);
    }
  }
  if (stack.length) fail(`<${stack.at(-1)!.name}> is never closed`);
  if (!root) fail('No <svg> element found');
  return root!;
}

function checkValue(kind: Kind, raw: string): string | null {
  const value = raw.trim();
  if (value.length > 20_000) return null;
  if (typeof kind === 'object') return kind.oneOf.includes(value) ? value : null;
  switch (kind) {
    case 'number':
      return number.test(value) ? value : null;
    case 'numbers':
      return value === 'none' || numberList.test(value) ? value : null;
    case 'path':
      return pathData.test(value) ? value.replace(/\s+/g, ' ') : null;
    case 'transform':
      return transformList.test(value) ? value : null;
    case 'color':
      return value === 'currentColor' || colorPattern.test(value) ? value : null;
    case 'paint': {
      if (value === 'none' || value === 'currentColor' || colorPattern.test(value)) return value;
      const url = localUrl.exec(value);
      return url ? `url(#${url[1]})` : null;
    }
    case 'reference': {
      if (value === 'none') return value;
      const url = localUrl.exec(value);
      return url && !url[2] ? `url(#${url[1]})` : null;
    }
    case 'href':
      return /^#[A-Za-z_][\w.-]{0,63}$/.test(value) ? value : null;
    case 'id':
      return idPattern.test(value) ? value : null;
    case 'name':
      return namePattern.test(value) ? value : null;
  }
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sanitizeCharacterArt(source: string): SanitizedArt {
  const problems: ArtProblem[] = [];
  const noted = new Set<string>();
  const warn = (message: string) => {
    if (noted.has(message)) return;
    noted.add(message);
    problems.push({ level: 'warning', message });
  };
  const error = (message: string) => problems.push({ level: 'error', message });
  const failed = (): SanitizedArt => ({ markup: '', viewBox: null, variants: {}, problems });

  if (new TextEncoder().encode(source).byteLength > maxArtBytes) {
    error(`art.svg is larger than ${maxArtBytes / 1000} KB`);
    return failed();
  }
  if (source.includes('{{')) {
    error('art.svg may not contain "{{"');
    return failed();
  }
  let root: Element;
  try {
    root = parse(source.replace(/^\uFEFF/, ''));
  } catch (cause) {
    error(
      cause instanceof ParseError
        ? `art.svg is not valid SVG: ${cause.message}`
        : 'art.svg could not be read',
    );
    return failed();
  }
  if (root.name !== 'svg') {
    error('The root element of art.svg must be <svg>');
    return failed();
  }
  const viewBox = root.attributes.get('viewBox')?.trim().replace(/\s+/g, ' ') ?? null;
  if (!viewBox || !numberList.test(viewBox))
    error('The <svg> needs a viewBox, like viewBox="0 0 160 170"');

  // First pass: clean elements and attributes, collect ids.
  const ids = new Set<string>();
  const references: { element: Element; attribute: string; id: string }[] = [];
  const clean = (element: Element): Element | null => {
    const name = element.name;
    if (name.includes(':') || quiet.has(name)) return null;
    if (unsupported[name]) {
      warn(`Removed <${name}>: ${unsupported[name]}.`);
      return null;
    }
    if (name.startsWith('fe')) {
      warn(`Removed <${name}>: ${unsupported.filter}.`);
      return null;
    }
    const allowed =
      containers.has(name) || shapes.has(name) || gradients.has(name) || name === 'stop';
    if (!allowed) {
      warn(`Removed <${name}>: it is not a supported drawing element.`);
      return null;
    }
    const attributes = new Map<string, string>();
    for (const [rawName, rawValue] of element.attributes) {
      if (rawName.startsWith('on')) {
        warn(`Removed ${rawName}: event handlers never run.`);
        continue;
      }
      if (rawName === 'class') {
        warn(
          'Ignored class attributes: export with presentation attributes instead of CSS classes.',
        );
        continue;
      }
      const declarations =
        rawName === 'style'
          ? rawValue
              .split(';')
              .map(part => part.split(':'))
              .filter(pair => pair.length === 2)
              .map(([key, value]) => [key!.trim(), value!.trim()] as const)
          : [[rawName === 'xlink:href' ? 'href' : rawName, rawValue] as const];
      for (const [attribute, value] of declarations) {
        const kind = specific[name]?.[attribute] ?? common[attribute];
        if (!kind) continue;
        const checked = checkValue(kind, value);
        if (checked === null) {
          warn(
            `Removed ${attribute}="${value.slice(0, 40)}" on <${name}>: that value is not allowed.`,
          );
          continue;
        }
        if (attribute === 'data-part' && !knownParts.has(checked)) {
          warn(`Unknown part "${checked}". Parts are: ${[...knownParts].join(', ')}.`);
          continue;
        }
        if (attribute === 'data-variant' && !knownVariants.has(checked))
          warn(`Edi never asks for a variant named "${checked}"; it will not show.`);
        if (attributes.has(attribute)) continue;
        attributes.set(attribute, checked);
      }
    }
    const id = attributes.get('id');
    if (id) {
      if (ids.has(id)) {
        warn(`The id "${id}" is used more than once; later copies were renamed away.`);
        attributes.delete('id');
      } else ids.add(id);
    }
    const result: Element = { name, attributes, children: [] };
    for (const [attribute, value] of attributes) {
      const target =
        /^url\(#(.+)\)$/.exec(value)?.[1] ?? (attribute === 'href' ? value.slice(1) : null);
      if (target) references.push({ element: result, attribute, id: target });
    }
    if (name === 'use' && !attributes.has('href')) return null;
    for (const child of element.children) {
      const kept = clean(child);
      if (kept) result.children.push(kept);
    }
    return result;
  };
  const children = root.children.map(clean).filter(child => child !== null);

  // References must stay inside the file.
  for (const { element, attribute, id } of references) {
    if (ids.has(id)) continue;
    warn(`Removed a reference to "#${id}", which is not defined in art.svg.`);
    element.attributes.delete(attribute);
  }

  // Parts and their variants.
  const variants: Record<string, string[]> = {};
  const seenParts = new Set<string>();
  const walk = (element: Element) => {
    const part = element.attributes.get('data-part');
    if (part && (characterParts as readonly string[]).includes(part)) {
      if (seenParts.has(part)) error(`The part "${part}" appears more than once.`);
      seenParts.add(part);
      variants[part] = element.children
        .map(child => child.attributes.get('data-variant'))
        .filter((value): value is string => Boolean(value));
    }
    element.children.forEach(walk);
  };
  children.forEach(walk);
  for (const part of requiredCharacterParts) {
    if (!seenParts.has(part)) error(`art.svg needs a <g data-part="${part}"> group.`);
    else if (!variants[part]!.includes('default'))
      error(`The ${part} part needs a child with data-variant="default".`);
  }
  const hasPupils = (element: Element): boolean =>
    element.attributes.get('data-part') === 'pupils' || element.children.some(hasPupils);
  if (seenParts.has('eyes') && !children.some(hasPupils))
    warn('No data-part="pupils" group: the eyes will not glance around.');

  if (problems.some(problem => problem.level === 'error'))
    return { ...failed(), viewBox, variants };

  // Only ids, href targets and url(#…) references are scoped; colors like #fff are left alone.
  const scope = (name: string, value: string) => {
    if (name === 'id') return `{{scope}}-${value}`;
    if (name === 'href') return `#{{scope}}-${value.slice(1)}`;
    return value.replace(/^url\(#(.+)\)$/, 'url(#{{scope}}-$1)');
  };
  const serialize = (element: Element): string => {
    const attributes = [...element.attributes]
      .map(([name, value]) => {
        const scoped = scope(name, value);
        return ` ${name}="${escape(scoped)}"`;
      })
      .join('');
    const inner = element.children.map(serialize).join('');
    return inner
      ? `<${element.name}${attributes}>${inner}</${element.name}>`
      : `<${element.name}${attributes}/>`;
  };
  return { markup: children.map(serialize).join(''), viewBox, variants, problems };
}
